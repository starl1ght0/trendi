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

const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
for (const envVar of requiredEnv) {
    if (!process.env[envVar]) {
        console.error(`Ошибка: переменная окружения ${envVar} не задана в .env`);
        process.exit(1);
    }
}

async function testPostgresConnection() {
    try {
        pool = new Pool({
            host: process.env.DB_HOST,
            port: parseInt(process.env.DB_PORT),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
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
        } else {
            console.warn('Таблица data_transmissions не существует');
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

app.get('/api/trends', async (req, res) => {
    if (!pool) {
        return res.status(500).json({
            success: false,
            error: 'База данных недоступна',
            timestamp: new Date().toISOString()
        });
    }

    try {
        const { x, y = 'value', online = 'false', since } = req.query;

        if (!x) {
            return res.status(400).json({
                success: false,
                error: 'Не указан параметр x (интервал дат)',
                timestamp: new Date().toISOString()
            });
        }

        let intervals;
        try {
            intervals = JSON.parse(x);
            if (!Array.isArray(intervals) || intervals.length === 0) {
                throw new Error('x должен быть непустым массивом');
            }
        } catch (e) {
            return res.status(400).json({
                success: false,
                error: 'Параметр x должен быть валидным JSON-массивом',
                details: e.message,
                timestamp: new Date().toISOString()
            });
        }

        const intervalObj = intervals[0];
        if (!intervalObj.dt_interval || typeof intervalObj.dt_interval !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'Каждый объект интервала должен содержать строковое поле dt_interval',
                timestamp: new Date().toISOString()
            });
        }

        const parts = intervalObj.dt_interval.split('/');
        if (parts.length !== 2) {
            return res.status(400).json({
                success: false,
                error: 'dt_interval должен быть в формате "start/end" (ISO даты)',
                timestamp: new Date().toISOString()
            });
        }

        const start = new Date(parts[0]);
        const end = new Date(parts[1]);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                success: false,
                error: 'Некорректный формат даты в dt_interval',
                timestamp: new Date().toISOString()
            });
        }

        const allowedColumns = ['value', 'p1', 'p2'];
        if (!allowedColumns.includes(y)) {
            return res.status(400).json({
                success: false,
                error: `Недопустимая колонка для тренда. Разрешённые: ${allowedColumns.join(', ')}`,
                timestamp: new Date().toISOString()
            });
        }

        const isOnline = online === 'true';

        // Формируем запрос
        let query = `
            SELECT 
                dt,
                id,
                ${y} AS value,
                p1,
                p2
            FROM data_transmissions
            WHERE dt BETWEEN $1 AND $2
        `;
        const params = [start, end];

        // Если передан параметр since (время последней полученной записи), то добавляем условие
        if (since) {
            const sinceDate = new Date(since);
            if (!isNaN(sinceDate.getTime())) {
                query += ` AND dt > $3`;
                params.push(sinceDate);
            }
        }

        query += ` ORDER BY dt ASC, id ASC`;

        const client = await pool.connect();
        const result = await client.query(query, params);
        client.release();

        const data = result.rows.map(row => ({
            id: row.id,
            dt: row.dt.toISOString(),
            value: row.value,
            p1: row.p1,
            p2: row.p2,
            status: row.value > 800 ? 'error' : row.value > 500 ? 'warning' : 'success'
        }));

        res.json({
            success: true,
            source: 'postgresql',
            interval: { start: start.toISOString(), end: end.toISOString() },
            column: y,
            online: isOnline,
            count: data.length,
            timestamp: new Date().toISOString(),
            data: data
        });

    } catch (error) {
        console.error('Ошибка при обработке запроса /api/trends:', error.message);
        res.status(500).json({
            success: false,
            error: 'Внутренняя ошибка сервера',
            details: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

async function startServer() {
    console.log('Проверка PostgreSQL...');
    const dbConnected = await testPostgresConnection();

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Сервер запущен: http://localhost:${PORT}`);
        console.log(`База данных: ${dbConnected ? 'Подключена' : 'Не подключена'}`);
        if (!dbConnected) {
            console.warn('Внимание: все запросы к /api/trends будут возвращать ошибку 500, так как тестовые данные отключены.');
        }
    });
}

startServer().catch(error => {
    console.error('Ошибка запуска:', error);
});