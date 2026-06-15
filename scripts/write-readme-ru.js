const fs = require('fs');
const path = require('path');

const distRoot = process.argv[2];
if (!distRoot) {
    console.error('Usage: node scripts/write-readme-ru.js <dist-folder>');
    process.exit(1);
}

const text = `TrendChartsForArchivarius - portable

ЗАПУСК: дважды щёлкните TrendCharts.exe
ПЕРЕНОС: скопируйте всю папку TrendChartsPortable на другой компьютер
БАЗА ДАННЫХ: data\\trends.db (копируется вместе с папкой)
ОСТАНОВКА: закройте чёрное окно консоли
АДРЕС: http://localhost:3000

Запасной запуск: TrendCharts.cmd
`;

const readmeRu = path.join(distRoot, 'КАК_ЗАПУСТИТЬ.txt');
fs.writeFileSync(readmeRu, '\uFEFF' + text, 'utf8');
console.log('Wrote', readmeRu);
