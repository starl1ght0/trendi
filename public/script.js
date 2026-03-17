document.addEventListener('DOMContentLoaded', init);

let chart;
let abortController = null;
let pollingInterval = null;
const POLLING_INTERVAL_MS = 5000; // 5 секунд (можно изменить)

function init() {
    setDefaultDates();
    const onlineCheckbox = document.getElementById('online');
    onlineCheckbox.checked = true; // ONLINE ВКЛЮЧЕН ПО УМОЛЧАНИЮ
    document.getElementById('load-btn').addEventListener('click', () => {
        loadData();
    });
    onlineCheckbox.addEventListener('change', onOnlineToggle);
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
        const endInput = document.getElementById('end').value;
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
        updateChart(result.data, column);
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

function updateChart(data, yColumn) {
    if (!data || data.length === 0) {
        if (chart) {
            chart.data.labels = [];
            chart.data.datasets[0].data = [];
            chart.update();
        }
        return;
    }

    const points = data
        .map(item => ({
            x: new Date(item.send_time),
            y: item.value
        }))
        .sort((a, b) => a.x - b.x);

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
        chart.update();
    }
}