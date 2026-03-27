document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;
let pollingInterval = null;
const POLLING_INTERVAL_MS = 5000;
const MAX_STORED_POINTS = 1000;

let currentData = [];
let rawData = [];
let lastDt = null;
let currentInterval = null;
let currentYColumn = 'value';

const MAX_VISIBLE_POINTS = 30;
let currentVisiblePoints = [];

let isLoading = false;

// WebSocket
let ws = null;
let wsConnected = false;
let wsReconnectTimer = null;

function init() {
    setDefaultDates();

    document.getElementById('toggle-settings').addEventListener('click', toggleSettings);
    document.getElementById('load-btn').addEventListener('click', () => fullLoadData());
    document.getElementById('line-color').addEventListener('change', () => {
        if (chart && currentVisiblePoints.length) updateChartCurrentColor();
    });

    document.getElementById('column').addEventListener('change', (e) => {
        currentYColumn = e.target.value;
        if (rawData.length) fullLoadData();
    });

    const timeRange = document.getElementById('timeRange');
    timeRange.addEventListener('input', onRangeChange);
    timeRange.addEventListener('dragstart', (e) => e.preventDefault());

    let debounceTimer;
    const debounceLoad = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fullLoadData(), 500);
    };
    document.getElementById('start').addEventListener('input', debounceLoad);
    document.getElementById('end').addEventListener('input', debounceLoad);

    connectWebSocket();
    startPolling();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket подключен');
        wsConnected = true;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);

        // Отправляем текущий интервал на сервер
        if (currentInterval) {
            ws.send(JSON.stringify({
                type: 'set_interval',
                start: currentInterval.start.toISOString(),
                end: currentInterval.end.toISOString()
            }));
        }
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            if (message.type === 'new_data' && message.data) {
                handleNewData(message.data);
            }
        } catch (err) {
            console.error('Ошибка обработки WebSocket сообщения:', err);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket отключен, переподключение через 5 сек');
        wsConnected = false;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(() => connectWebSocket(), 5000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket ошибка:', err);
        ws.close();
    };
}

function handleNewData(newRows) {
    if (!newRows || !newRows.length) return;

    const newPoints = newRows.map(row => ({
        dt: row.dt,
        id: row.id,
        value: row.value,
        p1: row.p1,
        p2: row.p2
    }));

    const existingKeys = new Set(rawData.map(item => `${item.dt}_${item.id}`));
    const newUniqueData = newPoints.filter(item => !existingKeys.has(`${item.dt}_${item.id}`));
    if (!newUniqueData.length) return;

    rawData = [...rawData, ...newUniqueData];
    rawData.sort((a, b) => new Date(a.dt) - new Date(b.dt));

    if (rawData.length > MAX_STORED_POINTS) {
        rawData = rawData.slice(-MAX_STORED_POINTS);
    }

    if (rawData.length) {
        const lastDate = new Date(rawData[rawData.length - 1].dt);
        lastDt = lastDate;
    }

    appendNewPoints(newUniqueData);
}

function updateChartCurrentColor() {
    if (!chart) return;
    const color = document.getElementById('line-color').value;
    chart.data.datasets[0].borderColor = color;
    chart.data.datasets[0].backgroundColor = color + '33';
    chart.update();
}

function toggleSettings() {
    document.getElementById('settings-panel').classList.toggle('hidden');
}

function setDefaultDates() {
    const startDate = new Date(2024, 0, 15, 0, 0, 0);
    const endDate = new Date();
    document.getElementById('start').value = formatDateTimeLocal(startDate);
    document.getElementById('end').value = formatDateTimeLocal(endDate);
}

function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function startPolling() {
    if (pollingInterval) return;
    if (!rawData.length) fullLoadData();
    else loadIncremental();
    pollingInterval = setInterval(() => loadIncremental(), POLLING_INTERVAL_MS);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

async function fullLoadData() {
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;

    if (!start || !end) return;

    const startDate = new Date(start + ':00');
    const endDate = new Date(end + ':00');
    if (isNaN(startDate) || isNaN(endDate)) return;

    currentInterval = { start: startDate, end: endDate };
    lastDt = null;

    // Отправляем интервал на сервер через WebSocket
    if (wsConnected && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'set_interval',
            start: currentInterval.start.toISOString(),
            end: currentInterval.end.toISOString()
        }));
    }

    await loadData(currentInterval.start, currentInterval.end, null, true);
}

