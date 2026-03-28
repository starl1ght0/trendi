document.addEventListener('DOMContentLoaded', init);

let chart;
const VIEW_WINDOW = 50; // Количество точек в видимой области
const CHUNK_SIZE = 100; // По сколько точек подгружаем из БД

let loadedPoints = [];
let earliestLoadedDt = null;
let currentYColumn = 'value';
let isLoading = false;
let hasMore = true;

const mpack = msgpack5(); // Инициализация декодера

function init() {
    setDefaultDates();
    
    const timeRange = document.getElementById('timeRange');
    
    document.getElementById('toggle-settings').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.toggle('hidden');
    });

    document.getElementById('load-btn').addEventListener('click', () => fullResetAndLoad());

    document.getElementById('column').addEventListener('change', (e) => {
        currentYColumn = e.target.value;
        fullResetAndLoad();
    });

    // Логика скролла (ползунок)
    timeRange.addEventListener('input', (e) => {
        const index = parseInt(e.target.value);
        updateChartView(index);
        
        // Если подошли близко к левому краю (начало массива), подгружаем историю
        if (index < 10 && hasMore && !isLoading) {
            loadMoreHistory(false);
        }
    });

    // Колесо мыши
    document.getElementById('trendChart').addEventListener('wheel', (e) => {
        e.preventDefault();
        let val = parseInt(timeRange.value);
        const delta = e.deltaY > 0 ? -2 : 2;
        timeRange.value = Math.max(0, Math.min(parseInt(timeRange.max), val + delta));
        timeRange.dispatchEvent(new Event('input'));
    }, { passive: false });

    fullResetAndLoad();
}

async function fullResetAndLoad() {
    loadedPoints = [];
    hasMore = true;
    earliestLoadedDt = null;
    if (chart) {
        chart.destroy();
        chart = null;
    }
    await loadMoreHistory(true);
}

async function loadMoreHistory(isInitial = false) {
    if (isLoading || !hasMore) return;
    
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;
    if (!start || !end) return;

    isLoading = true;
    
    const url = new URL('/api/trends', window.location.origin);
    const xParam = JSON.stringify([{ dt_interval: `${new Date(start).toISOString()}/${new Date(end).toISOString()}` }]);
    url.searchParams.append('x', xParam);
    url.searchParams.append('y', currentYColumn);
    url.searchParams.append('limit', CHUNK_SIZE);
    
    if (earliestLoadedDt) {
        url.searchParams.append('before', earliestLoadedDt);
    }

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/x-msgpack' }
        });

        const buffer = await response.arrayBuffer();
        const result = mpack.decode(new Uint8Array(buffer));

        if (!result.data || result.data.length === 0) {
            hasMore = false;
            isLoading = false;
            return;
        }

        const newPoints = result.data.map(item => ({
            x: new Date(item.dt).getTime(),
            y: item.value,
            label: new Date(item.dt).toLocaleTimeString('ru-RU')
        }));

        // Сохраняем дату самой ранней точки для следующего запроса "влево"
        earliestLoadedDt = result.data[0].dt;

        // Сохраняем текущую длину для корректировки скролла
        const addedCount = newPoints.length;
        
        // Добавляем новые (более старые) данные в начало массива
        loadedPoints = [...newPoints, ...loadedPoints];

        const range = document.getElementById('timeRange');
        const maxIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
        range.max = maxIdx;

        if (isInitial) {
            // При первой загрузке показываем последние (самые правые) точки
            range.value = maxIdx;
            initChart();
        } else {
            // Чтобы график не прыгнул при добавлении данных в начало,
            // сдвигаем индекс ползунка вперед на количество добавленных точек
            range.value = parseInt(range.value) + addedCount;
        }

        updateChartView(parseInt(range.value));
        if (result.data.length < CHUNK_SIZE) hasMore = false;

    } catch (err) {
        console.error('Ошибка загрузки:', err);
    } finally {
        isLoading = false;
    }
}

function initChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    const color = document.getElementById('line-color').value;

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: currentYColumn,
                data: [],
                borderColor: color,
                backgroundColor: color + '33',
                borderWidth: 2,
                tension: 0.1,
                pointRadius: 1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: false }
            },
            plugins: { legend: { display: false } }
        }
    });
}

function updateChartView(startIndex) {
    if (!chart || loadedPoints.length === 0) return;

    const visibleData = loadedPoints.slice(startIndex, startIndex + VIEW_WINDOW);
    
    chart.data.labels = visibleData.map(p => p.label);
    chart.data.datasets[0].data = visibleData.map(p => p.y);
    chart.data.datasets[0].label = currentYColumn;
    
    chart.update('none');
    
    document.getElementById('lastUpdateTime').textContent = 
        `Точки: ${startIndex} - ${startIndex + visibleData.length} (Всего в памяти: ${loadedPoints.length})`;
}

function setDefaultDates() {
    const start = new Date();
    start.setHours(start.getHours() - 24); // По умолчанию последние 24 часа
    document.getElementById('start').value = start.toISOString().slice(0, 16);
    document.getElementById('end').value = new Date().toISOString().slice(0, 16);
}