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
const MAX_VISIBLE_POINTS = 30; // максимальное количество точек на экране без скролла

// Контейнер для кастомных линий
let linesContainer = null;

function init() {
    setDefaultDates();
    const onlineCheckbox = document.getElementById('online');
    onlineCheckbox.checked = true; // ONLINE ВКЛЮЧЕН ПО УМОЛЧАНИЮ
    
    // Создаём контейнер для линий
    createLinesContainer();
    
    // Обработчик для кнопки настроек
    document.getElementById('toggle-settings').addEventListener('click', toggleSettings);
    
    // Обработчики для фиксированных элементов
    document.getElementById('load-btn').addEventListener('click', () => {
        loadData();
    });
    onlineCheckbox.addEventListener('change', onOnlineToggle);
    
    // Обработчик для изменения цвета линии
    document.getElementById('line-color').addEventListener('change', () => {
        // Если есть данные, обновляем цвет графика
        if (chart && currentData.length > 0) {
            updateChartCurrentColor();
        }
    });
    
    // Обработчик для включения/отключения пунктирных линий
    document.getElementById('show-gridlines').addEventListener('change', () => {
        updateGridLines();
    });
    
    // Ползунок
    document.getElementById('timeRange').addEventListener('input', onRangeChange);
    
    // Запускаем polling (включая первую загрузку)
    onOnlineToggle();
}

// Создание контейнера для кастомных линий
function createLinesContainer() {
    const chartContainer = document.querySelector('.chart-container');
    if (chartContainer) {
        linesContainer = document.createElement('div');
        linesContainer.className = 'custom-lines-container';
        chartContainer.appendChild(linesContainer);
    }
}

// Обновление пунктирных линий
function updateGridLines() {
    if (!linesContainer || !chart || !currentData.length) return;
    
    const showLines = document.getElementById('show-gridlines').checked;
    linesContainer.innerHTML = ''; // очищаем старые линии
    
    if (!showLines) return;
    
    const canvas = document.getElementById('trendChart');
    const rect = canvas.getBoundingClientRect();
    const chartArea = chart.chartArea;
    
    if (!chartArea || rect.width === 0) return;
    
    // Получаем текущие индексы видимых точек
    const visibleIndices = getVisibleIndices();
    
    // Для каждой видимой точки создаём линию
    visibleIndices.forEach(index => {
        const point = currentData[index];
        
        // Конвертируем индекс в координату X (равномерное распределение)
        const totalVisiblePoints = visibleIndices.length;
        const pointPosition = visibleIndices.indexOf(index) / (totalVisiblePoints - 1);
        const xPos = chartArea.left + pointPosition * (chartArea.right - chartArea.left);
        
        // Создаём линию
        const line = document.createElement('div');
        line.className = 'time-grid-line';
        line.style.left = xPos + 'px';
        line.style.top = chartArea.top + 'px';
        line.style.height = (chartArea.bottom - chartArea.top) + 'px';
        linesContainer.appendChild(line);
        
        // Создаём метку времени
        const marker = document.createElement('div');
        marker.className = 'time-marker';
        marker.style.left = xPos + 'px';
        
        const date = new Date(point.x);
        marker.textContent = date.toLocaleString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        
        linesContainer.appendChild(marker);
    });
}

// Получение индексов видимых точек
function getVisibleIndices() {
    if (!currentData.length) return [];
    
    if (windowDuration === null) {
        // Показываем все точки
        return currentData.map((_, index) => index);
    } else {
        // Показываем точки в текущем окне
        const leftTime = chart.scales.x.min;
        const rightTime = chart.scales.x.max;
        
        return currentData
            .map((point, index) => ({ point, index }))
            .filter(item => item.point.x >= leftTime && item.point.x <= rightTime)
            .map(item => item.index);
    }
}

// Функция для обновления цвета текущего графика
function updateChartCurrentColor() {
    if (!chart) return;
    const color = document.getElementById('line-color').value;
    chart.data.datasets[0].borderColor = color;
    chart.data.datasets[0].backgroundColor = color + '33'; // добавляем прозрачность 20%
    chart.update();
}

function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    panel.classList.toggle('hidden');
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
        updateChartWithUniformSpacing([], yColumn);
        currentData = [];
        updateTimeScale(null, null);
        if (linesContainer) linesContainer.innerHTML = '';
        return;
    }

    // Преобразуем в точки с временем в мс и сортируем
    // Сохраняем execution_time_ms из оригинальных данных
    const points = newData
        .map(item => ({
            x: new Date(item.send_time).getTime(),
            y: item.value,
            executionTime: item.execution_time_ms, // Сохраняем execution_time_ms
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
            updateChartWithUniformSpacing(points, yColumn);
        }

        // Применяем видимое окно
        applyVisibleWindow(percent, yColumn);
    } else {
        // Скрываем скролл, показываем все данные
        document.getElementById('scrollContainer').style.display = 'none';
        windowDuration = null;
        // Обновляем график со всеми точками
        updateChartWithUniformSpacing(points, yColumn);
        updateTimeScale(totalMinTime, totalMaxTime);
    }
}

