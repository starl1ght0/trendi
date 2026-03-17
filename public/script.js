document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;
let pollingInterval = null;
const POLLING_INTERVAL_MS = 5000; // 5 секунд

// Переменные для скролла
let currentData = [];          // последние загруженные точки (с сортировкой)
let totalMinTime = null;
let totalMaxTime = null;
let windowDuration = null;     // длительность видимого окна в мс
const MAX_VISIBLE_POINTS = 50; // максимальное количество точек на экране без скролла

function init() {
    setDefaultDates();
    const onlineCheckbox = document.getElementById('online');
    onlineCheckbox.checked = true; // ONLINE ВКЛЮЧЕН ПО УМОЛЧАНИЮ
    document.getElementById('load-btn').addEventListener('click', () => {
        loadData();
    });
    onlineCheckbox.addEventListener('change', onOnlineToggle);
    // Ползунок
    document.getElementById('timeRange').addEventListener('input', onRangeChange);
    // Запускаем polling (включая первую загрузку)
    onOnlineToggle();
}

function setDefaultDates() {
    const startDate = new Date(2024, 0, 15, 0, 0, 0); // 15 января 2024, 00:00
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
    if (online) {
        startPolling();
    } else {
        stopPolling();
    }
}

function startPolling() {
    if (pollingInterval) return; // уже запущен
    loadData(); // сразу загрузить данные
    pollingInterval = setInterval(() => {
        loadData();
    }, POLLING_INTERVAL_MS);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

async function loadData() {
    if (abortController) {
        abortController.abort();
    }
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
        // Сохраняем данные и обновляем скролл
        updateDataAndScroll(result.data, column);
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Запрос отменён');
        } else {
            console.error('Ошибка загрузки:', err);
            if (!online) {
                alert('Не удалось загрузить данные: ' + err.message);
            }
        }
    }
}

function updateDataAndScroll(newData, yColumn) {
    if (!newData || newData.length === 0) {
        // Если данных нет, скрываем скролл и очищаем график
        document.getElementById('scrollContainer').style.display = 'none';
        updateChart([], yColumn);
        currentData = [];
        return;
    }

    // Преобразуем в точки с временем в мс и сортируем
    const points = newData
        .map(item => ({
            x: new Date(item.send_time).getTime(),
            y: item.value,
            original: item
        }))
        .sort((a, b) => a.x - b.x);

    currentData = points;
    const times = points.map(p => p.x);
    totalMinTime = Math.min(...times);
    totalMaxTime = Math.max(...times);
    const totalPoints = points.length;

    // Определяем, нужен ли скролл
    if (totalPoints > MAX_VISIBLE_POINTS) {
        // Показываем скролл
        document.getElementById('scrollContainer').style.display = 'block';

        // Вычисляем длительность окна, чтобы показывать примерно MAX_VISIBLE_POINTS
        const totalDuration = totalMaxTime - totalMinTime;
        // Если все точки в один момент, защита
        if (totalDuration === 0) {
            windowDuration = 1; // 1 мс
        } else {
            windowDuration = totalDuration * MAX_VISIBLE_POINTS / totalPoints;
        }

        // Устанавливаем ползунок: от 0 до (totalDuration - windowDuration) в мс, но для range используем проценты
        const rangeInput = document.getElementById('timeRange');
        rangeInput.min = 0;
        rangeInput.max = 100; // будем использовать проценты
        // По умолчанию показываем последние MAX_VISIBLE_POINTS (окно справа)
        const defaultLeftTime = totalMaxTime - windowDuration;
        // Переводим в процент: (defaultLeftTime - totalMinTime) / (totalDuration - windowDuration) * 100
        const maxLeft = totalDuration - windowDuration;
        let percent = 100; // если maxLeft == 0, то 100
        if (maxLeft > 0) {
            percent = ((defaultLeftTime - totalMinTime) / maxLeft) * 100;
        }
        rangeInput.value = percent;

        // Если график ещё не создан, создаём его со всеми данными (для инициализации)
        if (!chart) {
            const allPoints = points.map(p => ({ x: new Date(p.x), y: p.y }));
            updateChart(allPoints, yColumn);
        }

        // Применяем видимое окно
        applyVisibleWindow(percent, yColumn);
    } else {
        // Скрываем скролл, показываем все данные
        document.getElementById('scrollContainer').style.display = 'none';
        windowDuration = null;
        // Сбрасываем мин/макс оси (auto)
        if (chart) {
            chart.options.scales.x.min = undefined;
            chart.options.scales.x.max = undefined;
        }
        // Обновляем график со всеми точками
        const chartPoints = points.map(p => ({ x: new Date(p.x), y: p.y }));
        updateChart(chartPoints, yColumn);
    }
}

function applyVisibleWindow(percent, yColumn) {
    if (!chart || !currentData.length || windowDuration === null) return;

    const totalDuration = totalMaxTime - totalMinTime;
    const maxLeft = totalDuration - windowDuration;
    let leftTime;
    if (maxLeft <= 0) {
        leftTime = totalMinTime;
    } else {
        leftTime = totalMinTime + (percent / 100) * maxLeft;
    }
    const rightTime = leftTime + windowDuration;

    // Устанавливаем min и max на оси X
    chart.options.scales.x.min = leftTime;
    chart.options.scales.x.max = rightTime;

    // Фильтруем данные, попадающие в окно (для отображения)
    const visiblePoints = currentData
        .filter(p => p.x >= leftTime && p.x <= rightTime)
        .map(p => ({ x: new Date(p.x), y: p.y }));

    // Обновляем dataset
    chart.data.datasets[0].label = yColumn;
    chart.data.datasets[0].data = visiblePoints;
    chart.update();
}

function onRangeChange(e) {
    // Отключаем online режим при ручном скролле
    const onlineCheckbox = document.getElementById('online');
    if (onlineCheckbox.checked) {
        onlineCheckbox.checked = false;
        stopPolling(); // останавливаем автообновление
    }
    const percent = parseFloat(e.target.value);
    const yColumn = document.getElementById('column').value;
    applyVisibleWindow(percent, yColumn);
}

function updateChart(points, yColumn) {
    if (!points || points.length === 0) {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
        return;
    }

    if (!chart) {
        const ctx = document.getElementById('trendChart').getContext('2d');
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [{
                    label: yColumn,
                    data: points,
                    borderColor: 'rgb(75, 192, 192)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
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
                    x: {
                        type: 'time',
                        time: {
                            unit: 'hour',
                            displayFormats: { hour: 'dd MMM HH:mm' },
                            tooltipFormat: 'dd MMM yyyy HH:mm'
                        },
                        title: { display: true, text: 'Время' }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: yColumn }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const val = context.raw.y;
                                return `${yColumn}: ${val}`;
                            }
                        }
                    }
                }
            }
        });
    } else {
        chart.data.datasets[0].label = yColumn;
        chart.data.datasets[0].data = points;
        // Если скролл неактивен, убедимся что min/max сброшены
        if (windowDuration === null) {
            chart.options.scales.x.min = undefined;
            chart.options.scales.x.max = undefined;
        }
        chart.update();
    }
}