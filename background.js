/* Service worker: тянет курсы валют, кэширует их в storage и обновляет по будильнику. */
importScripts('lib/config.js');

const CBR_URL = 'https://www.cbr-xml-daily.ru/daily_json.js';
const MARKET_URL = 'https://open.er-api.com/v6/latest/RUB';

async function fetchCbr() {
  const res = await fetch(CBR_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error('ЦБ РФ ответил ' + res.status);
  const json = await res.json();
  const rubPer = { RUB: 1 };
  for (const code of Object.keys(json.Valute || {})) {
    const v = json.Valute[code];
    if (v && v.Value && v.Nominal) rubPer[code] = v.Value / v.Nominal;
  }
  return { rubPer, date: json.Date || null, label: 'cbr' };
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

/**
 * Берём оба источника: выбранный задаёт курс, второй лишь дополняет валюты,
 * которых у первого нет (у ЦБ РФ их около 40, у рыночного — полторы сотни).
 */
async function updateRates() {
  const settings = await PriceConfig.getSettings();
  const preferCbr = settings.source !== 'market';

  const [cbr, market] = await Promise.allSettled([fetchCbr(), fetchMarket()]);
  const primary = preferCbr ? cbr : market;
  const fallback = preferCbr ? market : cbr;

  if (primary.status !== 'fulfilled' && fallback.status !== 'fulfilled') {
    const reason = (primary.reason && primary.reason.message) || 'нет сети';
    await chrome.storage.local.set({ ratesError: reason });
    throw new Error(reason);
  }

  const base = fallback.status === 'fulfilled' ? fallback.value.rubPer : {};
  const top = primary.status === 'fulfilled' ? primary.value : fallback.value;
  const rubPer = Object.assign({}, base, top.rubPer);

  const rates = {
    rubPer,
    date: top.date,
    source: top.label,
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
