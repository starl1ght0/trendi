const baseUrl = 'http://localhost:3000';

async function checkServer() {
    const resultDiv = document.getElementById('serverResult');
    const statusDiv = document.getElementById('serverStatus');
    
    statusDiv.className = 'status status-loading';
    statusDiv.textContent = 'Проверка...';
    
    try {
        const response = await fetch(`${baseUrl}/api/test`);
        
        if (response.ok) {
            const data = await response.json();
            resultDiv.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
            statusDiv.className = 'status status-success';
            statusDiv.textContent = 'Подключен';
        } else {
            throw new Error(`HTTP ошибка: ${response.status}`);
        }
        
    } catch (error) {
        resultDiv.innerHTML = `<div style="color: #dc3545;">
            <h3>Ошибка:</h3>
            <p>${error.message}</p>
        </div>`;
        statusDiv.className = 'status status-error';
        statusDiv.textContent = 'Не подключен';
    }
}

async function checkPostgreSQL() {
    const resultDiv = document.getElementById('dbResult');
    const statusDiv = document.getElementById('dbStatus');
    
    statusDiv.className = 'status status-loading';
    statusDiv.textContent = 'Проверка...';
    
    try {
        const response = await fetch(`${baseUrl}/api/data`);
        const data = await response.json();
        
        resultDiv.innerHTML = `
            <pre>${JSON.stringify(data, null, 2)}</pre>
        `;
        
        if (data.source === 'postgresql') {
            statusDiv.className = 'status status-success';
            statusDiv.textContent = 'Подключен';
        } else {
            statusDiv.className = 'status status-error';
            statusDiv.textContent = 'Не подключен';
        }
        
    } catch (error) {
        resultDiv.innerHTML = `Ошибка: ${error.message}`;
        statusDiv.className = 'status status-error';
        statusDiv.textContent = 'Не подключен';
    }
}

window.addEventListener('load', () => {
    checkServer();
});