async function loadIncremental() {
    if (!currentInterval) return;
    if (!lastDt) {
        await fullLoadData();
        return;
    }
    await loadData(currentInterval.start, currentInterval.end, lastDt, false);
}

async function loadData(start, end, since = null, fullReload = false) {
    if (isLoading) return;
    isLoading = true;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    const column = document.getElementById('column').value;
    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const dtInterval = `${startISO}/${endISO}`;
    const xParam = JSON.stringify([{ dt_interval: dtInterval }]);

    const url = new URL('/api/trends', window.location.origin);
    url.searchParams.append('x', xParam);
    url.searchParams.append('y', column);
    url.searchParams.append('online', 'true');
    if (since) {
        url.searchParams.append('since', since.toISOString());
    }

    try {
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Ошибка HTTP: ${response.status}`);
        }
        const result = await response.json();

        if (result.data.length === 0) {
            updateLastUpdateTime();
            isLoading = false;
            return;
        }

        if (since && !fullReload) {
            const existingKeys = new Set(rawData.map(item => `${item.dt}_${item.id}`));
            const newUniqueData = result.data.filter(item => !existingKeys.has(`${item.dt}_${item.id}`));
            if (newUniqueData.length) {
                rawData = [...rawData, ...newUniqueData];
                rawData.sort((a, b) => new Date(a.dt) - new Date(b.dt));

                if (rawData.length > MAX_STORED_POINTS) {
                    rawData = rawData.slice(-MAX_STORED_POINTS);
                }

                if (rawData.length) {
                    const lastDate = new Date(rawData[rawData.length - 1].dt);
                    lastDt = lastDate;
                }

                appendNewPoints(newUniqueData);
            }
        } else {
            rawData = result.data;
            if (rawData.length > MAX_STORED_POINTS) {
                rawData = rawData.slice(-MAX_STORED_POINTS);
            }
            if (rawData.length) {
                const lastDate = new Date(rawData[rawData.length - 1].dt);
                lastDt = lastDate;
            } else {
                lastDt = null;
            }
            rebuildFromRawData();
        }

        updateLastUpdateTime();

    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Ошибка загрузки:', err);
        alert('Не удалось загрузить данные: ' + err.message);
    } finally {
        isLoading = false;
    }
}

function updateLastUpdateTime() {
    const now = new Date();
    const timeStr = now.toLocaleString('ru-RU', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    const el = document.getElementById('lastUpdateTime');
    if (el) el.textContent = `Обновлено: ${timeStr}`;
}

function appendNewPoints(newPoints) {
    if (!chart) return;

    const newChartPoints = newPoints.map(item => ({
        x: new Date(item.dt).getTime(),
        y: currentYColumn === 'value' ? item.value : (currentYColumn === 'p1' ? item.p1 : item.p2),
        original: item
    })).sort((a, b) => a.x - b.x);

    currentData.push(...newChartPoints);
    currentData.sort((a, b) => a.x - b.x);

    const newLabels = newChartPoints.map(point => {
        const date = new Date(point.x);
        return date.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    });
    const newValues = newChartPoints.map(p => p.y);

    chart.data.labels.push(...newLabels);
    chart.data.datasets[0].data.push(...newValues);

    const rangeInput = document.getElementById('timeRange');
    const currentPercent = parseFloat(rangeInput.value);
    const totalPoints = chart.data.labels.length;
    const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;

    let newPercent = currentPercent;

    if (currentPercent >= 99.9) {
        const newStartIndex = totalPoints - MAX_VISIBLE_POINTS;
        newPercent = (newStartIndex / maxStartIndex) * 100;
        newPercent = Math.min(100, Math.max(0, newPercent));
        rangeInput.value = newPercent;
        applyVisibleWindow(newPercent, currentYColumn);
    } else {
        applyVisibleWindow(currentPercent, currentYColumn);
    }

    chart.update();
}

function rebuildFromRawData() {
    if (!rawData.length) {
        document.getElementById('scrollContainer').style.display = 'none';
        updateChartWithUniformSpacing([], currentYColumn);
        currentData = [];
        currentVisiblePoints = [];
        return;
    }

    const points = rawData.map(item => ({
        x: new Date(item.dt).getTime(),
        y: currentYColumn === 'value' ? item.value : (currentYColumn === 'p1' ? item.p1 : item.p2),
        original: item
    })).sort((a, b) => a.x - b.x);

    currentData = points;

    const totalPoints = currentData.length;
    if (totalPoints > MAX_VISIBLE_POINTS) {
        document.getElementById('scrollContainer').style.display = 'block';
        const rangeInput = document.getElementById('timeRange');
        rangeInput.min = 0;
        rangeInput.max = 100;
        const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;
        let percent = parseFloat(rangeInput.value);
        if (isNaN(percent)) percent = 100;
        const startIndex = Math.round((percent / 100) * maxStartIndex);
        const visiblePoints = currentData.slice(startIndex, startIndex + MAX_VISIBLE_POINTS);
        updateChartWithUniformSpacing(visiblePoints, currentYColumn);
    } else {
        document.getElementById('scrollContainer').style.display = 'none';
        updateChartWithUniformSpacing(currentData, currentYColumn);
    }
}

function updateChartWithUniformSpacing(points, yColumn) {
    if (!points || points.length === 0) {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
        currentVisiblePoints = [];
        return;
    }

    currentVisiblePoints = points;

    const lineColor = document.getElementById('line-color').value;
    const fillColor = lineColor + '33';

    const labels = points.map(point => {
        const date = new Date(point.x);
        return date.toLocaleString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    });

    if (!chart) {
        const ctx = document.getElementById('trendChart').getContext('2d');
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: yColumn,
                    data: points.map(p => p.y),
                    borderColor: lineColor,
                    backgroundColor: fillColor,
                    tension: 0.1,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointHitRadius: 15,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                scales: {
                    x: { type: 'category', title: { display: true, text: 'Время' } },
                    y: { beginAtZero: true, title: { display: true, text: yColumn } }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const point = currentVisiblePoints[context.dataIndex];
                                if (!point) return [];
                                const fullDate = new Date(point.x).toLocaleString('ru-RU', {
                                    year: 'numeric',
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                });
                                return [`Дата: ${fullDate}`, `${yColumn}: ${point.y}`];
                            },
                            title: () => ''
                        }
                    }
                }
            }
        });
    } else {
        chart.data.labels = labels;
        chart.data.datasets[0].label = yColumn;
        chart.data.datasets[0].data = points.map(p => p.y);
        chart.data.datasets[0].borderColor = lineColor;
        chart.data.datasets[0].backgroundColor = fillColor;
        chart.data.datasets[0].pointRadius = 3;
        chart.data.datasets[0].pointHoverRadius = 5;
        chart.data.datasets[0].pointHitRadius = 15;
        chart.update();
    }
}

function getVisiblePointsByPercent(percent) {
    const totalPoints = currentData.length;
    if (totalPoints <= MAX_VISIBLE_POINTS) return currentData;

    const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;
    let startIndex = Math.round((percent / 100) * maxStartIndex);
    startIndex = Math.min(Math.max(0, startIndex), maxStartIndex);
    return currentData.slice(startIndex, startIndex + MAX_VISIBLE_POINTS);
}

function applyVisibleWindow(percent, yColumn) {
    if (!currentData.length) return;
    const visiblePoints = getVisiblePointsByPercent(percent);
    if (visiblePoints.length) updateChartWithUniformSpacing(visiblePoints, yColumn);
}

function onRangeChange(e) {
    const percent = parseFloat(e.target.value);
    applyVisibleWindow(percent, currentYColumn);
}