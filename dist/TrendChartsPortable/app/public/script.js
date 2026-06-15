document.addEventListener('DOMContentLoaded', init);

let chart;
const VIEW_WINDOW = 50;
const CHUNK_SIZE = 100;
const MAX_LOADED_POINTS = 2500;
const TRIM_BATCH = 400;
const WS_PING_INTERVAL_MS = 8000;
const WS_PONG_TIMEOUT_MS = 15000;
const WS_RTT_WARN_MS = 3000;

let loadedPoints = [];
/** Составной ключ (dt + id), не только id с сервера */
let loadedPointKeySet = new Set();
let currentViewStartIdx = 0;
let earliestLoadedDt = null;
let currentYColumn = 'value';
let isLoading = false;
let hasMore = true;
let lastUpdateStr = 'никогда';
let loadErrorMessage = null;
let rangeHasNoData = false;

let fetchController = null;
const mpack = msgpack5();

let wsRef = null;
let wsPingTimer = null;
let wsStaleCheckTimer = null;
let wsPingSeq = 0;
let wsPendingPingId = null;
let wsPendingPingSentAt = null;
let wsLastRttMs = null;
let wsLinkStale = false;

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

function makeDedupeKey(dtRaw, id) {
    const iso = typeof dtRaw === 'string' ? dtRaw : new Date(dtRaw).toISOString();
    return `${iso}|${Number(id)}`;
}

function mapApiRowToPoint(item) {
    const dtIso = typeof item.dt === 'string' ? item.dt : new Date(item.dt).toISOString();
    const dedupeKey = makeDedupeKey(dtIso, item.id);
    return {
        x: new Date(dtIso).getTime(),
        y: Number(item[currentYColumn]),
        id: Number(item.id),
        dt: dtIso,
        dedupeKey,
        fullDate: new Date(dtIso).toLocaleString('ru-RU'),
        shortTime: new Date(dtIso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
}

function setChartEmptyVisible(show) {
    const panel = document.getElementById('chart-empty-state');
    const cv = document.getElementById('trendChart');
    if (!panel || !cv) return;
    if (show) {
        panel.classList.remove('hidden');
        cv.classList.add('chart-hidden');
    } else {
        panel.classList.add('hidden');
        cv.classList.remove('chart-hidden');
    }
}

function trimLoadedPointsIfNeeded() {
    while (loadedPoints.length > MAX_LOADED_POINTS) {
        const remove = Math.min(TRIM_BATCH, loadedPoints.length - MAX_LOADED_POINTS + 50);
        if (remove <= 0) break;
        const len = loadedPoints.length;
        const viewCenter = currentViewStartIdx + VIEW_WINDOW / 2;
        const trimFromEnd = viewCenter < len / 2;
        if (trimFromEnd) {
            const cut = loadedPoints.splice(len - remove, remove);
            cut.forEach((p) => loadedPointKeySet.delete(p.dedupeKey));
        } else {
            const cut = loadedPoints.splice(0, remove);
            cut.forEach((p) => loadedPointKeySet.delete(p.dedupeKey));
            currentViewStartIdx = Math.max(0, currentViewStartIdx - remove);
        }
    }
}

function debounce(func, timeout = 500) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            func.apply(this, args);
        }, timeout);
    };
}

const debouncedResetAndLoad = debounce(() => {
    fullResetAndLoad();
}, 600);

function clearWsTimers() {
    if (wsPingTimer) {
        clearInterval(wsPingTimer);
        wsPingTimer = null;
    }
    if (wsStaleCheckTimer) {
        clearInterval(wsStaleCheckTimer);
        wsStaleCheckTimer = null;
    }
}

function handleWsPong(msg) {
    if (msg.id != null && msg.id === wsPendingPingId && wsPendingPingSentAt != null) {
        wsLastRttMs = Date.now() - wsPendingPingSentAt;
        wsPendingPingId = null;
        wsPendingPingSentAt = null;
        wsLinkStale = false;
    }
}

