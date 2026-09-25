/* Service worker: тянет курсы валют, кэширует их в storage и обновляет по будильнику. */
importScripts('lib/config.js');

// Европейский ЦБ — официальный, но с 2022-го не публикует курс рубля (санкции),
// поэтому сам по себе не даёт курса к RUB. Рыночный источник (open.er-api, RUB-based)
// всегда нужен как минимум для пересчёта курсов ЕЦБ (которые заданы к евро) в рубли.
const ECB_URL = 'https://api.frankfurter.dev/v1/latest';
const MARKET_URL = 'https://open.er-api.com/v6/latest/RUB';

async function fetchEcb() {
  const res = await fetch(ECB_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('ЕЦБ ответил ' + res.status);
  const json = await res.json();
  if (!json || !json.rates) throw new Error('ЕЦБ вернул пустой ответ');
  return { base: json.base || 'EUR', ratesVsBase: json.rates, date: json.date || null, label: 'ecb' };
}

async function fetchMarket() {
  const res = await fetch(MARKET_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('open.er-api ответил ' + res.status);
  const json = await res.json();
  if (!json || !json.rates) throw new Error('open.er-api вернул пустой ответ');
  const rubPer = { RUB: 1 };
  for (const code of Object.keys(json.rates)) {
    const perRub = json.rates[code];
    if (perRub > 0) rubPer[code] = 1 / perRub;
  }
  return { rubPer, date: json.time_last_update_utc || null, label: 'market' };
}

/** Курсы ЕЦБ заданы «к евро» — переводим их в рубли через rubPer.EUR рыночного источника. */
function ecbToRubPer(ecb, marketRubPer) {
  const rubPerEur = marketRubPer && marketRubPer.EUR;
  if (!(rubPerEur > 0)) return null;
  const rubPer = { EUR: rubPerEur };
  for (const code of Object.keys(ecb.ratesVsBase)) {
    const vsEur = ecb.ratesVsBase[code];
    if (vsEur > 0) rubPer[code] = rubPerEur / vsEur;
  }
  return rubPer;
}

/**
 * Рыночный источник (RUB-based) обязателен — без него не из чего построить курс
 * рубля, даже если выбран ЕЦБ. Выбранный источник задаёт курс для своих валют,
 * рыночный дополняет те, которых у ЕЦБ нет (у него их около 30, у рыночного — полторы сотни).
 */
async function updateRates() {
  const settings = await PriceConfig.getSettings();
  const preferEcb = settings.source === 'ecb';

  const [ecbRes, marketRes] = await Promise.allSettled([fetchEcb(), fetchMarket()]);

  if (marketRes.status !== 'fulfilled') {
    const reason = (marketRes.reason && marketRes.reason.message) ||
      (ecbRes.reason && ecbRes.reason.message) || 'нет сети';
    await chrome.storage.local.set({ ratesError: reason });
    throw new Error(reason);
  }

  const marketRubPer = marketRes.value.rubPer;
  const ecbRubPer = ecbRes.status === 'fulfilled' ? ecbToRubPer(ecbRes.value, marketRubPer) : null;

  let rubPer, dateUsed, labelUsed;
  if (preferEcb && ecbRubPer) {
    rubPer = Object.assign({}, marketRubPer, ecbRubPer);
    dateUsed = ecbRes.value.date;
    labelUsed = 'ecb';
  } else {
    rubPer = ecbRubPer ? Object.assign({}, ecbRubPer, marketRubPer) : marketRubPer;
    dateUsed = marketRes.value.date;
    labelUsed = 'market';
  }

  const rates = {
    rubPer,
    date: dateUsed,
    source: labelUsed,
    requested: settings.source,
    ts: Date.now(),
    count: Object.keys(rubPer).length,
  };

  await chrome.storage.local.set({ rates, ratesError: null });
  return rates;
}

async function ensureFreshRates(force) {
  const data = await chrome.storage.local.get('rates');
  const rates = data.rates;
  const stale = !rates || !rates.ts || Date.now() - rates.ts > PriceConfig.RATES_TTL_MS;
  if (force || stale) return updateRates();
  return rates;
}

async function refreshBadge() {
  const settings = await PriceConfig.getSettings();
  await chrome.action.setBadgeBackgroundColor({ color: '#8a8a8a' });
  await chrome.action.setBadgeText({ text: settings.enabled ? '' : 'off' });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('refresh-rates', { periodInMinutes: 180 });
  ensureFreshRates(true).catch(() => {});
  refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('refresh-rates', { periodInMinutes: 180 });
  ensureFreshRates(false).catch(() => {});
  refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh-rates') updateRates().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const before = changes.settings.oldValue || {};
  const after = changes.settings.newValue || {};
  if (before.source !== after.source) updateRates().catch(() => {});
  if (before.enabled !== after.enabled) refreshBadge();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === 'ensureRates' || msg.type === 'refreshRates') {
    ensureFreshRates(msg.type === 'refreshRates')
      .then((rates) => sendResponse({ ok: true, rates }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // ответ придёт асинхронно
  }
});
