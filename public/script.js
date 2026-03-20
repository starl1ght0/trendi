document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;
let pollingInterval = null;
const POLLING_INTERVAL_MS = 5000;

let currentData = [];
const MAX_VISIBLE_POINTS = 30;
let currentVisiblePoints = [];

function init() {
    setDefaultDates();
    const onlineCheckbox = document.getElementById('online');
    onlineCheckbox.checked = true;

    document.getElementById('toggle-settings').addEventListener('click', toggleSettings);
    document.getElementById('load-btn').addEventListener('click', () => loadData());
    onlineCheckbox.addEventListener('change', onOnlineToggle);
    document.getElementById('line-color').addEventListener('change', () => {
        if (chart && currentVisiblePoints.length) updateChartCurrentColor();
    });

    const timeRange = document.getElementById('timeRange');
    timeRange.addEventListener('input', onRangeChange);
    // Предотвращаем стандартное перетаскивание, чтобы избежать перечёркнутого курсора
    timeRange.addEventListener('dragstart', (e) => e.preventDefault());

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
    loadData();
    pollingInterval = setInterval(() => loadData(), POLLING_INTERVAL_MS);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

async function loadData() {
    if (abortController) abortController.abort();
    abortController = new AbortController();

    const column = document.getElementById('column').value;
    const startInput = document.getElementById('start').value;
    const endInput = document.getElementById('end').value;
    const online = document.getElementById('online').checked;

    let startDate, endDate;

    if (!startInput) {
        alert('Укажите дату начала');
        return;
    }
    startDate = new Date(startInput + ':00');
    if (isNaN(startDate)) {
        alert('Некорректная дата начала');
        return;
    }

    if (online) {
        endDate = new Date();
        document.getElementById('end').value = formatDateTimeLocal(endDate);
    } else {
        if (!endInput) {
            alert('Укажите дату конца');
            return;
        }
        endDate = new Date(endInput + ':00');
        if (isNaN(endDate)) {
            alert('Некорректная дата конца');
            return;
        }
    }

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    const dtInterval = `${startISO}/${endISO}`;
    const xParam = JSON.stringify([{ dt_interval: dtInterval }]);

    const url = new URL('/api/trends', window.location.origin);
    url.searchParams.append('x', xParam);
    url.searchParams.append('y', column);
    url.searchParams.append('online', online ? 'true' : 'false');

    try {
        const response = await fetch(url, { signal: abortController.signal });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Ошибка HTTP: ${response.status}`);
        }
        const result = await response.json();
        updateDataAndScroll(result.data, column);
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Ошибка загрузки:', err);
        if (!online) alert('Не удалось загрузить данные: ' + err.message);
    }
}

function updateDataAndScroll(newData, yColumn) {
    if (!newData || newData.length === 0) {
        document.getElementById('scrollContainer').style.display = 'none';
        updateChartWithUniformSpacing([], yColumn);
        currentData = [];
        currentVisiblePoints = [];
        return;
    }

    const points = newData
        .map(item => ({
            x: new Date(item.send_time).getTime(),
            y: item.value,
            executionTime: item.execution_time_ms,
            original: item
        }))
        .sort((a, b) => a.x - b.x);

    currentData = points;

    const totalPoints = currentData.length;

    if (totalPoints > MAX_VISIBLE_POINTS) {
        document.getElementById('scrollContainer').style.display = 'block';

        const rangeInput = document.getElementById('timeRange');
        rangeInput.min = 0;
        rangeInput.max = 100;

        // По умолчанию показываем последние 30 точек (скролл справа)
        const maxStartIndex = totalPoints - MAX_VISIBLE_POINTS;
        let percent = 100;
        rangeInput.value = percent;

        const startIndex = Math.round((percent / 100) * maxStartIndex);
        const visiblePoints = currentData.slice(startIndex, startIndex + MAX_VISIBLE_POINTS);

        updateChartWithUniformSpacing(visiblePoints, yColumn);
    } else {
        document.getElementById('scrollContainer').style.display = 'none';
        updateChartWithUniformSpacing(currentData, yColumn);
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
                                const lines = [`${yColumn}: ${point.y}`, `Время: ${timeStr}`];
                                if (point.executionTime !== undefined && point.executionTime !== null) {
                                    lines.push(`execution_time_ms: ${point.executionTime}`);
                                }
                                return lines;
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
    const yColumn = document.getElementById('column').value;
    applyVisibleWindow(percent, yColumn);
}