function tryDecodeWsPayload(raw, mpDecode) {
    if (typeof raw === 'string') {
        return { format: 'json', value: JSON.parse(raw) };
    }
    let u8;
    if (raw instanceof ArrayBuffer) u8 = new Uint8Array(raw);
    else if (ArrayBuffer.isView(raw)) u8 = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    if (u8) {
        try {
            return { format: 'msgpack', value: mpDecode(u8) };
        } catch (mpErr) {
            const text = new TextDecoder('utf8', { fatal: false }).decode(u8);
            try {
                const j = JSON.parse(text);
                return { format: 'json', value: j, mpFallback: mpErr };
            } catch (jsonErr) {
                const err = new Error(
                    `Сообщение WS: не MessagePack (${mpErr.message}), не JSON (${jsonErr.message})`
                );
                err.mpError = mpErr;
                err.jsonError = jsonErr;
                throw err;
            }
        }
    }
    throw new Error('Неизвестный тип данных WebSocket');
}

// --- ИНИЦИАЛИЗАЦИЯ ---

async function init() {
    await setupInitialDates();
    connectWS();

    document.getElementById('toggle-settings').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.toggle('hidden');
    });

    document.getElementById('load-btn').addEventListener('click', () => {
        document.getElementById('end').value = formatToDateTimeLocal(new Date());
        fullResetAndLoad();
    });

    document.getElementById('column').addEventListener('change', (e) => {
        currentYColumn = e.target.value;
        debouncedResetAndLoad();
    });

    document.getElementById('start').addEventListener('input', debouncedResetAndLoad);
    document.getElementById('end').addEventListener('input', debouncedResetAndLoad);

    document.getElementById('line-color').addEventListener('input', (e) => {
        const newColor = e.target.value;
        if (chart) {
            const dataset = chart.data.datasets[0];
            dataset.borderColor = newColor;
            dataset.backgroundColor = newColor + '22';
            dataset.pointBackgroundColor = newColor;
            dataset.pointBorderColor = newColor;
            chart.update('none');
        }
    });

    document.getElementById('chartWrapper').addEventListener('wheel', handleWheel, { passive: false });

    fullResetAndLoad();
}

function connectWS() {
    clearWsTimers();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.binaryType = 'arraybuffer';
    wsRef = ws;

    ws.onopen = () => {
        wsPingTimer = setInterval(() => {
            if (ws.readyState !== WebSocket.OPEN) return;
            wsPingSeq += 1;
            wsPendingPingId = wsPingSeq;
            wsPendingPingSentAt = Date.now();
            ws.send(JSON.stringify({ type: 'ping', id: wsPingSeq, t: Date.now() }));
        }, WS_PING_INTERVAL_MS);

        wsStaleCheckTimer = setInterval(() => {
            if (wsPendingPingSentAt != null && Date.now() - wsPendingPingSentAt > WS_PONG_TIMEOUT_MS) {
                wsLinkStale = true;
                updateStatusText();
            }
            if (wsLastRttMs != null && wsLastRttMs > WS_RTT_WARN_MS) updateStatusText();
        }, 2000);
    };

    ws.onmessage = (event) => {
        (async () => {
            try {
                const raw = event.data;
                let decoded;
                if (raw instanceof Blob) {
                    const buf = await raw.arrayBuffer();
                    decoded = tryDecodeWsPayload(buf, (u8) => mpack.decode(u8));
                } else {
                    decoded = tryDecodeWsPayload(raw, (u8) => mpack.decode(u8));
                }
                if (decoded.mpFallback) {
                    console.warn('WS: ответ как JSON при ошибке разбора MessagePack', decoded.mpFallback);
                }
                const msg = decoded.value;
                if (msg.type === 'pong') {
                    handleWsPong(msg);
                    updateStatusText();
                    return;
                }
                if (msg.type === 'NEW_DATA') handleIncomingPoint(msg.data);
            } catch (e) {
                console.error('WS:', e.message || e, e.mpError || '', e.jsonError || '');
            }
        })();
    };

    ws.onclose = () => {
        clearWsTimers();
        wsRef = null;
        wsPendingPingId = null;
        wsPendingPingSentAt = null;
        setTimeout(connectWS, 2000);
    };
}

