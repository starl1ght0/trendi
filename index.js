const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let pool = null;

async function testPostgresConnection() {
    try {
        pool = new Pool({
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT) || 5432,
            database: process.env.DB_NAME || 'trendstest',
            user: process.env.DB_USER || 'postgres',
            password: process.env.DB_PASSWORD || 'admin',
            max: 5,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000
        });

        const client = await pool.connect();
        console.log('PostgreSQL подключен');
        
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'data_transmissions'
            )
        `);
        
        if (tableExists.rows[0].exists) {
            console.log('Таблица data_transmissions найдена');
        }
        
        client.release();
        return true;
    } catch (error) {
        console.log('Ошибка PostgreSQL:', error.message);
        pool = null;
        return false;
    }
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Сервер работает',
        timestamp: new Date().toISOString(),
        port: PORT
    });
});

app.get('/api/data', async (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    
    try {
        if (pool) {
            const client = await pool.connect();
            const result = await client.query(`
                SELECT id, send_time, value, execution_time_ms
                FROM data_transmissions 
                ORDER BY send_time DESC 
                LIMIT $1
            `, [limit]);
            client.release();
            
            const data = result.rows.map(row => ({
                id: row.id,
                send_time: new Date(row.send_time).toLocaleString('ru-RU'),
                value: row.value,
                execution_time_ms: row.execution_time_ms,
                status: row.value > 800 ? 'error' : row.value > 500 ? 'warning' : 'success'
            }));
            
            res.json({
                success: true,
                source: 'postgresql',
                count: data.length,
                timestamp: new Date().toISOString(),
                data: data
            });
        } else {
            const testData = generateTestData(limit);
            
            res.json({
                success: true,
                source: 'test',
                count: testData.length,
                timestamp: new Date().toISOString(),
                data: testData
            });
        }
    } catch (error) {
        console.log('Ошибка:', error.message);
        
        const testData = generateTestData(limit);
        res.json({
            success: true,
            source: 'test_fallback',
            count: testData.length,
            timestamp: new Date().toISOString(),
            data: testData
        });
    }
});

function generateTestData(count = 10) {
    const data = [];
    const now = new Date();
    
    for (let i = 1; i <= count; i++) {
        const baseValue = 300 + i * 10;
        const randomVariation = Math.floor(Math.random() * 200) - 100;
        
        data.push({
            id: i,
            send_time: new Date(now.getTime() - (count - i) * 3600000).toLocaleString('ru-RU'),
            value: baseValue + randomVariation,
            execution_time_ms: Math.floor(Math.random() * 300) + 50,
            status: baseValue + randomVariation > 800 ? 'error' : 
                   baseValue + randomVariation > 500 ? 'warning' : 'success'
        });
    }
    
    return data;
}

async function startServer() {
    console.log('Проверка PostgreSQL...');
    const dbConnected = await testPostgresConnection();
    
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Сервер запущен: http://localhost:${PORT}`);
        console.log(`База данных: ${dbConnected ? 'Подключена' : 'Не подключена'}`);
    });
}

startServer().catch(error => {
    console.error('Ошибка запуска:', error);
});