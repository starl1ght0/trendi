document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;
let pollingInterval = null;
const POLLING_INTERVAL_MS = 30000; // 30 секунд
const MAX_STORED_POINTS = 1000;    // максимальное количество хранимых записей

let currentData = [];      // все загруженные точки (сортированные)
let rawData = [];          // исходные данные (без преобразования в точки)
let lastDt = null;         // максимальная дата среди загруженных данных
let currentInterval = null; // текущий выбранный интервал { start, end }
let currentYColumn = 'value'; // текущая колонка

const MAX_VISIBLE_POINTS = 30;
let currentVisiblePoints = [];

function init() {
    setDefaultDates();
    const onlineCheckbox = document.getElementById('online');
    onlineCheckbox.checked = true;

    document.getElementById('toggle-settings').addEventListener('click', toggleSettings);
    document.getElementById('load-btn').addEventListener('click', () => fullLoadData());
    onlineCheckbox.addEventListener('change', onOnlineToggle);
    document.getElementById('line-color').addEventListener('change', () => {
        if (chart && currentVisiblePoints.length) updateChartCurrentColor();
    });

    document.getElementById('column').addEventListener('change', (e) => {
        currentYColumn = e.target.value;
        if (rawData.length) rebuildFromRawData();
    });

    const timeRange = document.getElementById('timeRange');
    timeRange.addEventListener('input', onRangeChange);
    timeRange.addEventListener('dragstart', (e) => e.preventDefault());

    // Debounce для полей дат
    let debounceTimer;
    const debounceLoad = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => fullLoadData(), 500);
    };
    document.getElementById('start').addEventListener('input', debounceLoad);
    document.getElementById('end').addEventListener('input', debounceLoad);

    onOnlineToggle();
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

function onOnlineToggle() {
    const online = document.getElementById('online').checked;
    if (online) startPolling();
    else stopPolling();
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
    const online = document.getElementById('online').checked;

    if (!start || !end) return;

    const startDate = new Date(start + ':00');
    const endDate = new Date(end + ':00');
    if (isNaN(startDate) || isNaN(endDate)) return;

    currentInterval = { start: startDate, end: endDate };
    lastDt = null;

    await loadData(currentInterval.start, currentInterval.end, null);
}

async function loadIncremental() {
    if (!currentInterval) return;
    if (!lastDt) {
        await fullLoadData();
        return;
    }
    await loadData(currentInterval.start, currentInterval.end, lastDt);
}

async function loadData(start, end, since = null) {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    const column = document.getElementById('column').value;
    const online = document.getElementById('online').checked;

    const startISO = start.toISOString();
    const endISO = end.toISOString();
    const dtInterval = `${startISO}/${endISO}`;
    const xParam = JSON.stringify([{ dt_interval: dtInterval }]);

    const url = new URL('/api/trends', window.location.origin);
    url.searchParams.append('x', xParam);
    url.searchParams.append('y', column);
    url.searchParams.append('online', online ? 'true' : 'false');
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

        if (result.data.length === 0) return;

        if (since) {
            // Инкрементальная загрузка: добавляем только новые записи
            const existingKeys = new Set(rawData.map(item => `${item.dt}_${item.id}`));
            const newUniqueData = result.data.filter(item => !existingKeys.has(`${item.dt}_${item.id}`));
            if (newUniqueData.length) {
                rawData = [...rawData, ...newUniqueData];
                rawData.sort((a, b) => new Date(a.dt) - new Date(b.dt));

                // Ограничиваем размер хранимых данных
                if (rawData.length > MAX_STORED_POINTS) {
                    rawData = rawData.slice(-MAX_STORED_POINTS);
                }
            }
        } else {
            // Полная загрузка: заменяем rawData
            rawData = result.data;
            if (rawData.length > MAX_STORED_POINTS) {
                rawData = rawData.slice(-MAX_STORED_POINTS);
            }
        }

        // Обновляем lastDt (самая поздняя дата) на основе текущего rawData
        if (rawData.length) {
            const lastDate = new Date(rawData[rawData.length - 1].dt);
            lastDt = lastDate;
        } else {
            lastDt = null;
        }

        rebuildFromRawData();
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Ошибка загрузки:', err);
        if (!online) alert('Не удалось загрузить данные: ' + err.message);
    }
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
                                const timeStr = new Date(point.x).toLocaleString('ru-RU', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit'
                                });
                                return [`${yColumn}: ${point.y}`, `Время: ${timeStr}`];
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
    const onlineCheckbox = document.getElementById('online');
    if (onlineCheckbox.checked) {
        onlineCheckbox.checked = false;
        stopPolling();
    }
    const percent = parseFloat(e.target.value);
    applyVisibleWindow(percent, currentYColumn);
}