function handleIncomingPoint(point) {
    const val = Number(point[currentYColumn]);
    if (isNaN(val)) return;

    const dedupeKey = makeDedupeKey(point.dt, point.id);
    if (loadedPointKeySet.has(dedupeKey)) return;

    const newPoint = {
        x: new Date(point.dt).getTime(),
        y: val,
        id: Number(point.id),
        dt: typeof point.dt === 'string' ? point.dt : new Date(point.dt).toISOString(),
        dedupeKey,
        fullDate: new Date(point.dt).toLocaleString('ru-RU'),
        shortTime: new Date(point.dt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };

    const isAtEnd = currentViewStartIdx >= loadedPoints.length - VIEW_WINDOW - 1;

    loadedPointKeySet.add(dedupeKey);
    loadedPoints.push(newPoint);
    trimLoadedPointsIfNeeded();

    if (rangeHasNoData) {
        rangeHasNoData = false;
        setChartEmptyVisible(false);
    }

    if (chart) {
        if (isAtEnd) {
            currentViewStartIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
        }
        updateChartWindow();
    } else {
        currentViewStartIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
        initChart();
    }

    lastUpdateStr = new Date().toLocaleTimeString('ru-RU');
    updateStatusText();
}

async function setupInitialDates() {
    try {
        const res = await fetch('/api/data-range');
        const json = await res.json();
        if (json.success && json.min) {
            document.getElementById('start').value = formatToDateTimeLocal(new Date(json.min));
        }
        document.getElementById('end').value = formatToDateTimeLocal(new Date());
    } catch (e) {
        console.error(e);
    }
}

async function fullResetAndLoad() {
    if (fetchController) fetchController.abort();

    loadedPoints = [];
    loadedPointKeySet.clear();
    currentViewStartIdx = 0;
    hasMore = true;
    earliestLoadedDt = null;
    isLoading = false;
    loadErrorMessage = null;
    rangeHasNoData = false;
    setChartEmptyVisible(false);

    if (chart) {
        chart.destroy();
        chart = null;
    }
    await loadMoreHistory(true);
}

async function loadMoreHistory(isInitial = false) {
    if (isLoading || !hasMore) return;

    if (fetchController) fetchController.abort();
    fetchController = new AbortController();
    const signal = fetchController.signal;

    const startVal = document.getElementById('start').value;
    const endVal = document.getElementById('end').value;

    isLoading = true;
    loadErrorMessage = null;
    document.getElementById('status-bar').textContent = 'Загрузка данных...';

    try {
        const url = new URL('/api/trends', window.location.origin);
        const xParam = JSON.stringify([{ dt_interval: `${new Date(startVal).toISOString()}/${new Date(endVal).toISOString()}` }]);
        url.searchParams.append('x', xParam);
        url.searchParams.append('y', currentYColumn);
        url.searchParams.append('limit', CHUNK_SIZE);
        if (earliestLoadedDt) url.searchParams.append('before', earliestLoadedDt);

        const response = await fetch(url, { signal });
        let result;
        try {
            result = await response.json();
        } catch (parseErr) {
            throw new Error('Ответ сервера не удалось разобрать как JSON');
        }

        if (!response.ok) {
            throw new Error(result.error || `Ошибка HTTP ${response.status}`);
        }

        if (!result.success) {
            throw new Error(result.error || 'Сервер вернул success: false');
        }

        const rows = Array.isArray(result.data) ? result.data : [];

        if (rows.length > 0) {
            rangeHasNoData = false;
            setChartEmptyVisible(false);

            const toAdd = [];
            for (const item of rows) {
                const pt = mapApiRowToPoint(item);
                if (loadedPointKeySet.has(pt.dedupeKey)) continue;
                loadedPointKeySet.add(pt.dedupeKey);
                toAdd.push(pt);
            }

            earliestLoadedDt = rows[0].dt;
            const addedCount = toAdd.length;
            loadedPoints = [...toAdd, ...loadedPoints];
            trimLoadedPointsIfNeeded();

            if (isInitial) {
                currentViewStartIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
                if (loadedPoints.length === 0) {
                    rangeHasNoData = true;
                    setChartEmptyVisible(true);
                    if (chart) {
                        chart.destroy();
                        chart = null;
                    }
                } else {
                    initChart();
                }
            } else {
                currentViewStartIdx += addedCount;
            }
            if (loadedPoints.length > 0) updateChartWindow();
            if (rows.length < CHUNK_SIZE) hasMore = false;
        } else {
            hasMore = false;
            if (isInitial) {
                rangeHasNoData = true;
                setChartEmptyVisible(true);
                if (chart) {
                    chart.destroy();
                    chart = null;
                }
            } else if (isInitial === false && loadedPoints.length === 0) {
                /* подгрузка истории — пустой чанк */
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') {
            loadErrorMessage = err.message || String(err);
            console.error('Ошибка API:', err);
        }
    } finally {
        isLoading = false;
        lastUpdateStr = new Date().toLocaleTimeString('ru-RU');
        updateStatusText();
    }
}

function initChart() {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const color = document.getElementById('line-color').value;

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: currentYColumn,
                    data: [],
                    borderColor: color,
                    backgroundColor: color + '22',
                    pointBackgroundColor: color,
                    pointBorderColor: color,
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.1,
                    fill: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'category',
                    grid: { display: true, color: '#e0e0e0', drawTicks: true },
                    ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } },
                },
                y: { grid: { color: '#f0f0f0' }, grace: '10%' },
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: (items) => {
                            const p = loadedPoints[currentViewStartIdx + items[0].dataIndex];
                            return p ? p.fullDate : '';
                        },
                        label: (item) => {
                            const p = loadedPoints[currentViewStartIdx + item.dataIndex];
                            return p ? `ID: ${p.id} | Значение: ${item.formattedValue}` : '';
                        },
                    },
                },
            },
        },
    });
    updateChartWindow();
}

