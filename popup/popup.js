'use strict';

const $ = (id) => document.getElementById(id);
let settings = null;
let currentHost = '';
let lang = 'ru';

function renderSegmented(container, value) {
  for (const btn of container.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.value === value));
  }
}

const POPULAR = ['USD', 'EUR', 'CNY', 'GBP', 'JPY', 'KZT', 'TRY', 'AED', 'GEL', 'THB', 'PLN', 'CHF', 'CAD', 'AUD', 'INR', 'KRW', 'HKD', 'UAH', 'BYN', 'RSD'];
let availableCodes = POPULAR.slice();

function renderCodeSelect() {
  const select = $('mCode');
  const previous = select.value;
  select.innerHTML = '';
  for (const code of availableCodes) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    select.appendChild(opt);
  }
  if (previous && availableCodes.includes(previous)) select.value = previous;
}

function renderTargetSelect() {
  const select = $('targetCurrency');
  const codes = PriceConfig.TARGET_CURRENCIES.filter((c) => c === 'RUB' || availableCodes.includes(c) || c === settings.targetCurrency);
  select.innerHTML = '';
  for (const code of codes) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = PriceConfig.symbolFor(code) + ' ' + code;
    select.appendChild(opt);
  }
  select.value = settings.targetCurrency || 'RUB';
}

function sourceLabel(key) {
  if (key === 'cbr') return PriceI18n.t(lang, 'sourceCbr');
  if (key === 'market') return PriceI18n.t(lang, 'sourceMarket');
  return key;
}

function renderManual() {
  const manual = settings.manualRates || {};
  const codes = Object.keys(manual).sort();
  const list = $('mList');
  list.innerHTML = '';
  for (const code of codes) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = '1 ' + code + ' = ' + manual[code] + ' ₽';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = PriceI18n.t(lang, 'removeRateTitle', { code: code });
    del.addEventListener('click', () => {
      const next = Object.assign({}, settings.manualRates);
      delete next[code];
      save({ manualRates: next });
    });
    chip.appendChild(del);
    list.appendChild(chip);
  }
  $('scaleRow').classList.toggle('hidden', codes.length === 0);
  $('scaleOthers').checked = Boolean(settings.scaleOthers);
}

function applyTexts() {
  document.documentElement.lang = lang;
  document.documentElement.dir = PriceI18n.dirFor(lang);
  PriceI18n.applyDom(document, lang);
  $('mValue').placeholder = PriceI18n.t(lang, 'perUnitPlaceholder', { sym: '₽' });
  $('minAmountUnit').textContent = PriceConfig.symbolFor(settings.targetCurrency || 'RUB');
}

function renderSettings() {
  $('enabled').checked = settings.enabled;
  renderSegmented($('mode'), settings.mode);
  renderSegmented($('source'), settings.source);
  renderSegmented($('language'), lang);
  $('markup').value = settings.markup;
  $('minAmount').value = settings.minAmountRub;
  renderTargetSelect();
  renderManual();
  applyTexts();
  $('siteOff').checked = Boolean(currentHost) && (settings.disabledHosts || []).includes(currentHost);
  // На служебных страницах (chrome://, файлы) хоста нет — прятать нечего.
  $('siteOff').disabled = !currentHost;
  $('siteLabel').textContent = currentHost
    ? PriceI18n.t(lang, 'siteOffOn', { host: currentHost })
    : PriceI18n.t(lang, 'siteOffGeneric');
}

