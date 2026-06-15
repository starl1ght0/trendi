/**
 * Однократный перенос данных из PostgreSQL в локальный SQLite (data/trends.db).
 * Запуск на компьютере, где ещё доступна старая PostgreSQL-база:
 *   node scripts/export-pg-to-sqlite.js
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const initSqlJs = require('sql.js');

const pgPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
});

const sqlitePath = path.resolve(
    process.env.DB_PATH || path.join(__dirname, '..', 'data', 'trends.db')
);

async function exportData() {
    if (!process.env.DB_NAME || !process.env.DB_USER) {
        console.error('Укажите DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD в .env');
        process.exit(1);
    }

    const dataDir = path.dirname(sqlitePath);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(sqlitePath)) {
        const backup = `${sqlitePath}.backup-${Date.now()}`;
        fs.copyFileSync(sqlitePath, backup);
        console.log(`Старая SQLite-база сохранена: ${backup}`);
        fs.unlinkSync(sqlitePath);
    }

    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    sqlite.run(`
        CREATE TABLE data_transmissions (
            id INTEGER PRIMARY KEY,
            dt TEXT NOT NULL,
            value REAL,
            p1 REAL,
            p2 REAL
        )
    `);
    sqlite.run('CREATE INDEX idx_data_transmissions_dt ON data_transmissions(dt)');
    sqlite.run('CREATE INDEX idx_data_transmissions_id ON data_transmissions(id)');

    const insert = sqlite.prepare(`
        INSERT INTO data_transmissions (id, dt, value, p1, p2)
        VALUES (?, ?, ?, ?, ?)
    `);

    const batchSize = 5000;
    let offset = 0;
    let total = 0;

    console.log('Экспорт из PostgreSQL...');

    while (true) {
        const res = await pgPool.query(
            `SELECT id, dt, value, p1, p2
             FROM data_transmissions
             ORDER BY id
             LIMIT $1 OFFSET $2`,
            [batchSize, offset]
        );

        if (res.rows.length === 0) break;

        sqlite.run('BEGIN');
        for (const row of res.rows) {
            insert.run([
                Number(row.id),
                row.dt instanceof Date ? row.dt.toISOString() : String(row.dt),
                row.value == null ? null : Number(row.value),
                row.p1 == null ? null : Number(row.p1),
                row.p2 == null ? null : Number(row.p2),
            ]);
        }
        sqlite.run('COMMIT');

        total += res.rows.length;
        offset += batchSize;
        process.stdout.write(`\rЭкспортировано строк: ${total}`);
    }

    insert.free();
    const data = sqlite.export();
    fs.writeFileSync(sqlitePath, Buffer.from(data));
    sqlite.close();

    console.log(`\nГотово: ${sqlitePath} (${total} строк)`);
    await pgPool.end();
}

exportData().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