function handleWheel(e) {
    e.preventDefault();
    if (loadedPoints.length === 0 || isLoading || !chart) return;

    const delta = e.deltaY > 0 ? 2 : -2;
    let nextIdx = currentViewStartIdx + delta;
    const maxIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
    nextIdx = Math.max(0, Math.min(maxIdx, nextIdx));

    if (nextIdx !== currentViewStartIdx) {
        currentViewStartIdx = nextIdx;
        updateChartWindow();
        if (currentViewStartIdx < 10 && hasMore && !isLoading) loadMoreHistory();
    }
}

function updateChartWindow() {
    if (!chart || loadedPoints.length === 0) return;
    const windowData = loadedPoints.slice(currentViewStartIdx, currentViewStartIdx + VIEW_WINDOW);
    chart.data.labels = windowData.map((p) => p.shortTime);
    chart.data.datasets[0].data = windowData.map((p) => p.y);
    chart.update('none');
    updateStatusText();
}

function wsStatusSuffix() {
    if (wsLinkStale) return ' | WS: нет ответа на ping (медленный канал или потери)';
    if (wsLastRttMs != null && wsLastRttMs > WS_RTT_WARN_MS) {
        return ` | WS: задержка ~${Math.round(wsLastRttMs)} мс`;
    }
    return '';
}

function updateStatusText() {
    const bar = document.getElementById('status-bar');
    if (loadErrorMessage) {
        bar.textContent = `Ошибка: ${loadErrorMessage}`;
        return;
    }
    if (isLoading) {
        bar.textContent = 'Загрузка данных...';
        return;
    }
    if (rangeHasNoData && loadedPoints.length === 0) {
        bar.textContent = 'В выбранном диапазоне нет данных' + wsStatusSuffix();
        return;
    }
    if (loadedPoints.length === 0) {
        bar.textContent = 'Нет данных' + wsStatusSuffix();
        return;
    }
    const endIdx = Math.min(currentViewStartIdx + VIEW_WINDOW - 1, loadedPoints.length - 1);
    const startP = loadedPoints[currentViewStartIdx];
    const endP = loadedPoints[endIdx];
    const idRange = startP && endP ? `${startP.id}-${endP.id}` : '...';
    bar.textContent = `ID: ${idRange} | Всего: ${loadedPoints.length} | Обновлено: ${lastUpdateStr}${wsStatusSuffix()}`;
}

function formatToDateTimeLocal(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 19);
}