function renderRates(rates, error) {
  if (error) {
    $('status').textContent = PriceI18n.t(lang, 'statusErrorPrefix', { error: error });
    return;
  }
  if (!rates || !rates.rubPer) {
    $('status').textContent = PriceI18n.t(lang, 'statusNoRates');
    return;
  }
  const target = settings.targetCurrency || 'RUB';
  const usd = PriceConfig.toTarget(1, 'USD', target, rates, settings);
  const eur = PriceConfig.toTarget(1, 'EUR', target, rates, settings);
  const dateLocale = (lang === 'ar' ? 'ar-SA' : lang === 'en' ? 'en-US' : 'ru-RU') + (lang === 'ar' ? '-u-nu-latn' : '');
  const updated = new Date(rates.ts).toLocaleString(dateLocale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = [];
  if (usd !== null && target !== 'USD') parts.push('1 $ = ' + PriceConfig.formatMoney(usd, target, lang, 2));
  if (eur !== null && target !== 'EUR') parts.push('1 € = ' + PriceConfig.formatMoney(eur, target, lang, 2));
  const manualCount = Object.keys((settings && settings.manualRates) || {}).length;
  const origin = manualCount
    ? PriceI18n.t(lang, 'customPrefix') + ' ' + manualCount + ' ' + PriceI18n.currencyWord(lang, manualCount) +
      (settings.scaleOthers ? PriceI18n.t(lang, 'scaleSuffix') : '') + '; ' + PriceI18n.t(lang, 'baseWord') + ' ' + sourceLabel(rates.source)
    : sourceLabel(rates.source) + ', ' + rates.count + ' ' + PriceI18n.currencyWord(lang, rates.count);
  $('status').textContent = parts.join(' · ') + (parts.length ? '\n' : '') + origin + ', ' + PriceI18n.t(lang, 'updatedAt', { time: updated });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadStats(tab) {
  if (!tab || !tab.id) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'stats' });
    if (res) $('count').textContent = res.count ? PriceI18n.t(lang, 'pricesFoundTemplate', { n: res.count }) : PriceI18n.t(lang, 'noPricesFound');
  } catch (e) {
    $('count').textContent = PriceI18n.t(lang, 'pageUnavailable');
  }
}

async function save(patch) {
  settings = await PriceConfig.setSettings(patch);
  lang = PriceI18n.resolveLang(settings);
  renderSettings();
  // курс мог стать ручным — строка статуса это показывает
  const data = await chrome.storage.local.get(['rates', 'ratesError']);
  renderRates(data.rates, data.ratesError);
}

async function init() {
  const tab = await activeTab();
  currentHost = PriceConfig.hostOf(tab && tab.url);
  settings = await PriceConfig.getSettings();
  lang = PriceI18n.resolveLang(settings);
  renderSettings();

  const data = await chrome.storage.local.get(['rates', 'ratesError']);
  if (data.rates && data.rates.rubPer) {
    const rest = Object.keys(data.rates.rubPer).filter((c) => c !== 'RUB' && !POPULAR.includes(c)).sort();
    availableCodes = POPULAR.filter((c) => data.rates.rubPer[c]).concat(rest);
  }
  renderCodeSelect();
  renderTargetSelect();
  renderRates(data.rates, data.ratesError);
  loadStats(tab);

  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

  $('language').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    await save({ language: btn.dataset.value });
    loadStats(tab);
  });

  $('targetCurrency').addEventListener('change', (e) => save({ targetCurrency: e.target.value }));

  $('mode').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (btn) save({ mode: btn.dataset.value });
  });

  $('source').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.dataset.value === settings.source) return;
    save({ source: btn.dataset.value });
    $('status').textContent = PriceI18n.t(lang, 'switchingSource');
  });

  $('markup').addEventListener('change', (e) => {
    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    save({ markup: v });
  });

  $('minAmount').addEventListener('change', (e) => {
    const v = Math.max(0, Number(e.target.value) || 0);
    save({ minAmountRub: v });
  });

  $('siteOff').addEventListener('change', async (e) => {
    if (!currentHost) return;
    const hosts = new Set(settings.disabledHosts || []);
    if (e.target.checked) hosts.add(currentHost);
    else hosts.delete(currentHost);
    await save({ disabledHosts: Array.from(hosts) });
    setTimeout(() => loadStats(tab), 300);
  });

  $('mAdd').addEventListener('click', () => {
    const code = $('mCode').value;
    const value = Number($('mValue').value);
    if (!code || !(value > 0)) return;
    const next = Object.assign({}, settings.manualRates);
    next[code] = value;
    save({ manualRates: next });
    $('mValue').value = '';
  });

  $('mValue').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('mAdd').click();
  });

  $('scaleOthers').addEventListener('change', (e) => save({ scaleOthers: e.target.checked }));

  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true;
    $('status').textContent = PriceI18n.t(lang, 'refreshing');
    try {
      const res = await chrome.runtime.sendMessage({ type: 'refreshRates' });
      if (res && res.ok) renderRates(res.rates, null);
      else renderRates(null, (res && res.error) || PriceI18n.t(lang, 'noAnswer'));
    } finally {
      $('refresh').disabled = false;
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.rates || changes.ratesError) {
      chrome.storage.local.get(['rates', 'ratesError']).then((d) => renderRates(d.rates, d.ratesError));
    }
  });
}

init();
