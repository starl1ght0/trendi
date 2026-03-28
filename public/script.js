document.addEventListener('DOMContentLoaded', init);

let chart;
const VIEW_WINDOW = 60; // Сколько точек видим на экране одновременно
const CHUNK_SIZE = 100; // По сколько подгружаем из БД

let loadedPoints = [];
let currentIndex = 0; // На каком индексе массива мы сейчас находимся (левая граница окна)
let earliestLoadedDt = null;
let currentYColumn = 'value';
let isLoading = false;
let hasMore = true;

const mpack = msgpack5();

function init() {
    setDefaultDates();
    
    document.getElementById('toggle-settings').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.toggle('hidden');
    });

    document.getElementById('load-btn').addEventListener('click', () => fullResetAndLoad());

    document.getElementById('column').addEventListener('change', (e) => {
        currentYColumn = e.target.value;
        fullResetAndLoad();
    });

    // Управление скроллом через колесо мыши
    const chartWrapper = document.getElementById('chartWrapper');
    chartWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (loadedPoints.length === 0 || isLoading) return;

        // Чувствительность скролла: e.deltaY > 0 - крутим вниз (в будущее), < 0 - вверх (в прошлое)
        // Но обычно пользователю привычнее: вниз/вправо - вперед, вверх/влево - назад.
        const delta = e.deltaY > 0 ? 3 : -3;
        
        let nextIndex = currentIndex + delta;

        // Ограничения
        const maxPossibleIndex = Math.max(0, loadedPoints.length - VIEW_WINDOW);
        nextIndex = Math.max(0, Math.min(maxPossibleIndex, nextIndex));

        if (nextIndex !== currentIndex) {
            currentIndex = nextIndex;
            updateChartView();

            // Если подошли к левому краю (старые данные), подгружаем историю
            if (currentIndex < 15 && hasMore && !isLoading) {
                loadMoreHistory();
            }
        }
    }, { passive: false });

    fullResetAndLoad();
}

async function fullResetAndLoad() {
    loadedPoints = [];
    currentIndex = 0;
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
    
    const startInput = document.getElementById('start').value;
    const endInput = document.getElementById('end').value;
    if (!startInput || !endInput) return;

    isLoading = true;
    document.getElementById('lastUpdateTime').textContent = "Загрузка...";

    const url = new URL('/api/trends', window.location.origin);
    const xParam = JSON.stringify([{ dt_interval: `${new Date(startInput).toISOString()}/${new Date(endInput).toISOString()}` }]);
    url.searchParams.append('x', xParam);
    url.searchParams.append('y', currentYColumn);
    url.searchParams.append('limit', CHUNK_SIZE);
    
    if (earliestLoadedDt) {
        url.searchParams.append('before', earliestLoadedDt);
    }

    try {
        const response = await fetch(url, { headers: { 'Accept': 'application/x-msgpack' } });
        const buffer = await response.arrayBuffer();
        const result = mpack.decode(new Uint8Array(buffer));

        if (!result.data || result.data.length === 0) {
            hasMore = false;
            isLoading = false;
            updateStatusText();
            return;
        }

        const newPoints = result.data.map(item => ({
            x: new Date(item.dt).getTime(),
            y: item.value,
            label: new Date(item.dt).toLocaleTimeString('ru-RU')
        }));

        const addedCount = newPoints.length;
        earliestLoadedDt = result.data[0].dt;

        // Добавляем данные в начало
        loadedPoints = [...newPoints, ...loadedPoints];

        if (isInitial) {
            // При первой загрузке встаем в самый конец массива (самые новые данные)
            currentIndex = Math.max(0, loadedPoints.length - VIEW_WINDOW);
            initChart();
        } else {
            // КОРРЕКЦИЯ: Чтобы данные под курсором не убежали, 
            // сдвигаем текущий индекс на количество добавленных в начало элементов
            currentIndex += addedCount;
        }

        updateChartView();
        if (result.data.length < CHUNK_SIZE) hasMore = false;

    } catch (err) {
        console.error('Ошибка:', err);
    } finally {
        isLoading = false;
        updateStatusText();
    }
}

function updateStatusText() {
    const total = loadedPoints.length;
    const endIdx = Math.min(currentIndex + VIEW_WINDOW, total);
    document.getElementById('lastUpdateTime').textContent = 
        `Диапазон: ${currentIndex}-${endIdx} (Всего: ${total}) ${hasMore ? '' : '[Конец истории]'}`;
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
                backgroundColor: color + '22',
                borderWidth: 2,
                pointRadius: 1,
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: false, grace: '5%' }
            },
            plugins: {
                legend: { display: false },
                tooltip: { intersect: false, mode: 'index' }
            }
        }
    });
}

function updateChartView() {
    if (!chart || loadedPoints.length === 0) return;

    const visibleData = loadedPoints.slice(currentIndex, currentIndex + VIEW_WINDOW);
    
    chart.data.labels = visibleData.map(p => p.label);
    chart.data.datasets[0].data = visibleData.map(p => p.y);
    chart.update('none'); // Мгновенное обновление
    updateStatusText();
}

function setDefaultDates() {
    const start = new Date();
    start.setHours(start.getHours() - 24); 
    document.getElementById('start').value = start.toISOString().slice(0, 16);
    document.getElementById('end').value = new Date().toISOString().slice(0, 16);
}