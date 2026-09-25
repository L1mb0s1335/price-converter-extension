/**
 * Поиск цен в произвольном тексте и разбор суммы.
 * Работает и в браузере (self.PriceParser), и в Node (module.exports) — чтобы гонять тесты.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PriceParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Небуквенные маркеры: границы слова не требуются ("$5", "цена:€10").
  // Порядок важен — более длинные варианты идут первыми.
  const SYMBOLS = [
    ['US$', 'USD'], ['U$S', 'USD'], ['CA$', 'CAD'], ['AU$', 'AUD'], ['NZ$', 'NZD'],
    ['HK$', 'HKD'], ['NT$', 'TWD'], ['MX$', 'MXN'], ['C$', 'CAD'], ['A$', 'AUD'],
    ['S$', 'SGD'], ['R$', 'BRL'], ['$', 'USD'],
    ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['₩', 'KRW'], ['₹', 'INR'],
    ['₺', 'TRY'], ['₪', 'ILS'], ['₫', 'VND'], ['₱', 'PHP'], ['฿', 'THB'],
    ['₦', 'NGN'], ['₴', 'UAH'], ['₸', 'KZT'], ['₾', 'GEL'], ['₼', 'AZN'],
    ['֏', 'AMD'], ['﷼', 'SAR'], ['⃁', 'SAR'], ['₽', 'RUB'],
  ];

  // Буквенные маркеры: нужны границы, чтобы "USD" не ловился внутри слова.
  const WORDS = [
    // ISO-коды
    ['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['JPY', 'JPY'], ['CNY', 'CNY'],
    ['RMB', 'CNY'], ['CHF', 'CHF'], ['CAD', 'CAD'], ['AUD', 'AUD'], ['NZD', 'NZD'],
    ['SEK', 'SEK'], ['NOK', 'NOK'], ['DKK', 'DKK'], ['PLN', 'PLN'], ['CZK', 'CZK'],
    ['HUF', 'HUF'], ['RON', 'RON'], ['BGN', 'BGN'], ['RSD', 'RSD'], ['TRY', 'TRY'],
    ['UAH', 'UAH'], ['KZT', 'KZT'], ['BYN', 'BYN'], ['GEL', 'GEL'], ['AMD', 'AMD'],
    ['AZN', 'AZN'], ['UZS', 'UZS'], ['KGS', 'KGS'], ['TJS', 'TJS'], ['MDL', 'MDL'],
    ['INR', 'INR'], ['KRW', 'KRW'], ['HKD', 'HKD'], ['SGD', 'SGD'], ['TWD', 'TWD'],
    ['THB', 'THB'], ['VND', 'VND'], ['IDR', 'IDR'], ['MYR', 'MYR'], ['PHP', 'PHP'],
    ['BRL', 'BRL'], ['MXN', 'MXN'], ['ARS', 'ARS'], ['CLP', 'CLP'], ['COP', 'COP'],
    ['PEN', 'PEN'], ['ZAR', 'ZAR'], ['EGP', 'EGP'], ['NGN', 'NGN'], ['ILS', 'ILS'],
    ['AED', 'AED'], ['SAR', 'SAR'], ['QAR', 'QAR'], ['KWD', 'KWD'], ['RUB', 'RUB'],
    ['OMR', 'OMR'], ['BHD', 'BHD'], ['JOD', 'JOD'], ['PKR', 'PKR'], ['LKR', 'LKR'],
    // Как валюту пишут в самих магазинах Залива
    ['ر.س', 'SAR'], ['Dhs', 'AED'], ['AED.', 'AED'],
    // Местные написания
    ['zł', 'PLN'], ['Kč', 'CZK'], ['Ft', 'HUF'], ['лв', 'BGN'], ['грн', 'UAH'],
    ['тг', 'KZT'], ['сум', 'UZS'], ['руб', 'RUB'], ['р', 'RUB'],
    // Слова
    ['dollars', 'USD'], ['dollar', 'USD'], ['euros', 'EUR'], ['euro', 'EUR'],
    ['pounds', 'GBP'], ['pound', 'GBP'], ['yen', 'JPY'], ['yuan', 'CNY'],
    ['долларов', 'USD'], ['доллара', 'USD'], ['доллар', 'USD'], ['баксов', 'USD'],
    ['евро', 'EUR'], ['фунтов', 'GBP'], ['фунта', 'GBP'], ['фунт', 'GBP'],
    ['юаней', 'CNY'], ['юаня', 'CNY'], ['юань', 'CNY'], ['иен', 'JPY'], ['йен', 'JPY'],
    ['злотых', 'PLN'], ['тенге', 'KZT'], ['гривен', 'UAH'], ['гривны', 'UAH'],
    ['лир', 'TRY'], ['лиры', 'TRY'], ['дирхам', 'AED'], ['дирхамов', 'AED'],
    ['франков', 'CHF'], ['франка', 'CHF'], ['рублей', 'RUB'], ['рубля', 'RUB'], ['рубль', 'RUB'],
  ];

  // Двухбуквенные маркеры: только через пробел, иначе ловится «SR71 Blackbird».
  const STRICT_WORDS = [
    ['SR', 'SAR'], ['QR', 'QAR'], ['RM', 'MYR'], ['NT', 'TWD'],
  ];

  const MULTIPLIERS = {
    k: 1e3, K: 1e3, m: 1e6, M: 1e6, b: 1e9, B: 1e9, bn: 1e9,
    'тыс': 1e3, 'млн': 1e6, 'млрд': 1e9, 'тр': 1e3,
  };

  const SPACES = ' \\u00A0\\u202F\\u2009\\u2007';
  const GROUP_SEP = '[' + SPACES + ".,'’]";
  const NUM = "\\d{1,3}(?:" + GROUP_SEP + "\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d+)?";
  const MULT = "(?:\\s?(?:bn|[kKmMbB]|тыс|млн|млрд)\\.?)";
  const GAP = '[' + SPACES + ']{0,2}';
  const GAP_STRICT = '[' + SPACES + ']{1,2}';

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function byLengthDesc(a, b) {
    return b[0].length - a[0].length;
  }

  const symAlt = SYMBOLS.slice().sort(byLengthDesc).map((p) => escapeRe(p[0])).join('|');
  const wordAlt = WORDS.slice().sort(byLengthDesc).map((p) => escapeRe(p[0])).join('|');
  const strictAlt = STRICT_WORDS.slice().sort(byLengthDesc).map((p) => escapeRe(p[0])).join('|');

  const NOT_LETTER_BEFORE = '(?<![\\p{L}\\p{N}])';
  const NOT_LETTER_AFTER = '(?![\\p{L}\\p{N}])';

  function buildPattern(gapShort) {
    return (
    // 1. символ + число:  $19.99   €1 000
    '(' + symAlt + ')' + GAP + '((?:' + NUM + '))(' + MULT + ')?' + NOT_LETTER_AFTER +
    // 2. код/слово + число:  USD 20   руб 500
    '|' + NOT_LETTER_BEFORE + '(' + wordAlt + ')\\.?' + GAP + '((?:' + NUM + '))(' + MULT + ')?' + NOT_LETTER_AFTER +
    // 3. число + символ:  19,99 €
    '|(?<![\\p{L}\\p{N}.,])((?:' + NUM + '))(' + MULT + ')?' + GAP + '(' + symAlt + ')' +
    // 4. число + код/слово:  20 USD   500 злотых
    '|(?<![\\p{L}\\p{N}.,])((?:' + NUM + '))(' + MULT + ')?' + GAP + '(' + wordAlt + ')\\.?' + NOT_LETTER_AFTER +
    // 5. короткий маркер + пробел + число:  SR 399
    '|' + NOT_LETTER_BEFORE + '(' + strictAlt + ')\\.?' + gapShort + '((?:' + NUM + '))(' + MULT + ')?' + NOT_LETTER_AFTER +
    // 6. число + пробел + короткий маркер:  399 SR
    '|(?<![\\p{L}\\p{N}.,])((?:' + NUM + '))(' + MULT + ')?' + gapShort + '(' + strictAlt + ')' + NOT_LETTER_AFTER
    );
  }

  const PATTERN_STRICT = buildPattern(GAP_STRICT);
  const PATTERN_RELAXED = buildPattern(GAP);

  /**
   * @param {boolean} relaxShort разрешить «SR180» без пробела. Годится только
   * для склейки соседних элементов, где пробел съеден вёрсткой, а не текстом.
   */
  function makeRegex(relaxShort) {
    return new RegExp(relaxShort ? PATTERN_RELAXED : PATTERN_STRICT, 'gu');
  }

  const SYMBOL_TO_CODE = new Map(SYMBOLS);
  const WORD_TO_CODE = new Map();
  for (const [w, c] of WORDS.concat(STRICT_WORDS)) WORD_TO_CODE.set(w.toLowerCase(), c);

  /**
   * "1 234,56" -> 1234.56, "1,500" -> 1500, "0.75" -> 0.75
   */
  function parseAmount(raw) {
    let s = String(raw).replace(/[\s    '’]/g, '');
    const dot = s.lastIndexOf('.');
    const comma = s.lastIndexOf(',');

    if (dot !== -1 && comma !== -1) {
      // Десятичный разделитель — тот, что правее.
      const decIdx = Math.max(dot, comma);
      const intPart = s.slice(0, decIdx).replace(/[.,]/g, '');
      const frac = s.slice(decIdx + 1);
      return Number(intPart + '.' + frac);
    }

    const sep = dot !== -1 ? '.' : comma !== -1 ? ',' : null;
    if (!sep) return Number(s);

    const parts = s.split(sep);
    if (parts.length > 2) return Number(parts.join('')); // 1.234.567
    const frac = parts[1];
    // Ровно три цифры после разделителя — это разряды тысяч ($1,500 / €1.500),
    // кроме случаев вида "0.750", где целая часть — ноль.
    if (frac.length === 3 && parts[0] !== '0' && parts[0] !== '') return Number(parts.join(''));
    return Number(parts[0] + '.' + frac);
  }

  function applyMultiplier(value, multRaw) {
    if (!multRaw) return value;
    const key = multRaw.replace(/[\s. ]/g, '');
    const factor = MULTIPLIERS[key] || MULTIPLIERS[key.toLowerCase()];
    return factor ? value * factor : value;
  }

  /**
   * @returns {Array<{start:number,end:number,code:string,amount:number,raw:string}>}
   */
  function findPrices(text, options) {
    if (!text || text.length < 2 || !/\d/.test(text)) return [];
    const re = makeRegex(options && options.relaxShort);
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0] === '') { re.lastIndex++; continue; }
      let code = null;
      let numRaw = null;
      let multRaw = null;
      let short = false;

      if (m[1] !== undefined) {
        code = SYMBOL_TO_CODE.get(m[1]);
        numRaw = m[2];
        multRaw = m[3];
      } else if (m[4] !== undefined) {
        code = WORD_TO_CODE.get(m[4].toLowerCase());
        numRaw = m[5];
        multRaw = m[6];
      } else if (m[9] !== undefined) {
        code = SYMBOL_TO_CODE.get(m[9]);
        numRaw = m[7];
        multRaw = m[8];
      } else if (m[12] !== undefined) {
        code = WORD_TO_CODE.get(m[12].toLowerCase());
        numRaw = m[10];
        multRaw = m[11];
      } else if (m[13] !== undefined) {
        code = WORD_TO_CODE.get(m[13].toLowerCase());
        numRaw = m[14];
        multRaw = m[15];
        short = true;
      } else if (m[18] !== undefined) {
        code = WORD_TO_CODE.get(m[18].toLowerCase());
        numRaw = m[16];
        multRaw = m[17];
        short = true;
      }

      if (!code || !numRaw) continue;
      const amount = applyMultiplier(parseAmount(numRaw), multRaw);
      if (!isFinite(amount) || amount <= 0) continue;

      out.push({ start: m.index, end: m.index + m[0].length, code: code, amount: amount, raw: m[0], short: short });
    }
    return out;
  }

  return {
    findPrices: findPrices,
    parseAmount: parseAmount,
    makeRegex: makeRegex,
    SYMBOLS: SYMBOLS,
    WORDS: WORDS,
    STRICT_WORDS: STRICT_WORDS,
    KNOWN_CODES: Array.from(new Set(SYMBOLS.map((p) => p[1]).concat(WORDS.map((p) => p[1]), STRICT_WORDS.map((p) => p[1])))),
  };
});
