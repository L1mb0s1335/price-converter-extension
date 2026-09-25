const C = require('../lib/config.js');

let failed = 0;
let passed = 0;

function eq(label, got, expected) {
  const ok = Math.abs(got - expected) < 1e-6;
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL  ' + label + ': получено ' + got + ', ожидалось ' + expected);
  }
}

const rates = { rubPer: { RUB: 1, USD: 86.47, EUR: 100.5, CNY: 12.1 }, source: 'ЦБ РФ', count: 4, ts: Date.now() };
const base = C.DEFAULT_SETTINGS;

// Без ручных курсов — как у источника
eq('USD по источнику', C.rateFor('USD', rates, base), 86.47);
eq('RUB всегда 1', C.rateFor('RUB', rates, base), 1);

// Ручной курс подменяет только свою валюту
const manualUsd = Object.assign({}, base, { manualRates: { USD: 95 } });
eq('USD ручной', C.rateFor('USD', rates, manualUsd), 95);
eq('EUR остался по источнику', C.rateFor('EUR', rates, manualUsd), 100.5);

// С пересчётом остальных — все валюты масштабируются по якорю USD
const scaled = Object.assign({}, base, { manualRates: { USD: 95 }, scaleOthers: true });
const factor = 95 / 86.47;
eq('USD ручной при пересчёте', C.rateFor('USD', rates, scaled), 95);
eq('EUR пересчитан', C.rateFor('EUR', rates, scaled), 100.5 * factor);
eq('CNY пересчитан', C.rateFor('CNY', rates, scaled), 12.1 * factor);
eq('RUB не масштабируется', C.rateFor('RUB', rates, scaled), 1);

// Якорь — USD, даже если руками заданы несколько валют
const two = Object.assign({}, base, { manualRates: { EUR: 110, USD: 95 }, scaleOthers: true });
eq('CNY по якорю USD', C.rateFor('CNY', rates, two), 12.1 * factor);
eq('EUR берётся свой, а не якорный', C.rateFor('EUR', rates, two), 110);

// Якорь падает на EUR, если USD руками не задан
const eurOnly = Object.assign({}, base, { manualRates: { EUR: 110 }, scaleOthers: true });
eq('USD по якорю EUR', C.rateFor('USD', rates, eurOnly), 86.47 * (110 / 100.5));

// Суммы и наценка
eq('100 USD', C.toRub(100, 'USD', rates, base), 8647);
eq('100 USD по своему курсу', C.toRub(100, 'USD', rates, manualUsd), 9500);
const withMarkup = Object.assign({}, manualUsd, { markup: 5 });
eq('100 USD со своим курсом и наценкой 5%', C.toRub(100, 'USD', rates, withMarkup), 9975);

// Неизвестная валюта
if (C.toRub(10, 'XXX', rates, base) === null) passed++;
else { failed++; console.log('FAIL  неизвестная валюта должна давать null'); }

console.log('\nпройдено ' + passed + ', провалено ' + failed);
process.exit(failed ? 1 : 0);
