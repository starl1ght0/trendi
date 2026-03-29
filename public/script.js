document.addEventListener('DOMContentLoaded', init);

let chart;
const VIEW_WINDOW = 50; // Количество точек на экране
const CHUNK_SIZE = 100;

let loadedPoints = []; 
let currentViewStartIdx = 0;
let earliestLoadedDt = null;
let currentYColumn = 'value';
let isLoading = false;
let hasMore = true;
let lastUpdateStr = "никогда";

const mpack = msgpack5();

async function init() {
    await setupInitialDates();
    connectWS();
    
    document.getElementById('toggle-settings').addEventListener('click', () => {
        document.getElementById('settings-panel').classList.toggle('hidden');
    });

    document.getElementById('load-btn').addEventListener('click', async () => {
        document.getElementById('end').value = formatToDateTimeLocal(new Date());
        await fullResetAndLoad();
    });

    document.getElementById('column').addEventListener('change', (e) => {
        currentYColumn = e.target.value;
        fullResetAndLoad();
    });

    document.getElementById('line-color').addEventListener('change', (e) => {
        if (chart) {
            chart.data.datasets[0].borderColor = e.target.value;
            chart.data.datasets[0].backgroundColor = e.target.value + '22';
            chart.update();
        }
    });

    document.getElementById('chartWrapper').addEventListener('wheel', handleWheel, { passive: false });
    fullResetAndLoad();
}

function connectWS() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.binaryType = 'arraybuffer';

    ws.onmessage = (event) => {
        try {
            const msg = mpack.decode(new Uint8Array(event.data));
            if (msg.type === 'NEW_DATA') handleIncomingPoint(msg.data);
        } catch (e) { console.error("WS Decode Error", e); }
    };
    ws.onclose = () => setTimeout(connectWS, 2000);
}

function handleIncomingPoint(point) {
    const val = Number(point[currentYColumn]);
    if (isNaN(val)) return;

    const newPoint = {
        x: new Date(point.dt).getTime(),
        y: val,
        id: Number(point.id),
        fullDate: new Date(point.dt).toLocaleString('ru-RU'),
        shortTime: new Date(point.dt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    if (loadedPoints.some(p => p.id === newPoint.id)) return;

    // Проверка: находится ли пользователь в конце (авто-скролл)
    const isAtEnd = (currentViewStartIdx >= (loadedPoints.length - VIEW_WINDOW - 1));
    
    loadedPoints.push(newPoint);

    if (chart) {
        if (isAtEnd) {
            currentViewStartIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
        }
        updateChartWindow();
    }
    
    lastUpdateStr = new Date().toLocaleTimeString('ru-RU');
}

async function setupInitialDates() {
    try {
        const res = await fetch('/api/data-range');
        const json = await res.json();
        if (json.success && json.min) {
            document.getElementById('start').value = formatToDateTimeLocal(new Date(json.min));
        }
        document.getElementById('end').value = formatToDateTimeLocal(new Date());
    } catch (e) { console.error(e); }
}

async function fullResetAndLoad() {
    loadedPoints = [];
    currentViewStartIdx = 0;
    hasMore = true;
    earliestLoadedDt = null;
    if (chart) { chart.destroy(); chart = null; }
    await loadMoreHistory(true);
}

async function loadMoreHistory(isInitial = false) {
    if (isLoading || !hasMore) return;
    
    const startVal = document.getElementById('start').value;
    const endVal = document.getElementById('end').value;

    isLoading = true;
    document.getElementById('status-bar').textContent = "Загрузка данных...";

    try {
        const url = new URL('/api/trends', window.location.origin);
        const xParam = JSON.stringify([{ dt_interval: `${new Date(startVal).toISOString()}/${new Date(endVal).toISOString()}` }]);
        url.searchParams.append('x', xParam);
        url.searchParams.append('y', currentYColumn);
        url.searchParams.append('limit', CHUNK_SIZE);
        if (earliestLoadedDt) url.searchParams.append('before', earliestLoadedDt);

        const response = await fetch(url);
        const result = await response.json();

        if (result.success && result.data && result.data.length > 0) {
            const newPoints = result.data.map(item => ({
                x: new Date(item.dt).getTime(),
                y: Number(item[currentYColumn]),
                id: Number(item.id),
                fullDate: new Date(item.dt).toLocaleString('ru-RU'),
                shortTime: new Date(item.dt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            }));

            earliestLoadedDt = result.data[0].dt;
            const addedCount = newPoints.length;
            
            loadedPoints = [...newPoints, ...loadedPoints];

            if (isInitial) {
                currentViewStartIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
                initChart();
            } else {
                currentViewStartIdx += addedCount;
            }
            updateChartWindow();
            if (newPoints.length < CHUNK_SIZE) hasMore = false;
        } else {
            hasMore = false;
        }
    } catch (err) { console.error("Ошибка API:", err); }
    finally { 
        isLoading = false; 
        lastUpdateStr = new Date().toLocaleTimeString('ru-RU');
        updateStatusText(); 
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
                backgroundColor: color + '22',
                borderWidth: 2,
                pointRadius: 3,
                tension: 0.1,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    type: 'category', // Равные расстояния
                    grid: {
                        display: true, // Линии вниз
                        color: '#e0e0e0',
                        drawTicks: true
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        font: { size: 10 }
                    }
                },
                y: { 
                    grid: { color: '#f0f0f0' },
                    grace: '10%' 
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: (items) => {
                            const p = loadedPoints[currentViewStartIdx + items[0].dataIndex];
                            return p ? p.fullDate : '';
                        },
                        label: (item) => {
                            const p = loadedPoints[currentViewStartIdx + item.dataIndex];
                            return `ID: ${p.id} | Значение: ${item.formattedValue}`;
                        }
                    }
                }
            }
        }
    });
}

function handleWheel(e) {
    e.preventDefault();
    if (loadedPoints.length === 0 || isLoading || !chart) return;
    
    const delta = e.deltaY > 0 ? 2 : -2;
    let nextIdx = currentViewStartIdx + delta;
    
    const maxIdx = Math.max(0, loadedPoints.length - VIEW_WINDOW);
    nextIdx = Math.max(0, Math.min(maxIdx, nextIdx));

    if (nextIdx !== currentViewStartIdx) {
        currentViewStartIdx = nextIdx;
        updateChartWindow();
        // Подгрузка истории при скролле влево
        if (currentViewStartIdx < 10 && hasMore && !isLoading) loadMoreHistory();
    }
}

function updateChartWindow() {
    if (!chart || loadedPoints.length === 0) return;

    const windowData = loadedPoints.slice(currentViewStartIdx, currentViewStartIdx + VIEW_WINDOW);
    
    chart.data.labels = windowData.map(p => p.shortTime);
    chart.data.datasets[0].data = windowData.map(p => p.y);
    
    chart.update('none'); 
    updateStatusText();
}

function updateStatusText() {
    if (loadedPoints.length === 0) return;
    const endIdx = Math.min(currentViewStartIdx + VIEW_WINDOW - 1, loadedPoints.length - 1);
    const startP = loadedPoints[currentViewStartIdx];
    const endP = loadedPoints[endIdx];
    
    const idRange = (startP && endP) ? `${startP.id}-${endP.id}` : '...';
    document.getElementById('status-bar').textContent = 
        `ID: ${idRange} | Всего: ${loadedPoints.length} | Обновлено: ${lastUpdateStr}`;
}

function formatToDateTimeLocal(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return (new Date(date.getTime() - offset)).toISOString().slice(0, 19);
}