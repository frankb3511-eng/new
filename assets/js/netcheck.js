/**
 * PLAYGRID — Network Check module
 * -------------------------------------------------------------------------
 * A strictly passive, browser-side connectivity diagnostic.
 *
 * For each configured target it tries, in order:
 *   1. A no-cors GET fetch (opaque response — success only proves the
 *      request completed at the network level).
 *   2. A favicon image probe (onload proves reachability).
 *   3. One repeat fetch (to require *consistent* failure for a RED result).
 *
 * Classification:
 *   reachable — any method completed.
 *   blocked   — all methods failed or timed out, and the local control
 *               test passed (i.e. the browser itself can make requests).
 *   unknown   — browser offline, local control failed, or the environment
 *               prevented the test (CORS/extension/etc.).
 *
 * It never attempts to bypass blocks, use proxies, scan ports, or hide
 * traffic. Results are honest and clearly labelled as "likely".
 */

const FETCH_TIMEOUT = 8000;
const IMAGE_TIMEOUT = 7000;
const CONCURRENCY = 4;
const STORE_KEY = 'playgrid:netlast';

const stateLabels = {
  reachable: 'Reachable',
  blocked: 'Likely blocked / unreachable',
  unknown: 'Unable to determine',
  testing: 'Testing…',
  pending: 'Not tested yet',
};

/* ---------------- low-level probes ---------------- */

async function probeFetch(url, timeoutMs = FETCH_TIMEOUT) {
  const bust = (url.includes('?') ? '&' : '?') + '_nc=' + Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    await fetch(url + bust, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal, redirect: 'follow' });
    return { method: 'GET fetch (no-cors)', ok: true, ms: Math.round(performance.now() - t0) };
  } catch (err) {
    const reason = err && err.name === 'AbortError'
      ? `timed out after ${timeoutMs} ms`
      : `${err && err.name ? err.name : 'Error'}: ${err && err.message ? err.message : 'request failed'}`;
    return { method: 'GET fetch (no-cors)', ok: false, ms: Math.round(performance.now() - t0), error: reason };
  } finally {
    clearTimeout(timer);
  }
}

function probeImage(url, timeoutMs = IMAGE_TIMEOUT) {
  return new Promise((resolve) => {
    const bust = (url.includes('?') ? '&' : '?') + '_nc=' + Date.now();
    const img = new Image();
    const t0 = performance.now();
    const finish = (ok) => {
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve({ method: 'favicon image probe', ok, ms: Math.round(performance.now() - t0), error: ok ? null : 'image failed to load (blocked, missing, or timed out)' });
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.src = url + bust;
  });
}

/* ---------------- classification ---------------- */

async function testTarget(target, selfControl) {
  const attempts = [];
  const origin = new URL(target.url, location.href).origin;

  const first = await probeFetch(target.url);
  attempts.push(first);
  if (first.ok) return { state: 'reachable', ms: first.ms, attempts };

  const img = await probeImage(origin + '/favicon.ico');
  attempts.push(img);
  if (img.ok) return { state: 'reachable', ms: img.ms, attempts };

  const retry = await probeFetch(target.url);
  attempts.push(retry);
  if (retry.ok) return { state: 'reachable', ms: retry.ms, attempts };

  if (navigator.onLine === false) {
    return { state: 'unknown', ms: null, attempts, reason: 'The browser reports it is offline.' };
  }
  if (selfControl && !selfControl.ok) {
    return { state: 'unknown', ms: null, attempts, reason: 'The local control test also failed — something on this device (an extension, privacy setting, or the page itself) is blocking requests, so no target can be judged.' };
  }
  return { state: 'blocked', ms: null, attempts, reason: 'All attempts failed consistently while the local control test passed.' };
}

/* ---------------- rendering ---------------- */

let cfg = null;
let showToast = () => {};
let results = {};      // id -> result
let lastRunAt = null;
let running = false;

const $ = (sel, root = document) => root.querySelector(sel);

function iconFor(state) {
  if (state === 'testing') return '<span class="spinner" aria-hidden="true"></span>';
  if (state === 'reachable') return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-check"/></svg>';
  if (state === 'blocked') return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-x"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-help"/></svg>';
}

function rowTemplate(t) {
  const r = results[t.id];
  const state = r ? r.state : 'pending';
  const ms = r && r.state === 'reachable' && r.ms != null ? `${r.ms} ms` : '';
  return `
  <article class="netrow" data-state="${state}" data-target="${t.id}" aria-label="${t.name} connectivity test">
    <span class="nr-icon" aria-hidden="true">${iconFor(state)}</span>
    <div class="nr-main">
      <p class="nr-name">${t.name}${t.group === 'controls' ? ' <span class="badge badge-approx">control</span>' : ''}</p>
      <p class="nr-domain">${new URL(t.url).host}</p>
      <p class="nr-status">${stateLabels[state]}${ms ? ` · <span class="nr-ms-inline">${ms}</span>` : ''}</p>
    </div>
    <div class="nr-side">
      <button class="nr-retry" type="button" data-retry="${t.id}" title="Test ${t.name} again" aria-label="Test ${t.name} again">
        <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-refresh"/></svg>
      </button>
    </div>
    ${r ? detailsTemplate(r) : ''}
  </article>`;
}

function detailsTemplate(r) {
  const lines = r.attempts.map((a) =>
    `<div><span class="k">${esc(a.method)}</span><span>${a.ok ? `completed in ${a.ms} ms` : `failed — ${esc(a.error)}`}</span></div>`).join('');
  return `
  <button class="nr-expand" type="button" data-expand="${r.targetId}" aria-expanded="false">
    <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chev-down"/></svg> Technical details
  </button>
  <div class="nr-details" hidden>
    ${lines}
    ${r.reason ? `<div><span class="k">classification</span><span>${esc(r.reason)}</span></div>` : ''}
    <div><span class="k">tested at</span><span>${new Date(r.at).toLocaleString()}</span></div>
  </div>`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderList() {
  const list = $('#netList');
  if (!list || !cfg) return;
  const groups = [
    ['controls', 'Control targets'],
    ['platforms', 'Game platforms'],
    ['games', 'Game domains'],
  ];
  list.innerHTML = groups.map(([key, label]) => {
    const rows = cfg.tests.filter((t) => t.group === key);
    if (!rows.length) return '';
    return `<p class="netgroup-label">${label}</p>` + rows.map(rowTemplate).join('');
  }).join('');
  renderSummary();
  renderMeta();
}

function renderSummary() {
  const el = $('#netSummary');
  const tested = Object.values(results);
  if (!tested.length) { el.hidden = true; return; }
  el.hidden = false;
  const count = (s) => tested.filter((r) => r.state === s).length;
  el.innerHTML = `
    <div class="netsummary-card s-green"><strong>${count('reachable')}</strong><span>Reachable</span></div>
    <div class="netsummary-card s-red"><strong>${count('blocked')}</strong><span>Likely blocked / unreachable</span></div>
    <div class="netsummary-card s-grey"><strong>${count('unknown')}</strong><span>Unable to determine</span></div>`;
}

function renderMeta() {
  const el = $('#netMeta');
  if (lastRunAt) {
    const done = Object.values(results).filter((r) => r.state !== 'testing').length;
    el.textContent = running
      ? `Testing… ${done}/${cfg.tests.length} targets`
      : `Last run: ${new Date(lastRunAt).toLocaleString()} · ${cfg.tests.length} targets`;
  } else if (!running) {
    el.textContent = `${cfg.tests.length} targets ready — run the check to see results.`;
  }
}

function updateRow(id) {
  const row = document.querySelector(`.netrow[data-target="${id}"]`);
  if (!row) return;
  const t = cfg.tests.find((x) => x.id === id);
  const tmp = document.createElement('tbody');
  tmp.innerHTML = rowTemplate(t);
  const fresh = tmp.firstElementChild;
  row.replaceWith(fresh);
}

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ at: lastRunAt, results }));
  } catch { /* storage unavailable — non-fatal */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && saved.results) {
      lastRunAt = saved.at;
      results = saved.results;
    }
  } catch { /* ignore corrupted state */ }
}

