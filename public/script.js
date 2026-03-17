const baseUrl = 'http://localhost:3000';
let chart = null;
let currentData = [];

// Инициализация графика
function initChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    
    if (chart) {
        chart.destroy();
    }
    
    chart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Значения по времени',
                data: [],
                backgroundColor: 'rgba(102, 126, 234, 0.6)',
                borderColor: 'rgba(102, 126, 234, 1)',
                borderWidth: 1,
                pointRadius: 5,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'XY график трендов (Время vs Значение)',
                    font: { size: 16 }
                },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const point = context.raw;
                            return [
                                `ID: ${point.id}`,
                                `Время: ${point.send_time}`,
                                `Значение: ${point.value}`,
                                `Время выполнения: ${point.execution_time_ms}ms`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: { hour: 'dd.MM HH:mm' },
                        tooltipFormat: 'dd.MM.yyyy HH:mm:ss'
                    },
                    title: {
                        display: true,
                        text: 'Время отправки'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Значение'
                    },
                    beginAtZero: true
                }
            }
        }
    });
}

// Загрузка данных
async function loadData(limit = 10) {
    const sourceSpan = document.getElementById('dataSource');
    sourceSpan.textContent = 'Загрузка...';
    
    try {
        const response = await fetch(`${baseUrl}/api/data?limit=${limit}`);
        const result = await response.json();
        
        currentData = result.data;
        
        // Обновляем источник данных
        const source = result.source === 'postgresql' ? 'PostgreSQL' : 'Тестовые данные';
        sourceSpan.textContent = `Источник: ${source} (${currentData.length} записей)`;
        
        // Обновляем статистику
        updateStats(currentData);
        
        // Обновляем график
        updateChart(currentData);
        
        // Обновляем таблицу
        updateTable(currentData);
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        sourceSpan.textContent = 'Ошибка загрузки';
    }
}

// Загрузка больше данных
function loadMoreData() {
    loadData(50);
}

// Обновление статистики
function updateStats(data) {
    if (!data || data.length === 0) return;
    
    document.getElementById('totalRecords').textContent = data.length;
    
    const avgValue = (data.reduce((sum, item) => sum + item.value, 0) / data.length).toFixed(2);
    document.getElementById('avgValue').textContent = avgValue;
    
    const avgTime = Math.round(data.reduce((sum, item) => sum + (item.execution_time_ms || 0), 0) / data.length);
    document.getElementById('avgTime').textContent = `${avgTime} ms`;
    
    if (data.length > 0) {
        const dates = data.map(item => new Date(item.send_time));
        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));
        document.getElementById('dateRange').textContent = 
            `${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`;
    }
}

// Обновление графика
function updateChart(data) {
    if (!chart) {
        initChart();
    }
    
    const showTimeMs = document.getElementById('showTimeMs').checked;
    
    // Подготавливаем данные для графика
    const chartData = data.map(item => ({
        x: new Date(item.send_time),
        y: item.value,
        id: item.id,
        send_time: item.send_time,
        execution_time_ms: item.execution_time_ms,
        size: showTimeMs ? Math.max(3, Math.min(15, item.execution_time_ms / 50)) : 5
    }));
    
    // Основной датасет
    chart.data.datasets[0].data = chartData;
    chart.data.datasets[0].pointRadius = chartData.map(d => d.size);
    chart.data.datasets[0].backgroundColor = chartData.map(d => 
        d.execution_time_ms > 500 ? 'rgba(220, 53, 69, 0.6)' : 'rgba(102, 126, 234, 0.6)'
    );
    
    chart.update();
}

// Обновление таблицы
function updateTable(data) {
    const tbody = document.getElementById('dataTableBody');
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="loading">Нет данных</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.map(item => {
        let statusClass = '';
        if (item.status) {
            statusClass = `status-${item.status}`;
        }
        
        return `
            <tr>
                <td><span class="${statusClass}">#${item.id}</span></td>
                <td>${item.send_time}</td>
                <td><strong>${item.value}</strong></td>
                <td>${item.execution_time_ms || 0} ms</td>
            </tr>
        `;
    }).join('');
}

// Обновление опций графика
function updateChartOptions() {
    if (currentData.length > 0) {
        updateChart(currentData);
    }
}

// Инициализация при загрузке
window.addEventListener('load', () => {
    initChart();
    loadData();
});