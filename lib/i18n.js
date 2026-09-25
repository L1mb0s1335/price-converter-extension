/**
 * Локализация интерфейса: словари ru/en/ar, подстановка параметров, RTL.
 * Подключается в popup и в content script (для подсказок над ценами).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PriceI18n = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LANGS = ['ru', 'en', 'ar'];

  const DICT = {
    ru: {
      appTitle: 'Конвертер цен',
      modeLabel: 'Режим показа',
      modeAppend: 'Дописывать',
      modeReplace: 'Заменять',
      modeTooltip: 'Подсказка',
      languageLabel: 'Язык интерфейса',
      targetLabel: 'Показывать цены в',
      sourceLabel: 'Источник курса',
      sourceCbr: 'ЦБ РФ',
      sourceMarket: 'Рыночный',
      customLabel: 'Свой курс',
      setBtn: 'Задать',
      scaleOthersLabel: 'Остальные валюты — от моего курса',
      removeRateTitle: 'Убрать свой курс {code}',
      markupLabel: 'Наценка к курсу',
      minAmountLabel: 'Не показывать до',
      siteOffGeneric: 'Выключить на этом сайте',
      siteOffOn: 'Выключить на {host}',
      statusLoading: 'Загружаю курсы…',
      statusErrorPrefix: 'Курс не обновился: {error}. Показываю последний сохранённый.',
      statusNoRates: 'Курсы ещё не загружены.',
      customPrefix: 'свой курс:',
      currencyWord: 'валюта',
      currencyWordFew: 'валюты',
      currencyWordMany: 'валют',
      scaleSuffix: ' + пересчёт остальных',
      baseWord: 'база',
      updatedAt: 'обновлено {time}',
      refreshBtn: 'Обновить курс',
      refreshing: 'Обновляю…',
      noAnswer: 'нет ответа',
      pricesFoundTemplate: 'на странице: {n}',
      noPricesFound: 'цен не найдено',
      pageUnavailable: 'страница недоступна',
      switchingSource: 'Переключаю источник, обновляю курсы…',
      markupNote: ' (курс +{markup}%)',
      customNote: ' (свой курс)',
      rateHintTemplate: 'Курс: 1 {code} = {value}{note}',
      originalLabel: 'Оригинал: {raw}{note}',
    },
    en: {
      appTitle: 'Price Converter',
      modeLabel: 'Display mode',
      modeAppend: 'Append',
      modeReplace: 'Replace',
      modeTooltip: 'Tooltip',
      languageLabel: 'Interface language',
      targetLabel: 'Show prices in',
      sourceLabel: 'Exchange rate source',
      sourceCbr: 'Bank of Russia',
      sourceMarket: 'Market',
      customLabel: 'Custom rate',
      setBtn: 'Set',
      scaleOthersLabel: 'Scale other currencies from my rate',
      removeRateTitle: 'Remove custom rate for {code}',
      markupLabel: 'Markup on rate',
      minAmountLabel: 'Hide amounts below',
      siteOffGeneric: 'Disable on this site',
      siteOffOn: 'Disable on {host}',
      statusLoading: 'Loading rates…',
      statusErrorPrefix: "Couldn't update rates: {error}. Showing last saved.",
      statusNoRates: 'Rates not loaded yet.',
      customPrefix: 'custom rate:',
      currencyWord: 'currency',
      currencyWordFew: 'currencies',
      currencyWordMany: 'currencies',
      scaleSuffix: ' + scaled others',
      baseWord: 'base',
      updatedAt: 'updated {time}',
      refreshBtn: 'Refresh rates',
      refreshing: 'Refreshing…',
      noAnswer: 'no response',
      pricesFoundTemplate: 'on page: {n}',
      noPricesFound: 'no prices found',
      pageUnavailable: 'page unavailable',
      switchingSource: 'Switching source, updating rates…',
      markupNote: ' (rate +{markup}%)',
      customNote: ' (custom rate)',
      rateHintTemplate: 'Rate: 1 {code} = {value}{note}',
      originalLabel: 'Original: {raw}{note}',
    },
    ar: {
      appTitle: 'محوّل الأسعار',
      modeLabel: 'طريقة العرض',
      modeAppend: 'إضافة',
      modeReplace: 'استبدال',
      modeTooltip: 'تلميح',
      languageLabel: 'لغة الواجهة',
      targetLabel: 'عرض الأسعار بعملة',
      sourceLabel: 'مصدر سعر الصرف',
      sourceCbr: 'البنك المركزي الروسي',
      sourceMarket: 'السوق',
      customLabel: 'سعر مخصّص',
      setBtn: 'تعيين',
      scaleOthersLabel: 'احتساب باقي العملات من سعري',
      removeRateTitle: 'إزالة السعر المخصص لـ {code}',
      markupLabel: 'هامش على السعر',
      minAmountLabel: 'إخفاء المبالغ الأقل من',
      siteOffGeneric: 'تعطيل في هذا الموقع',
      siteOffOn: 'تعطيل في {host}',
      statusLoading: 'جاري تحميل الأسعار…',
      statusErrorPrefix: 'تعذّر تحديث السعر: {error}. يتم عرض آخر سعر محفوظ.',
      statusNoRates: 'لم يتم تحميل الأسعار بعد.',
      customPrefix: 'سعر مخصص:',
      currencyWord: 'عملة',
      currencyWordFew: 'عملات',
      currencyWordMany: 'عملة',
      scaleSuffix: ' + احتساب الباقي',
      baseWord: 'الأساس',
      updatedAt: 'آخر تحديث {time}',
      refreshBtn: 'تحديث السعر',
      refreshing: 'جارٍ التحديث…',
      noAnswer: 'لا استجابة',
      pricesFoundTemplate: 'في الصفحة: {n}',
      noPricesFound: 'لا توجد أسعار',
      pageUnavailable: 'الصفحة غير متاحة',
      switchingSource: 'جارٍ تبديل المصدر وتحديث الأسعار…',
      markupNote: ' (السعر +{markup}%)',
      customNote: ' (سعر مخصص)',
      rateHintTemplate: 'السعر: 1 {code} = {value}{note}',
      originalLabel: 'الأصل: {raw}{note}',
    },
  };

  function interpolate(str, params) {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (m, key) => (key in params ? String(params[key]) : m));
  }

  function t(lang, key, params) {
    const table = DICT[lang] || DICT.ru;
    const str = table[key] !== undefined ? table[key] : (DICT.ru[key] !== undefined ? DICT.ru[key] : key);
    return interpolate(str, params);
  }

  function currencyWord(lang, n) {
    if (lang === 'ru') {
      const mod100 = n % 100;
      const mod10 = n % 10;
      if (mod100 >= 11 && mod100 <= 14) return t(lang, 'currencyWordMany');
      if (mod10 === 1) return t(lang, 'currencyWord');
      if (mod10 >= 2 && mod10 <= 4) return t(lang, 'currencyWordFew');
      return t(lang, 'currencyWordMany');
    }
    return n === 1 ? t(lang, 'currencyWord') : t(lang, 'currencyWordFew');
  }

  function resolveLang(settings) {
    const explicit = settings && settings.language;
    if (explicit && explicit !== 'auto' && LANGS.includes(explicit)) return explicit;
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      const raw = (nav && (nav.language || (nav.languages && nav.languages[0]))) || '';
      const l = raw.toLowerCase();
      if (l.indexOf('ar') === 0) return 'ar';
      if (l.indexOf('en') === 0) return 'en';
      if (l.indexOf('ru') === 0) return 'ru';
    } catch (e) { /* нет navigator (service worker) */ }
    return 'ru';
  }

  function dirFor(lang) {
    return lang === 'ar' ? 'rtl' : 'ltr';
  }

  function applyDom(doc, lang) {
    const nodes = doc.querySelectorAll('[data-i18n]');
    for (const el of nodes) el.textContent = t(lang, el.dataset.i18n);
    for (const el of doc.querySelectorAll('[data-i18n-title]')) el.title = t(lang, el.dataset.i18nTitle);
    for (const el of doc.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(lang, el.dataset.i18nPlaceholder);
  }

  return {
    LANGS: LANGS,
    t: t,
    currencyWord: currencyWord,
    resolveLang: resolveLang,
    dirFor: dirFor,
    applyDom: applyDom,
  };
});