/* ---------------- running ---------------- */

async function runOne(id) {
  const t = cfg.tests.find((x) => x.id === id);
  if (!t || running) return;
  results[id] = { targetId: id, state: 'testing', attempts: [], at: Date.now() };
  updateRow(id);
  const selfControl = await probeSelf();
  const res = await testTarget(t, selfControl);
  results[id] = { ...res, targetId: id, at: Date.now() };
  updateRow(id);
  renderSummary();
  persist();
}

async function probeSelf() {
  try {
    await fetch('./?_self=' + Date.now(), { cache: 'no-store' });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function runAll() {
  if (running) return;
  running = true;
  $('#netRunAll').disabled = true;
  results = {};
  cfg.tests.forEach((t) => { results[t.id] = { targetId: t.id, state: 'testing', attempts: [], at: Date.now() }; });
  renderList();

  const selfControl = await probeSelf();
  const queue = [...cfg.tests];
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      const res = await testTarget(t, selfControl);
      results[t.id] = { ...res, targetId: t.id, at: Date.now() };
      lastRunAt = Date.now();
      updateRow(t.id);
      renderSummary();
      renderMeta();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cfg.tests.length) }, worker));
  running = false;
  lastRunAt = Date.now();
  $('#netRunAll').disabled = false;
  persist();
  renderSummary();
  renderMeta();

  const count = (s) => Object.values(results).filter((r) => r.state === s).length;
  showToast(`Network check complete — ${count('reachable')} reachable, ${count('blocked')} likely blocked, ${count('unknown')} undetermined.`, count('blocked') ? 'info' : 'success');
}

/* ---------------- init ---------------- */

export function initNetworkView({ tests, toast }) {
  cfg = { tests };
  showToast = toast;
  restore();

  $('#netRunAll').addEventListener('click', () => { runAll(); });

  $('#netList').addEventListener('click', (e) => {
    const retry = e.target.closest('[data-retry]');
    if (retry) { runOne(retry.dataset.retry); return; }
    const exp = e.target.closest('[data-expand]');
    if (exp) {
      const panel = exp.nextElementSibling;
      const open = exp.getAttribute('aria-expanded') === 'true';
      exp.setAttribute('aria-expanded', String(!open));
      panel.hidden = open;
    }
  });

  renderList();
}
