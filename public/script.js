document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;

function init() {
    // Устанавливаем даты: начало = 2024-01-15 00:00, конец = сейчас
    setDefaultDates();

    document.getElementById('load-btn').addEventListener('click', loadData);
    loadData();
}

function setDefaultDates() {
    // Начало: 15 января 2024 года, 00:00 (локальное время)
    const startDate = new Date(2024, 0, 15, 0, 0, 0); // Месяцы: 0 = январь
    // Конец: текущие дата и время
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

/**
 * Загружает данные с сервера и обновляет график.
 * Используется AbortController для отмены предыдущего запроса.
 */
async function loadData() {
    // Отмена предыдущего запроса
    if (abortController) {
        abortController.abort();
    }
    abortController = new AbortController();

    const column = document.getElementById('column').value;
    const startInput = document.getElementById('start').value;
    const endInput = document.getElementById('end').value;
    const online = document.getElementById('online').checked;

    // Преобразуем строки из input в объекты Date (интерпретируются как локальное время)
    const startDate = new Date(startInput + ':00');
    const endDate = new Date(endInput + ':00');

    if (isNaN(startDate) || isNaN(endDate)) {
        alert('Пожалуйста, укажите корректные даты');
        return;
    }

    // Формируем интервал в формате ISO (UTC)
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();
    const dtInterval = `${startISO}/${endISO}`;

    // Параметр x должен быть JSON-массивом с объектом, содержащим dt_interval
    const xParam = JSON.stringify([{ dt_interval: dtInterval }]);

    // Формируем URL с query-параметрами
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
        updateChart(result.data, column);
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Запрос отменён');
        } else {
            console.error('Ошибка загрузки:', err);
            alert('Не удалось загрузить данные: ' + err.message);
        }
    }
}

/**
 * Обновляет график новыми данными.
 * Ожидается, что каждая точка данных содержит поле send_time в формате ISO и поле value.
 */
function updateChart(data, yColumn) {
    if (!data || data.length === 0) {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
        return;
    }

    // Преобразуем полученные данные в формат, понятный Chart.js (x: Date, y: число)
    const points = data
        .map(item => ({
            x: new Date(item.send_time), // send_time должен быть в ISO
            y: item.value
        }))
        .sort((a, b) => a.x - b.x); // сортируем по времени на всякий случай

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
                scales: {
                    x: {
                        type: 'time',          // временная шкала
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
        chart.update();
    }
}