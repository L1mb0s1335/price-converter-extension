/* Content script: ищет цены в тексте страницы и дописывает рублёвый эквивалент. */
(function () {
  'use strict';

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'KBD', 'SAMP', 'SVG', 'CANVAS', 'IFRAME', 'OBJECT', 'MATH', 'TITLE',
  ]);

  // Теги, которые не рвут строку: внутри такого контейнера «SR» и «399» —
  // визуально одна цена, хотя в DOM это разные текстовые узлы.
  const INLINE_TAGS = new Set([
    'SPAN', 'A', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'SUP', 'SUB', 'BDI', 'BDO',
    'FONT', 'INS', 'DEL', 'U', 'MARK', 'ABBR', 'LABEL', 'TIME', 'DATA', 'CITE',
    'Q', 'S', 'BIG', 'NOBR', 'WBR',
  ]);

  const MAX_NODES_PER_PASS = 8000;
  const TIME_BUDGET_MS = 12;
  const MAX_CONTAINER_TEXT = 200;
  const MAX_CONTAINER_ELEMENTS = 12;
  const MAX_CONTAINER_DEPTH = 3;

  const host = location.hostname.replace(/^www\./, '');

  let settings = null;
  let rates = null;
  let lang = 'ru';
  let observer = null;
  let running = false;
  let queue = [];
  let pendingNodes = [];
  let scheduled = false;
  let triedContainers = new WeakSet();

  /* -------------------------------------------------------------- конверсия */

  function targetCode() {
    return (settings && settings.targetCurrency) || 'RUB';
  }

  function convert(amount, code) {
    if (code === targetCode()) return null; // уже в целевой валюте — не трогаем
    const converted = PriceConfig.toTarget(amount, code, targetCode(), rates, settings);
    if (converted === null || !isFinite(converted)) return null;
    // Порог задаётся в целевой валюте — том же числе, что видит пользователь.
    if (settings.minAmountRub && converted < settings.minAmountRub) return null;
    return converted;
  }

  function noteFor(code) {
    const manual = (settings.manualRates || {})[code] > 0;
    return (settings.markup ? PriceI18n.t(lang, 'markupNote', { markup: settings.markup }) : '') +
      (manual ? PriceI18n.t(lang, 'customNote') : '');
  }

  function fmt(value) {
    return PriceConfig.formatMoney(value, targetCode(), lang);
  }

  function rateHint(code) {
    const one = PriceConfig.toTarget(1, code, targetCode(), rates, settings);
    return PriceI18n.t(lang, 'rateHintTemplate', { code: code, value: PriceConfig.formatMoney(one, targetCode(), lang, 2), note: noteFor(code) });
  }

  /* ---------------------------------------------------------------- вставка */

  function makeConvNode(hit, rub) {
    const span = document.createElement('span');
    span.className = 'rpc-conv';
    span.dataset.rpc = '1';
    span.dataset.rpcStandalone = '1';
    span.title = rateHint(hit.code);
    span.textContent = ' ≈ ' + fmt(rub);
    return span;
  }

  function makePriceSpan(originalText, extraClass) {
    const span = document.createElement('span');
    span.className = 'rpc-price' + (extraClass ? ' ' + extraClass : '');
    span.dataset.rpc = '1';
    span.dataset.orig = originalText;
    return span;
  }

  /** Вырезает из текстового узла кусок [from, to) и ставит вместо него элемент. */
  function replaceRange(node, from, to, element) {
    if (to < node.nodeValue.length) node.splitText(to);
    const middle = from > 0 ? node.splitText(from) : node;
    middle.parentNode.replaceChild(element, middle);
  }

  /**
   * @param {Array<{node:Text, from:number, to:number}>} segments куски цены по узлам
   */
  function insertConversion(segments, hit, rub, container) {
    if (settings.mode === 'replace') {
      // Рубли ставим в тот кусок, где были цифры: узел с символом валюты
      // магазины часто рисуют отдельным шрифтом-иконкой.
      let target = segments.findIndex((seg) => /\d/.test(seg.node.nodeValue.slice(seg.from, seg.to)));
      if (target < 0) target = 0;

      // С конца, чтобы splitText не сдвигал границы ещё не обработанных кусков.
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        const original = seg.node.nodeValue.slice(seg.from, seg.to);
        const isTarget = i === target;
        const span = makePriceSpan(original, isTarget ? 'rpc-replaced' : 'rpc-cut');
        if (isTarget) {
          span.textContent = fmt(rub);
          span.title = PriceI18n.t(lang, 'originalLabel', { raw: hit.raw, note: noteFor(hit.code) });
        }
        replaceRange(seg.node, seg.from, seg.to, span);
      }
      return;
    }

    if (settings.mode === 'tooltip') {
      if (segments.length === 1) {
        const seg = segments[0];
        const span = makePriceSpan(seg.node.nodeValue.slice(seg.from, seg.to), 'rpc-hint');
        span.textContent = hit.raw;
        span.title = '≈ ' + fmt(rub) + noteFor(hit.code);
        replaceRange(seg.node, seg.from, seg.to, span);
      } else if (container) {
        // Цена размазана по нескольким узлам — подсказку вешаем на контейнер.
        container.dataset.rpcTitle = container.title || '';
        container.title = '≈ ' + fmt(rub) + noteFor(hit.code);
        container.classList.add('rpc-hint');
      }
      return;
    }

    // append: оригинал остаётся, приписка встаёт сразу за последним куском цены
    const last = segments[segments.length - 1];
    const tail = last.to < last.node.nodeValue.length ? last.node.splitText(last.to) : last.node.nextSibling;
    last.node.parentNode.insertBefore(makeConvNode(hit, rub), tail);
  }

  /**
   * Общая обработка «единицы текста»: одного узла или склейки соседних.
   * @param {Array<{node:Text, start:number, end:number}>} nodes карта узлов в общем тексте
   */
  function handleUnit(nodes, text, container) {
    const split = nodes.length > 1;
    const hits = PriceParser.findPrices(text, { relaxShort: split });
    if (!hits.length) return false;

    const usable = [];
    for (const hit of hits) {
      const rub = convert(hit.amount, hit.code);
      if (rub !== null) usable.push({ hit: hit, rub: rub });
    }
    if (!usable.length) return false;

    // С конца — чтобы правки не смещали границы ещё не обработанных цен.
    for (let i = usable.length - 1; i >= 0; i--) {
      const hit = usable[i].hit;
      const segments = [];
      for (const entry of nodes) {
        if (entry.end <= hit.start || entry.start >= hit.end) continue;
        segments.push({
          node: entry.node,
          from: Math.max(0, hit.start - entry.start),
          to: Math.min(entry.node.nodeValue.length, hit.end - entry.start),
        });
      }
      // «SR180» без пробела принимаем, только если между маркером и числом
      // действительно проходит граница элементов, а не буквы одного слова.
      if (hit.short && segments.length < 2 && !/[\s\u00A0]/.test(hit.raw)) continue;
      if (segments.length) insertConversion(segments, hit, usable[i].rub, container);
    }
    return true;
  }

  function handleTextNode(node) {
    const text = node.nodeValue;
    if (!text) return false;
    return handleUnit([{ node: node, start: 0, end: text.length }], text, node.parentElement);
  }

  /* ----------------------------------------------- цены, разбитые по узлам */

  function isInlineContainer(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.dataset && (el.dataset.rpc || el.dataset.rpcDone)) return false;
    const text = el.textContent;
    if (!text || text.length > MAX_CONTAINER_TEXT) return false;
    const kids = el.querySelectorAll('*');
    if (kids.length > MAX_CONTAINER_ELEMENTS) return false;
    for (const kid of kids) {
      if (!INLINE_TAGS.has(kid.tagName)) return false;
    }
    return true;
  }

  function collectContainerNodes(el) {
    const nodes = [];
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest('[data-rpc]')) continue;
      const value = node.nodeValue || '';
      nodes.push({ node: node, start: text.length, end: text.length + value.length });
      text += value;
    }
    return { nodes: nodes, text: text };
  }

  /**
   * Сам по себе узел цены не содержит — возможно, символ валюты лежит
   * в соседнем элементе. Поднимаемся на пару уровней и пробуем склейку.
   */
  function handleSplitPrice(node) {
    let el = node.parentElement;
    for (let depth = 0; el && depth < MAX_CONTAINER_DEPTH; depth++, el = el.parentElement) {
      if (!isInlineContainer(el)) return false;
      if (triedContainers.has(el)) continue;
      triedContainers.add(el);
      const collected = collectContainerNodes(el);
      if (collected.nodes.length < 2) continue;
      if (handleUnit(collected.nodes, collected.text, el)) {
        el.dataset.rpcDone = '1';
        return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ обход */

  function isSkippable(el) {
    for (let cur = el; cur; cur = cur.parentElement) {
      if (SKIP_TAGS.has(cur.tagName)) return true;
      if (cur.dataset && cur.dataset.rpc) return true;
      if (cur.isContentEditable) return true;
      if (cur.tagName === 'BODY' || cur.tagName === 'HTML') break;
    }
    return false;
  }

  function collectTextNodes(root, out) {
    if (!root) return out;
    if (root.nodeType === Node.TEXT_NODE) {
      if (root.parentElement && !isSkippable(root.parentElement)) out.push(root);
      return out;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return out;
    if (root.nodeType === Node.ELEMENT_NODE && isSkippable(root)) return out;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (out.length >= MAX_NODES_PER_PASS) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !/\d/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName) || (parent.dataset && parent.dataset.rpc)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node;
    while ((node = walker.nextNode())) {
      if (isSkippable(node.parentElement)) continue;
      out.push(node);
      if (out.length >= MAX_NODES_PER_PASS) break;
    }

    // Открытые shadow root'ы — их TreeWalker не видит.
    if (root.querySelectorAll) {
      const hosts = root.querySelectorAll('*');
      if (hosts.length <= 20000) {
        for (const el of hosts) {
          if (el.shadowRoot) collectTextNodes(el.shadowRoot, out);
        }
      }
    }
    return out;
  }

  function idle(cb) {
    const run = window.requestIdleCallback || function (fn) { return setTimeout(() => fn({ timeRemaining: () => 16 }), 16); };
    run(cb, { timeout: 500 });
  }

  function schedule(root) {
    if (!running || !root) return;
    queue.push(root);
    if (scheduled) return;
    scheduled = true;
    idle(flush);
  }

  function processNode(node) {
    if (!node.isConnected) return;
    const parent = node.parentElement;
    if (parent && parent.closest('[data-rpc-done]')) return;
    if (handleTextNode(node)) return;
    handleSplitPrice(node);
  }

  function flush(deadline) {
    scheduled = false;
    if (!running) { queue = []; pendingNodes = []; return; }

    while (queue.length) {
      const root = queue.shift();
      if (root.isConnected === false) continue;
      collectTextNodes(root, pendingNodes);
    }

    const started = performance.now();
    while (pendingNodes.length) {
      processNode(pendingNodes.shift());
      const timeLeft = deadline && deadline.timeRemaining ? deadline.timeRemaining() : 0;
      if (performance.now() - started > TIME_BUDGET_MS && timeLeft < 4) break;
    }

    if (pendingNodes.length || queue.length) {
      scheduled = true;
      idle(flush);
    }
    // Свои же вставки наблюдателю не показываем.
    if (observer) observer.takeRecords();
  }

  /* ---------------------------------------------------------- запуск и откат */

  function ourNode(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(el && el.closest && el.closest('[data-rpc]'));
  }

  function observe() {
    observer = new MutationObserver((records) => {
      if (!running) return;
      for (const rec of records) {
        const target = rec.target;
        if (ourNode(target)) continue;

        // Внутри уже посчитанного контейнера что-то поменялось (SPA обновил цену) —
        // откатываем его и считаем заново.
        const el = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
        const done = el && el.closest ? el.closest('[data-rpc-done]') : null;
        if (done) {
          revertAll(done);
          triedContainers = new WeakSet();
          schedule(done);
          continue;
        }

        if (rec.type === 'characterData') {
          if (target.parentElement && !isSkippable(target.parentElement)) schedule(target);
        } else {
          for (const added of rec.addedNodes) {
            if (added.nodeType !== Node.TEXT_NODE && added.nodeType !== Node.ELEMENT_NODE) continue;
            if (added.nodeType === Node.ELEMENT_NODE && added.dataset && added.dataset.rpc) continue;
            schedule(added);
          }
        }
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function revertAll(root) {
    const scope = root || document;

    for (const el of scope.querySelectorAll('[data-rpc-standalone]')) {
      const parent = el.parentNode;
      if (!parent) continue;
      parent.removeChild(el);
      parent.normalize();
    }

    for (const el of scope.querySelectorAll('span.rpc-price[data-orig]')) {
      const parent = el.parentNode;
      if (!parent) continue;
      parent.replaceChild(document.createTextNode(el.dataset.orig), el);
      parent.normalize();
    }

    for (const el of scope.querySelectorAll('[data-rpc-title]')) {
      const previous = el.dataset.rpcTitle;
      if (previous) el.title = previous;
      else el.removeAttribute('title');
      el.removeAttribute('data-rpc-title');
      el.classList.remove('rpc-hint');
      if (!el.classList.length) el.removeAttribute('class');
    }

    for (const el of scope.querySelectorAll('[data-rpc-done]')) {
      el.removeAttribute('data-rpc-done');
    }
    if (root && root.removeAttribute) root.removeAttribute('data-rpc-done');
  }

  function start() {
    if (running) return;
    running = true;
    triedContainers = new WeakSet();
    schedule(document.body || document.documentElement);
    if (!observer) observe();
  }

  function stop() {
    running = false;
    queue = [];
    pendingNodes = [];
    if (observer) { observer.disconnect(); observer = null; }
    revertAll();
    triedContainers = new WeakSet();
  }

  function shouldRun() {
    return Boolean(
      settings && settings.enabled &&
      rates && rates.rubPer &&
      !(settings.disabledHosts || []).includes(host)
    );
  }

  function apply() {
    stop();
    if (shouldRun()) start();
  }

  async function boot() {
    settings = await PriceConfig.getSettings();
    lang = PriceI18n.resolveLang(settings);
    const data = await chrome.storage.local.get('rates');
    rates = data.rates || null;

    const stale = !rates || !rates.ts || Date.now() - rates.ts > PriceConfig.RATES_TTL_MS;
    if (stale) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'ensureRates' });
        if (res && res.ok) rates = res.rates;
      } catch (e) { /* service worker недоступен — работаем на кэше, если он есть */ }
    }
    apply();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      settings = Object.assign({}, PriceConfig.DEFAULT_SETTINGS, changes.settings.newValue || {});
      lang = PriceI18n.resolveLang(settings);
    }
    if (changes.rates && changes.rates.newValue) rates = changes.rates.newValue;
    if (changes.settings || changes.rates) apply();
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'stats') return;
    sendResponse({
      host: host,
      count: document.querySelectorAll('span.rpc-conv, span.rpc-replaced, span.rpc-hint, [data-rpc-title]').length,
      running: running,
    });
  });

  boot();
})();
