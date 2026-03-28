const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const msgpack = require('msgpack5')(); // Инициализация MessagePack
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let pool = null;
let wsClients = new Set();
let currentInterval = { start: null, end: null };
let lastNotifiedDt = null;
let pollingTimer = null;

const requiredEnv = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
for (const envVar of requiredEnv) {
    if (!process.env[envVar]) {
        console.error(`Ошибка: переменная окружения ${envVar} не задана`);
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
            max: 5
        });
        const client = await pool.connect();
        console.log('PostgreSQL подключен');
        client.release();
        return true;
    } catch (error) {
        console.log('Ошибка PostgreSQL:', error.message);
        pool = null;
        return false;
    }
}

// Маршрут получения трендов
app.get('/api/trends', async (req, res) => {
    if (!pool) return res.status(500).json({ success: false, error: 'DB offline' });

    try {
        const { x, y = 'value', before, limit = 100 } = req.query;
        const intervals = JSON.parse(x);
        const [startRange, endRange] = intervals[0].dt_interval.split('/');
        
        const limitNum = parseInt(limit);
        const startTime = new Date(startRange);
        const endTime = new Date(endRange);

        // Если пришел параметр before, ищем данные старше этой даты.
        // Если нет (первая загрузка) — берем самые свежие данные от конца интервала (endTime)
        const referenceTime = before ? new Date(before) : endTime;

        const allowedColumns = ['value', 'p1', 'p2'];
        const col = allowedColumns.includes(y) ? y : 'value';

        // Берем данные в обратном порядке (DESC), чтобы получить ПОСЛЕДНИЕ 100 штук
        const query = `
            SELECT dt, id, ${col} AS value, p1, p2
            FROM data_transmissions
            WHERE dt BETWEEN $1 AND $2
            AND dt < $3
            ORDER BY dt DESC, id DESC
            LIMIT $4
        `;

        const client = await pool.connect();
        const result = await client.query(query, [startTime, endTime, referenceTime, limitNum]);
        client.release();

        // Разворачиваем массив обратно в хронологический порядок для фронтенда
        const data = result.rows.reverse().map(row => ({
            id: row.id,
            dt: row.dt.toISOString(),
            value: row.value,
            p1: row.p1,
            p2: row.p2
        }));

        const responsePayload = {
            success: true,
            data: data,
            count: data.length
        };

        // Если клиент просит MessagePack
        if (req.headers['accept'] === 'application/x-msgpack') {
            res.setHeader('Content-Type', 'application/x-msgpack');
            return res.send(msgpack.encode(responsePayload));
        }

        res.json(responsePayload);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

async function startServer() {
    await testPostgresConnection();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Сервер: http://localhost:${PORT}`);
    });
}

startServer();