// Функция для обновления графика с равномерным расположением точек
function updateChartWithUniformSpacing(points, yColumn) {
    if (!points || points.length === 0) {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
        return;
    }

    // Получаем выбранный цвет
    const lineColor = document.getElementById('line-color').value;
    // Создаём полупрозрачный цвет для заливки (20% прозрачности)
    const fillColor = lineColor + '33';

    // Создаём массив подписей для оси X (время)
    const labels = points.map(point => {
        const date = new Date(point.x);
        return date.toLocaleString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    });

    // Сохраняем executionTime для использования в тултипе
    const executionTimes = points.map(point => point.executionTime);

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
                    x: {
                        type: 'category',
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
                                const val = context.raw;
                                const timeStr = labels[context.dataIndex];
                                const execTime = executionTimes[context.dataIndex];
                                const lines = [
                                    `${yColumn}: ${val}`,
                                    `Время: ${timeStr}`
                                ];
                                // Добавляем execution_time_ms, если оно есть
                                if (execTime !== undefined && execTime !== null) {
                                    lines.push(`Выполнено за: ${execTime} ms`);
                                }
                                return lines;
                            },
                            title: () => '' // убираем стандартный заголовок
                        }
                    }
                }
            }
        });
        
        // После создания графика обновляем линии
        setTimeout(updateGridLines, 100);
    } else {
        chart.data.labels = labels;
        chart.data.datasets[0].label = yColumn;
        chart.data.datasets[0].data = points.map(p => p.y);
        chart.data.datasets[0].borderColor = lineColor;
        chart.data.datasets[0].backgroundColor = fillColor;
        
        // Обновляем executionTimes для нового датасета
        // (сохраняем в пользовательском свойстве или пересоздаём тултип)
        chart.update();
        
        // Обновляем линии
        setTimeout(updateGridLines, 50);
    }
    
    // Сохраняем executionTimes в глобальной переменной для доступа из тултипа
    // (альтернативно можно использовать пользовательское свойство датасета)
    window.__executionTimes = executionTimes;
}

// Функция для получения точек в текущем окне с плавным скроллом
function getPointsInWindow(percent) {
    if (!currentData.length || windowDuration === null) return [];
    
    const totalDuration = totalMaxTime - totalMinTime;
    const maxLeft = totalDuration - windowDuration;
    let leftTime;
    
    if (maxLeft <= 0) {
        leftTime = totalMinTime;
    } else {
        leftTime = totalMinTime + (percent / 100) * maxLeft;
    }
    const rightTime = leftTime + windowDuration;
    
    // Получаем все точки в интервале
    const allInWindow = currentData.filter(p => p.x >= leftTime && p.x <= rightTime);
    
    // Если точек больше MAX_VISIBLE_POINTS, равномерно выбираем MAX_VISIBLE_POINTS точек
    if (allInWindow.length > MAX_VISIBLE_POINTS) {
        const step = allInWindow.length / MAX_VISIBLE_POINTS;
        const selected = [];
        for (let i = 0; i < MAX_VISIBLE_POINTS; i++) {
            const index = Math.floor(i * step);
            selected.push(allInWindow[index]);
        }
        return selected;
    }
    
    return allInWindow;
}

function applyVisibleWindow(percent, yColumn) {
    if (!currentData.length || windowDuration === null) return;

    // Получаем точки для отображения с равномерным распределением
    const visiblePoints = getPointsInWindow(percent);
    
    if (visiblePoints.length === 0) return;

    // Получаем временные границы для шкалы
    const leftTime = Math.min(...visiblePoints.map(p => p.x));
    const rightTime = Math.max(...visiblePoints.map(p => p.x));

    // Обновляем график с видимыми точками
    updateChartWithUniformSpacing(visiblePoints, yColumn);
    
    // Обновляем временную шкалу
    updateTimeScale(leftTime, rightTime);
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

// Функция обновления временной шкалы под графиком
function updateTimeScale(startTime, endTime) {
    const startEl = document.getElementById('timeStart');
    const endEl = document.getElementById('timeEnd');
    
    if (!startEl || !endEl) return;
    
    if (startTime && endTime) {
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        
        // Форматируем даты с учётом локали
        const formatOptions = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        };
        
        startEl.textContent = startDate.toLocaleString('ru-RU', formatOptions);
        endEl.textContent = endDate.toLocaleString('ru-RU', formatOptions);
    } else {
        startEl.textContent = '—';
        endEl.textContent = '—';
    }
}

// Добавляем обработчик изменения размера окна для обновления линий
window.addEventListener('resize', () => {
    if (chart && currentData.length > 0) {
        setTimeout(updateGridLines, 100);
    }
});