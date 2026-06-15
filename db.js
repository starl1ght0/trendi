const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

function getAppRoot() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return path.resolve(__dirname);
}

function getDbPath() {
    const fromEnv = process.env.DB_PATH;
    if (fromEnv) {
        return path.isAbsolute(fromEnv) ? fromEnv : path.join(getAppRoot(), fromEnv);
    }
    return path.join(getAppRoot(), 'data', 'trends.db');
}

function ensureDataDir(dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

let dbInstance = null;
let dbPathCached = null;

function createSchema(db) {
    db.run(`
        CREATE TABLE IF NOT EXISTS data_transmissions (
            id INTEGER PRIMARY KEY,
            dt TEXT NOT NULL,
            value REAL,
            p1 REAL,
            p2 REAL
        )
    `);
    db.run('CREATE INDEX IF NOT EXISTS idx_data_transmissions_dt ON data_transmissions(dt)');
    db.run('CREATE INDEX IF NOT EXISTS idx_data_transmissions_id ON data_transmissions(id)');
}

function saveDb() {
    if (!dbInstance || !dbPathCached) return;
    const data = dbInstance.export();
    fs.writeFileSync(dbPathCached, Buffer.from(data));
}

function parseDt(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    return new Date(value);
}

function rowWithDate(row) {
    if (!row) return row;
    if (row.dt !== undefined) {
        return { ...row, dt: parseDt(row.dt) };
    }
    if (row.min_dt !== undefined) {
        return { ...row, min_dt: parseDt(row.min_dt) };
    }
    return row;
}

function normalizeParam(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return value;
}

function normalizeParams(params) {
    return params.map(normalizeParam);
}

function toSqliteParams(sql, params) {
    const converted = sql.replace(/\$(\d+)/g, '?');
    return { sql: converted, params: normalizeParams(params) };
}

function selectAll(db, sql, params) {
    const stmt = db.prepare(sql);
    try {
        if (params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
            rows.push(rowWithDate(stmt.getAsObject()));
        }
        return rows;
    } finally {
        stmt.free();
    }
}

async function initDb() {
    if (dbInstance) return dbInstance;

    const SQL = await initSqlJs();
    dbPathCached = getDbPath();
    ensureDataDir(dbPathCached);

    if (fs.existsSync(dbPathCached)) {
        const buffer = fs.readFileSync(dbPathCached);
        dbInstance = new SQL.Database(buffer);
    } else {
        dbInstance = new SQL.Database();
        createSchema(dbInstance);
        saveDb();
    }

    return dbInstance;
}

function getDb() {
    if (!dbInstance) {
        throw new Error('База не инициализирована. Вызовите initDb() перед запросами.');
    }
    return dbInstance;
}

const pool = {
    async query(sql, params = []) {
        const db = getDb();
        const { sql: normalizedSql, params: boundParams } = toSqliteParams(sql.trim(), params);
        const isSelect = /^SELECT/i.test(normalizedSql);

        if (isSelect) {
            return { rows: selectAll(db, normalizedSql, boundParams) };
        }

        const stmt = db.prepare(normalizedSql);
        try {
            if (boundParams.length) stmt.bind(boundParams);
            stmt.step();
            const changes = db.getRowsModified();
            return { rows: [], rowCount: changes };
        } finally {
            stmt.free();
            saveDb();
        }
    },
};

process.on('exit', saveDb);
process.on('SIGINT', () => {
    saveDb();
    process.exit(0);
});
process.on('SIGTERM', () => {
    saveDb();
    process.exit(0);
});

module.exports = {
    pool,
    initDb,
    getAppRoot,
    getDbPath,
    getDb,
    saveDb,
};
