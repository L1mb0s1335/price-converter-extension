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

const rates = { rubPer: { RUB: 1, USD: 86.47, EUR: 100.5, CNY: 12.1 }, source: 'ecb', count: 4, ts: Date.now() };
const base = C.DEFAULT_SETTINGS;

// Без ручных курсов — как у источника
eq('USD по источнику', C.rateFor('USD', rates, base), 86.47);
eq('RUB всегда 1', C.rateFor('RUB', rates, base), 1);

// Ручной курс к рублю подменяет только свою валюту
const manualUsd = Object.assign({}, base, { manualRates: { USD: { value: 95, against: 'RUB' } } });
eq('USD ручной', C.rateFor('USD', rates, manualUsd), 95);
eq('EUR остался по источнику', C.rateFor('EUR', rates, manualUsd), 100.5);

// Ручной курс к произвольной валюте (не к рублю): 1 SAR = 0.2667 USD
const manualChain = Object.assign({}, base, {
  manualRates: { SAR: { value: 0.2667, against: 'USD' } },
});
eq('SAR через USD (источник)', C.rateFor('SAR', rates, manualChain), 0.2667 * 86.47);

// Цепочка из двух ручных курсов: SAR к USD, а USD — тоже свой
const manualDoubleChain = Object.assign({}, base, {
  manualRates: {
    USD: { value: 95, against: 'RUB' },
    SAR: { value: 0.2667, against: 'USD' },
  },
});
eq('SAR через свой USD', C.rateFor('SAR', rates, manualDoubleChain), 0.2667 * 95);

// Циклическая ссылка (A от B, B от A) не должна зависать — просто null
const cyclic = Object.assign({}, base, {
  manualRates: {
    USD: { value: 1, against: 'SAR' },
    SAR: { value: 1, against: 'USD' },
  },
});
if (C.rateFor('USD', rates, cyclic) === null) passed++;
else { failed++; console.log('FAIL  циклическая ссылка должна давать null'); }

// С пересчётом остальных — все валюты масштабируются по якорю USD
const scaled = Object.assign({}, base, { manualRates: { USD: { value: 95, against: 'RUB' } }, scaleOthers: true });
const factor = 95 / 86.47;
eq('USD ручной при пересчёте', C.rateFor('USD', rates, scaled), 95);
eq('EUR пересчитан', C.rateFor('EUR', rates, scaled), 100.5 * factor);
eq('CNY пересчитан', C.rateFor('CNY', rates, scaled), 12.1 * factor);
eq('RUB не масштабируется', C.rateFor('RUB', rates, scaled), 1);

// Якорь — USD, даже если руками заданы несколько валют
const two = Object.assign({}, base, {
  manualRates: { EUR: { value: 110, against: 'RUB' }, USD: { value: 95, against: 'RUB' } },
  scaleOthers: true,
});
eq('CNY по якорю USD', C.rateFor('CNY', rates, two), 12.1 * factor);
eq('EUR берётся свой, а не якорный', C.rateFor('EUR', rates, two), 110);

// Якорь падает на EUR, если USD руками не задан
const eurOnly = Object.assign({}, base, { manualRates: { EUR: { value: 110, against: 'RUB' } }, scaleOthers: true });
eq('USD по якорю EUR', C.rateFor('USD', rates, eurOnly), 86.47 * (110 / 100.5));

// Суммы
eq('100 USD', C.toRub(100, 'USD', rates, base), 8647);
eq('100 USD по своему курсу', C.toRub(100, 'USD', rates, manualUsd), 9500);

// Конверсия между двумя не-рублёвыми валютами через общий курс к рублю
eq('100 USD в EUR', C.toTarget(100, 'USD', 'EUR', rates, base), (100 * 86.47) / 100.5);

// Неизвестная валюта
if (C.toRub(10, 'XXX', rates, base) === null) passed++;
else { failed++; console.log('FAIL  неизвестная валюта должна давать null'); }

console.log('\nпройдено ' + passed + ', провалено ' + failed);
process.exit(failed ? 1 : 0);
