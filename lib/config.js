/**
 * Общие настройки, хранилище и форматирование. Подключается и в service worker
 * (importScripts), и в content script, и в popup.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PriceConfig = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: 'append',        // append | replace | tooltip
    source: 'ecb',         // ecb (Европейский ЦБ) | market (рыночный)
    manualRates: {},       // курсы руками: { USD: { value: 95, against: 'RUB' }, SAR: { value: 0.2667, against: 'USD' } }
    scaleOthers: false,    // остальные валюты пересчитывать от своего курса
    disabledHosts: [],
    targetCurrency: 'RUB', // в какую валюту переводить цены
    language: 'auto',      // ru | en | ar | auto (по языку браузера)
  };

  const RATES_TTL_MS = 3 * 60 * 60 * 1000; // 3 часа

  // Валюты, доступные как цель конвертации, и их отображение.
  const CURRENCY_META = {
    RUB: { symbol: '₽', before: false },
    USD: { symbol: '$', before: true },
    EUR: { symbol: '€', before: true },
    GBP: { symbol: '£', before: true },
    CNY: { symbol: '¥', before: true },
    JPY: { symbol: '¥', before: true },
    TRY: { symbol: '₺', before: true },
    AED: { symbol: 'AED', before: false, spaced: true },
    SAR: { symbol: 'SAR', before: false, spaced: true },
    KZT: { symbol: '₸', before: false },
    GEL: { symbol: '₾', before: false },
    THB: { symbol: '฿', before: true },
    PLN: { symbol: 'zł', before: false, spaced: true },
    UAH: { symbol: '₴', before: false },
    INR: { symbol: '₹', before: true },
    KRW: { symbol: '₩', before: true },
    HKD: { symbol: 'HK$', before: true },
    CHF: { symbol: 'CHF', before: false, spaced: true },
    CAD: { symbol: 'C$', before: true },
    AUD: { symbol: 'A$', before: true },
  };

  const LOCALE_FOR_LANG = { ru: 'ru-RU', en: 'en-US', ar: 'ar-SA' };

  const TARGET_CURRENCIES = ['RUB', 'USD', 'EUR', 'GBP', 'CNY', 'TRY', 'AED', 'KZT', 'GEL', 'THB', 'PLN', 'UAH', 'INR', 'KRW', 'HKD', 'CHF', 'CAD', 'AUD'];

  function metaFor(code) {
    return CURRENCY_META[code] || { symbol: code, before: false, spaced: true };
  }

  function symbolFor(code) {
    return metaFor(code).symbol;
  }

  function getSettings() {
    return chrome.storage.local.get('settings').then(function (data) {
      return Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (current) {
      const next = Object.assign({}, current, patch);
      return chrome.storage.local.set({ settings: next }).then(function () {
        return next;
      });
    });
  }

  /**
   * Во сколько раз ручной курс отличается от курса источника.
   * Якорь — USD, затем EUR, затем первая заданная валюта.
   */
  function anchorFactor(rates, settings) {
    if (!rates || !rates.rubPer) return null;
    const manual = (settings && settings.manualRates) || {};
    const order = ['USD', 'EUR'].concat(Object.keys(manual));
    for (const code of order) {
      const entry = manual[code];
      if (!entry || !(entry.value > 0)) continue;
      const mine = rateFor(code, rates, settings);
      const api = rates.rubPer[code];
      if (mine > 0 && api > 0) return mine / api;
    }
    return null;
  }

  /**
   * Курс валюты в рублях с учётом ручных настроек, или null.
   * Свой курс можно задать не только «к рублю», а к любой другой валюте
   * (например «1 SAR = 0.2667 USD») — такие пары разрешаются цепочкой
   * до рубля рекурсивно; циклы («A к B» + «B к A») обрываются и дают null.
   */
  function rateFor(code, rates, settings, _stack) {
    if (code === 'RUB') return 1;
    const manual = (settings && settings.manualRates) || {};
    const entry = manual[code];

    if (entry && entry.value > 0) {
      const against = entry.against || 'RUB';
      if (against === code) return null;
      const stack = _stack || new Set();
      if (stack.has(code)) return null; // циклическая ссылка
      stack.add(code);
      const againstRate = rateFor(against, rates, settings, stack);
      if (!againstRate || !isFinite(againstRate)) return null;
      return entry.value * againstRate;
    }

    const api = rates && rates.rubPer ? rates.rubPer[code] : null;
    if (!api || !isFinite(api)) return null;

    if (settings && settings.scaleOthers) {
      const factor = anchorFactor(rates, settings);
      if (factor) return api * factor;
    }
    return api;
  }

  /** Сумма в рублях или null, если курса нет. Сохранён для обратной совместимости. */
  function toRub(amount, code, rates, settings) {
    return toTarget(amount, code, 'RUB', rates, settings);
  }

  /** Сумма в произвольной целевой валюте (RUB-курс — общий знаменатель), или null. */
  function toTarget(amount, code, targetCode, rates, settings) {
    if (code === targetCode) return amount;
    const rateSrc = rateFor(code, rates, settings);
    const rateDst = rateFor(targetCode, rates, settings);
    if (!rateSrc || !rateDst || !isFinite(rateSrc) || !isFinite(rateDst)) return null;
    return (amount * rateSrc) / rateDst;
  }

  function decimalsFor(value) {
    const abs = Math.abs(value);
    if (abs < 1) return 2;
    if (abs < 100) return 1;
    return 0;
  }

  const numberFormatters = new Map();

  function numberFormat(locale, decimals, numberingSystem) {
    const key = locale + '|' + decimals + '|' + (numberingSystem || '');
    let fmt = numberFormatters.get(key);
    if (!fmt) {
      const opts = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
      if (numberingSystem) opts.numberingSystem = numberingSystem;
      fmt = new Intl.NumberFormat(locale, opts);
      numberFormatters.set(key, fmt);
    }
    return fmt;
  }

  /** Сумма, отформатированная под целевую валюту и язык интерфейса. */
  function formatMoney(value, code, lang, decimals) {
    const d = decimals === undefined ? decimalsFor(value) : decimals;
    const locale = LOCALE_FOR_LANG[lang] || LOCALE_FOR_LANG.ru;
    let num;
    try {
      num = numberFormat(locale, d, lang === 'ar' ? 'latn' : undefined).format(value);
    } catch (e) {
      num = value.toFixed(d);
    }
    const meta = metaFor(code);
    if (meta.before) return meta.symbol + (meta.spaced ? ' ' : '') + num;
    return num + ' ' + meta.symbol;
  }

  /** Совместимость со старым API: рубли, локаль ru-RU. */
  function formatRub(value, decimals) {
    return formatMoney(value, 'RUB', 'ru', decimals);
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {
      return '';
    }
  }

  return {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    RATES_TTL_MS: RATES_TTL_MS,
    TARGET_CURRENCIES: TARGET_CURRENCIES,
    getSettings: getSettings,
    setSettings: setSettings,
    rateFor: rateFor,
    anchorFactor: anchorFactor,
    toRub: toRub,
    toTarget: toTarget,
    formatRub: formatRub,
    formatMoney: formatMoney,
    symbolFor: symbolFor,
    hostOf: hostOf,
  };
});
