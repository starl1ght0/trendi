const http = require('http');
const { exec } = require('child_process');
const path = require('path');

if (process.pkg) {
    process.chdir(path.dirname(process.execPath));
}

require('dotenv').config();

const PORT = Number(process.env.PORT) || 3000;

function openBrowser(url) {
    if (process.platform === 'win32') {
        exec(`start "" "${url}"`, { windowsHide: true });
        return;
    }
    if (process.platform === 'darwin') {
        exec(`open "${url}"`);
        return;
    }
    exec(`xdg-open "${url}"`);
}

function waitForServer(port, attempts = 40) {
    return new Promise((resolve) => {
        let left = attempts;

        const tryOnce = () => {
            const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
                res.resume();
                resolve(true);
            });
            req.on('error', () => {
                left -= 1;
                if (left <= 0) {
                    resolve(false);
                    return;
                }
                setTimeout(tryOnce, 250);
            });
            req.setTimeout(1000, () => {
                req.destroy();
                left -= 1;
                if (left <= 0) {
                    resolve(false);
                    return;
                }
                setTimeout(tryOnce, 250);
            });
        };

        tryOnce();
    });
}

require('./index.js');

waitForServer(PORT).then((ok) => {
    if (ok) {
        openBrowser(`http://localhost:${PORT}`);
        console.log(`Браузер открыт: http://localhost:${PORT}`);
        console.log('Для остановки закройте это окно.');
        return;
    }
    console.error('Не удалось дождаться запуска сервера.');
    process.exit(1);
});
