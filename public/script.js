document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;
const MAX_VISIBLE_POINTS = 30;
const CHUNK_SIZE = 100;
const SCROLL_LOAD_THRESHOLD = 10; // % от начала, при котором подгружаем старые данные

let loadedPoints = [];
let earliestLoadedDt = null;
let latestLoadedDt = null;
let hasMore = true;
let currentInterval = null;
let currentYColumn = 'value';
let currentVisiblePoints = [];
let isLoading = false;

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
        if (loadedPoints.length) fullLoadData();
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
    fullLoadData();
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket подключен');
        wsConnected = true;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);

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
        p2: row.p2,
        x: new Date(row.dt).getTime(),
        y: currentYColumn === 'value' ? row.value : (currentYColumn === 'p1' ? row.p1 : row.p2)
    }));

    const existingKeys = new Set(loadedPoints.map(p => `${p.dt}_${p.id}`));
    const uniqueNew = newPoints.filter(p => !existingKeys.has(`${p.dt}_${p.id}`));
    if (!uniqueNew.length) return;

    loadedPoints.push(...uniqueNew);
    loadedPoints.sort((a, b) => new Date(a.dt) - new Date(b.dt));

    earliestLoadedDt = loadedPoints[0].dt;
    latestLoadedDt = loadedPoints[loadedPoints.length - 1].dt;

    appendNewPoints(uniqueNew);
    updateLastUpdateTime(); // обновляем время при появлении новой записи
}

function appendNewPoints(newPoints) {
    if (!chart) return;

    const newChartPoints = newPoints.map(item => ({
        x: new Date(item.dt).getTime(),
        y: currentYColumn === 'value' ? item.value : (currentYColumn === 'p1' ? item.p1 : item.p2),
        original: item
    })).sort((a, b) => a.x - b.x);

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

async function fullLoadData() {
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;

    if (!start || !end) return;

    const startDate = new Date(start + ':00');
    const endDate = new Date(end + ':00');
    if (isNaN(startDate) || isNaN(endDate)) return;

    currentInterval = { start: startDate, end: endDate };
    hasMore = true;
    loadedPoints = [];
    earliestLoadedDt = null;
    latestLoadedDt = null;

    if (wsConnected && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'set_interval',
            start: currentInterval.start.toISOString(),
            end: currentInterval.end.toISOString()
        }));
    }

    await loadDataChunk(null);
}

