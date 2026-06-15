const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const msgpack = require('msgpack5')();
const { pool, getAppRoot, initDb } = require('./db');

if (!process.env.PORT) {
    require('dotenv').config();
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;

let lastBroadCastedId = 0;

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        try {
            const s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
            const j = JSON.parse(s);
            if (j && j.type === 'ping') {
                ws.send(JSON.stringify({
                    type: 'pong',
                    id: j.id,
                    t: j.t,
                    serverTime: Date.now(),
                }));
            }
        } catch (_) { /* не msgpack-сообщения с клиента игнорируем */ }
    });
});

async function initTracker() {
    const res = await pool.query('SELECT MAX(id) as id FROM data_transmissions');
    lastBroadCastedId = Number(res.rows[0].id) || 0;
}

async function poll() {
    try {
        const res = await pool.query(
            'SELECT dt, id, value, p1, p2 FROM data_transmissions WHERE id > $1 ORDER BY id ASC LIMIT 50',
            [lastBroadCastedId]
        );
        res.rows.forEach(row => {
            const payload = msgpack.encode({ 
                type: 'NEW_DATA', 
                data: {
                    dt: row.dt.toISOString(),
                    id: Number(row.id),
                    value: Number(row.value),
                    p1: Number(row.p1),
                    p2: Number(row.p2)
                } 
            });
            wss.clients.forEach(c => { if(c.readyState === WebSocket.OPEN) c.send(payload); });
            lastBroadCastedId = Number(row.id);
        });
    } catch (e) { console.error(e.message); }
}

setInterval(poll, 1000);

app.use(express.static(path.join(getAppRoot(), 'public')));

app.get('/api/data-range', async (req, res) => {
    const result = await pool.query('SELECT MIN(dt) as min_dt FROM data_transmissions');
    const min = result.rows[0].min_dt;
    res.json({
        success: true,
        min: min ? (min instanceof Date ? min.toISOString() : min) : null,
    });
});

app.get('/api/trends', async (req, res) => {
    try {
        const { x, y = 'value', before, limit = 100 } = req.query;
        const intervals = JSON.parse(x);
        const [startRange, endRange] = intervals[0].dt_interval.split('/');
        
        const col = ['value', 'p1', 'p2'].includes(y) ? y : 'value';
        let referenceTime = before ? new Date(before) : new Date(new Date(endRange).getTime() + 1000);
        let operator = before ? '<' : '<=';

        const query = `
            SELECT dt, id, ${col} AS val FROM data_transmissions
            WHERE dt >= $1 AND dt <= $2 AND dt ${operator} $3
            ORDER BY dt DESC, id DESC LIMIT $4
        `;
        
        const result = await pool.query(query, [new Date(startRange), new Date(endRange), referenceTime, parseInt(limit)]);
        
        const data = result.rows.reverse().map(row => ({
            dt: row.dt.toISOString(),
            id: Number(row.id),
            [y]: Number(row.val) // Динамический ключ колонки
        }));
        
        res.json({ success: true, data });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

initDb().then(() => initTracker()).then(() => {
    server.listen(PORT, '0.0.0.0', () => console.log(`Server: http://localhost:${PORT}`));
});