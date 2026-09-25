const P = require('../lib/parser.js');

let failed = 0;
let passed = 0;

function check(text, expected) {
  const got = P.findPrices(text).map((p) => p.code + ':' + p.amount);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL  ' + JSON.stringify(text) + '\n  ожидалось ' + JSON.stringify(expected) + '\n  получено  ' + JSON.stringify(got));
  }
}

// Символ слева
check('$19.99', ['USD:19.99']);
check('Всего $1,500 за штуку', ['USD:1500']);
check('€1.500,00', ['EUR:1500']);
check('£0.99', ['GBP:0.99']);
check('C$50', ['CAD:50']);
check('HK$1 200', ['HKD:1200']);
check('$1.2M бюджет', ['USD:1200000']);
check('$49k', ['USD:49000']);

// Символ справа
check('Цена 100$', ['USD:100']);
check('19,99 €', ['EUR:19.99']);
check('1 299 ₽', ['RUB:1299']);
check('5 000 грн', ['UAH:5000']);

// Коды и слова
check('USD 45', ['USD:45']);
check('45 USD', ['USD:45']);
check('20 евро', ['EUR:20']);
check('100 zł', ['PLN:100']);
check('стоит 3 500 тенге', ['KZT:3500']);
check('2.5 млн USD', ['USD:2500000']);

// Ближний Восток (так пишут в Jarir, Noon, Amazon.ae)
check('SR 399', ['SAR:399']);
check('399 SR', ['SAR:399']);
check('SAR 1,299.00', ['SAR:1299']);
check('﷼ 250', ['SAR:250']);
check('⃁ 250', ['SAR:250']);
check('Dhs 149', ['AED:149']);
check('QR 75', ['QAR:75']);
check('ر.س 350', ['SAR:350']);

// SR как часть слова или модели трогать нельзя
check('SR71 Blackbird', []);
check('MSR 200 model', []);

// Вплотную короткий маркер ловится только в «склеенном» режиме
check('SR180', []);
(function () {
  const relaxed = P.findPrices('SR180', { relaxShort: true }).map((h) => h.code + ':' + h.amount + ':' + h.short);
  if (JSON.stringify(relaxed) === JSON.stringify(['SAR:180:true'])) passed++;
  else { failed++; console.log('FAIL  relaxShort SR180: ' + JSON.stringify(relaxed)); }
  const strict = P.findPrices('SR71 Blackbird', { relaxShort: true }).map((h) => h.code + ':' + h.amount);
  if (JSON.stringify(strict) === JSON.stringify(['SAR:71'])) passed++;
  else { failed++; console.log('FAIL  relaxShort SR71: ' + JSON.stringify(strict)); }
})();

// Несколько цен в одной строке
check('было $100, стало 80 EUR', ['USD:100', 'EUR:80']);

// Не должно срабатывать
check('iPhone 15 Pro', []);
check('версия 2.0.1', []);
check('12.05.2024', []);
check('IPUSD индекс', []);
check('подъезд 5, кв 12', []);
check('WORD2007', []);
check('обновление 5 марта', []);

// Разбор чисел
function num(raw, expected) {
  const got = P.parseAmount(raw);
  if (got === expected) passed++;
  else {
    failed++;
    console.log('FAIL  parseAmount(' + JSON.stringify(raw) + ') = ' + got + ', ожидалось ' + expected);
  }
}
num('1 234,56', 1234.56);
num('1,234.56', 1234.56);
num('1.234.567', 1234567);
num('1,500', 1500);
num('0.750', 0.75);
num('99', 99);
num('12.5', 12.5);

console.log('\nпройдено ' + passed + ', провалено ' + failed);
process.exit(failed ? 1 : 0);