async function loadDataChunk(before = null) {
    if (!currentInterval) return;
    if (isLoading) return;
    isLoading = true;

    if (abortController) abortController.abort();
    abortController = new AbortController();

    const column = document.getElementById('column').value;
    const url = new URL('/api/trends', window.location.origin);
    const xParam = JSON.stringify([{ dt_interval: `${currentInterval.start.toISOString()}/${currentInterval.end.toISOString()}` }]);
    url.searchParams.append('x', xParam);
    url.searchParams.append('y', column);
    url.searchParams.append('limit', CHUNK_SIZE);
    if (before) {
        url.searchParams.append('before', before);
    }

    try {
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Ошибка HTTP: ${response.status}`);
        }
        const result = await response.json();

        if (!result.data || result.data.length === 0) {
            if (before) hasMore = false;
            isLoading = false;
            return;
        }

        const newPoints = result.data.map(item => ({
            dt: item.dt,
            id: item.id,
            value: item.value,
            p1: item.p1,
            p2: item.p2,
            x: new Date(item.dt).getTime(),
            y: column === 'value' ? item.value : (column === 'p1' ? item.p1 : item.p2)
        }));

        const existingKeys = new Set(loadedPoints.map(p => `${p.dt}_${p.id}`));
        const uniqueNew = newPoints.filter(p => !existingKeys.has(`${p.dt}_${p.id}`));
        if (uniqueNew.length === 0) {
            isLoading = false;
            return;
        }

        loadedPoints.push(...uniqueNew);
        loadedPoints.sort((a, b) => new Date(a.dt) - new Date(b.dt));

        earliestLoadedDt = loadedPoints[0].dt;
        latestLoadedDt = loadedPoints[loadedPoints.length - 1].dt;

        if (before && result.data.length < CHUNK_SIZE) hasMore = false;

        rebuildFromRawData();
        updateLastUpdateTime();
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Ошибка загрузки порции:', err);
        alert('Не удалось загрузить данные: ' + err.message);
    } finally {
        isLoading = false;
    }
}

function rebuildFromRawData() {
    if (!loadedPoints.length) {
        document.getElementById('scrollContainer').style.display = 'none';
        updateChartWithUniformSpacing([], currentYColumn);
        currentVisiblePoints = [];
        return;
    }

    const totalPoints = loadedPoints.length;
    if (totalPoints > MAX_VISIBLE_POINTS) {
        document.getElementById('scrollContainer').style.display = 'block';
        const rangeInput = document.getElementById('timeRange');
        const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;
        let percent = parseFloat(rangeInput.value);
        if (isNaN(percent)) percent = 100;
        let startIndex = Math.round((percent / 100) * maxStartIndex);
        startIndex = Math.min(Math.max(0, startIndex), maxStartIndex);
        const visiblePoints = loadedPoints.slice(startIndex, startIndex + MAX_VISIBLE_POINTS);
        updateChartWithUniformSpacing(visiblePoints, currentYColumn);
    } else {
        document.getElementById('scrollContainer').style.display = 'none';
        updateChartWithUniformSpacing(loadedPoints, currentYColumn);
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
        // Добавляем обработчик прокрутки колёсиком мыши на canvas
        const canvas = document.getElementById('trendChart');
        canvas.addEventListener('wheel', onChartWheel);
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

function onChartWheel(e) {
    e.preventDefault();
    const rangeInput = document.getElementById('timeRange');
    let currentVal = parseFloat(rangeInput.value);
    // Шаг прокрутки: 1% за одно движение колесика
    const step = 1;
    const delta = e.deltaY > 0 ? -step : step;
    let newVal = currentVal + delta;
    newVal = Math.min(100, Math.max(0, newVal));
    if (newVal !== currentVal) {
        rangeInput.value = newVal;
        onRangeChange({ target: rangeInput });
    }
}

function getVisiblePointsByPercent(percent) {
    const totalPoints = loadedPoints.length;
    if (totalPoints <= MAX_VISIBLE_POINTS) return loadedPoints;

    const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;
    let startIndex = Math.round((percent / 100) * maxStartIndex);
    startIndex = Math.min(Math.max(0, startIndex), maxStartIndex);
    return loadedPoints.slice(startIndex, startIndex + MAX_VISIBLE_POINTS);
}

function applyVisibleWindow(percent, yColumn) {
    if (!loadedPoints.length) return;
    const visiblePoints = getVisiblePointsByPercent(percent);
    if (visiblePoints.length) updateChartWithUniformSpacing(visiblePoints, yColumn);
}

async function onRangeChange(e) {
    const percent = parseFloat(e.target.value);
    applyVisibleWindow(percent, currentYColumn);

    if (hasMore && earliestLoadedDt && percent < SCROLL_LOAD_THRESHOLD) {
        await loadDataChunk(earliestLoadedDt);
        const rangeInput = document.getElementById('timeRange');
        const totalPoints = loadedPoints.length;
        if (totalPoints > MAX_VISIBLE_POINTS) {
            const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;
            let startIndex = Math.round((percent / 100) * maxStartIndex);
            startIndex = Math.min(Math.max(0, startIndex), maxStartIndex);
            const newPercent = (startIndex / maxStartIndex) * 100;
            rangeInput.value = newPercent;
            applyVisibleWindow(newPercent, currentYColumn);
        } else {
            rebuildFromRawData();
        }
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