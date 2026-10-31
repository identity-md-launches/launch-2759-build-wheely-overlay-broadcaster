import { ageLabel, DEFAULT_ACCENT, format, freshness, integer, IntegrityLog, isRunning, parseOptions, WIDGETS } from './domain.js';
import { emptyFeed, ENDPOINTS, Poller } from './data.js';
import { escapeHTML as esc, icon } from './icons.js';

/** @template {HTMLElement} T @param {string} id @returns {T} */
function get(id) { return /** @type {T} */ (document.getElementById(id)); }
/** @param {ParentNode} [parent] */
function mountIcons(parent = document) {
  for (const element of parent.querySelectorAll('[data-icon]')) element.innerHTML = icon(/** @type {HTMLElement} */ (element).dataset.icon || 'wheel');
}
mountIcons();

const form = /** @type {HTMLFormElement} */ (get('settings-form'));
const sourceURL = /** @type {HTMLInputElement} */ (get('source-url'));
const sceneFrame = /** @type {HTMLIFrameElement} */ (get('scene-frame'));
const testAlertButton = /** @type {HTMLButtonElement} */ (get('test-alert'));
const scene = get('scene');
const dialog = /** @type {HTMLDialogElement} */ (get('setup-dialog'));
const log = new IntegrityLog();
let options = parseOptions(new URLSearchParams(location.search));
let selected = WIDGETS[0];
let feed = emptyFeed();
let previewPaused = false;
/** @type {ReturnType<typeof setTimeout>|undefined} */ let announceTimer;
/** @type {HTMLElement|null} */ let dialogTrigger = null;
const base = new URL('./', location.href);

/** @param {string} widget @returns {string} */
function widgetURL(widget) {
  const url = new URL(`overlay/${widget}/`, base);
  url.searchParams.set('side', options.side);
  url.searchParams.set('scale', String(options.scale));
  url.searchParams.set('theme', options.theme);
  url.searchParams.set('accent', options.accent.slice(1));
  url.searchParams.set('hideWhenIdle', options.hideWhenIdle ? '1' : '0');
  if (widget === 'integrity') url.searchParams.set('circumferenceMm', String(options.circumferenceMm));
  return url.href;
}

function populateForm() {
  for (const radio of form.querySelectorAll('input[type="radio"]')) {
    const input = /** @type {HTMLInputElement} */ (radio);
    input.checked = input.value === (input.name === 'side' ? options.side : options.theme);
  }
  /** @type {HTMLInputElement} */ (get('scale')).value = String(options.scale);
  /** @type {HTMLInputElement} */ (get('accent')).value = options.accent.length === 4 ? '#' + options.accent.slice(1).split('').map(c=>c+c).join('') : options.accent;
  /** @type {HTMLInputElement} */ (get('hide-idle')).checked = options.hideWhenIdle;
  /** @type {HTMLInputElement} */ (get('circumference')).value = String(options.circumferenceMm);
  updateOutputs();
}

function updateOutputs() {
  get('scale-value').textContent = `${options.scale.toFixed(1)}×`;
  get('accent-value').textContent = options.accent.toUpperCase();
  for (const button of document.querySelectorAll('[data-color]')) {
    const current = /** @type {HTMLElement} */ (button).dataset.color === options.accent;
    button.classList.toggle('selected', current); button.setAttribute('aria-pressed', String(current));
  }
}

function updateURLs() {
  sourceURL.value = widgetURL(selected.id);
  const previewLink = /** @type {HTMLAnchorElement} */ (get('open-preview'));
  previewLink.href = widgetURL(selected.id);
  previewLink.setAttribute('aria-label', `Open full size ${selected.name.toLowerCase()}`);
  for (const widget of WIDGETS) {
    const input = /** @type {HTMLInputElement|null} */ (document.getElementById(`url-${widget.id}`));
    if (input) input.value = widgetURL(widget.id);
  }
}

/** @param {string} id @param {boolean} [scroll] */
function selectWidget(id, scroll = false) {
  selected = WIDGETS.find(w => w.id === id) ?? WIDGETS[0];
  get('selected-name').textContent = selected.name;
  get('selected-icon').innerHTML = icon(selected.icon);
  sceneFrame.title = `${selected.name} composition preview`;
  const url = widgetURL(selected.id);
  if (sceneFrame.src !== url) { testAlertButton.disabled = true; sceneFrame.src = url; }
  for (const button of document.querySelectorAll('.preview-tab')) {
    const active = /** @type {HTMLElement} */ (button).dataset.widget === selected.id;
    button.setAttribute('aria-pressed', String(active));
  }
  testAlertButton.hidden = selected.id !== 'alerts';
  updateURLs(); resizePreviews();
  if (scroll) { get('preview-title').scrollIntoView({ behavior: 'instant', block: 'start' }); sourceURL.focus({ preventScroll: true }); }
}

function buildLibrary() {
  get('preview-tabs').innerHTML = WIDGETS.map(w => `<button type="button" class="preview-tab" data-widget="${w.id}" aria-pressed="${w.id === selected.id}" aria-label="Preview ${w.name.toLowerCase()}">${{ticker:'Ticker',round:'Round',alerts:'Alerts',integrity:'Integrity',commands:'Commands'}[/** @type {'ticker'|'round'|'alerts'|'integrity'|'commands'} */(w.id)]}</button>`).join('');
  get('widget-grid').innerHTML = WIDGETS.map(w => `<article class="widget-card" data-widget-card="${w.id}"><div class="card-preview"><iframe data-card-frame="${w.id}" title="${w.name} live preview" src="${esc(widgetURL(w.id))}" width="1600" height="700" tabindex="-1"></iframe>${w.id === 'alerts' ? '<button class="card-alert-test" type="button" data-test-card disabled>Test a preview alert</button>' : ''}</div><div class="card-body"><div class="card-title">${icon(w.icon)}<h3>${w.name}</h3><span class="card-placement">${w.placement}</span></div><p>${w.description}</p><div class="card-actions"><button type="button" data-select="${w.id}" aria-label="Preview ${w.name.toLowerCase()} in scene">Preview in scene ${icon('arrow')}</button><button class="card-copy" type="button" data-copy="${w.id}" aria-label="Copy ${w.name.toLowerCase()} source URL">${icon('copy')}Copy URL</button></div><details class="card-source"><summary>Source URL & dimensions</summary><label class="sr-only" for="url-${w.id}">${w.name} browser source URL</label><input id="url-${w.id}" value="${esc(widgetURL(w.id))}" readonly><p>Width ${w.width} px · Height ${w.height} px</p></details></div></article>`).join('');
  get('preview-tabs').addEventListener('click', event => {
    const button = /** @type {HTMLElement} */ (event.target).closest('[data-widget]');
    if (button) selectWidget(/** @type {HTMLElement} */ (button).dataset.widget || 'ticker');
  });
  get('widget-grid').addEventListener('click', event => {
    const target = /** @type {HTMLElement} */ (event.target).closest('button');
    if (!target) return;
    if (target.dataset.select) selectWidget(target.dataset.select, true);
    if (target.dataset.copy) void copyURL(target.dataset.copy, target);
    if (target.hasAttribute('data-test-card')) {
      const frame = /** @type {HTMLIFrameElement|null} */ (document.querySelector('[data-card-frame="alerts"]'));
      frame?.contentWindow?.postMessage({ type: 'wheely:preview-alert' }, location.origin);
    }
  });
}

/** @param {string} widget @param {HTMLElement} button */
async function copyURL(widget, button) {
  const url = widgetURL(widget);
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch {
    const temp = document.createElement('textarea');
    temp.value = url; temp.style.position = 'fixed'; temp.style.top = '-1000px';
    document.body.append(temp); temp.select();
    try { copied = document.execCommand('copy'); } catch { copied = false; }
    temp.remove(); button.focus({ preventScroll: true });
  }
  if (copied) announce(`${WIDGETS.find(w=>w.id === widget)?.name ?? 'Widget'} URL copied. Ready for OBS.`);
  else {
    selectWidget(widget); sourceURL.focus(); sourceURL.select();
    announce('Clipboard unavailable. The URL is selected; copy it with your device’s copy command.');
  }
}

/** @param {string} message */
function announce(message) {
  clearTimeout(announceTimer); get('copy-announcement').textContent = message;
  announceTimer = setTimeout(() => { get('copy-announcement').textContent = ''; }, 6500);
}

function resizePreviews() {
  sceneFrame.style.transform = `scale(${scene.clientWidth / 1920})`;
  for (const frame of document.querySelectorAll('[data-card-frame]')) {
    const f = /** @type {HTMLIFrameElement} */ (frame);
    const box = f.parentElement;
    if (!box) continue;
    // A smaller source viewport makes each compact live preview legible without changing its URL.
    const widget = f.dataset.cardFrame;
    const w = widget === 'ticker' ? 1480 : widget === 'round' ? 520 : 800;
    const ratio = box.clientWidth / w;
    const h = box.clientHeight / ratio;
    f.width = String(w); f.height = String(h); f.style.width = w + 'px'; f.style.height = h + 'px';
    f.style.transform = `scale(${ratio})`;
  }
}

function broadcastFeed() {
  for (const frame of document.querySelectorAll('iframe')) {
    /** @type {HTMLIFrameElement} */ (frame).contentWindow?.postMessage({ type: 'wheely:feed', feed }, location.origin);
  }
}

function refreshSources() {
  updateURLs(); testAlertButton.disabled = true; sceneFrame.src = widgetURL(selected.id);
  for (const frame of document.querySelectorAll('[data-card-frame]')) {
    const f = /** @type {HTMLIFrameElement} */ (frame);
    const alertButton = /** @type {HTMLButtonElement|null} */ (f.closest('.widget-card')?.querySelector('[data-test-card]'));
    if (alertButton) alertButton.disabled = true;
    f.src = widgetURL(f.dataset.cardFrame || 'ticker');
  }
}

let lastCircumference = options.circumferenceMm;
function readSettings() {
  const circumferenceInput = /** @type {HTMLInputElement} */ (get('circumference'));
  const valid = circumferenceInput.checkValidity() && Number.isFinite(Number(circumferenceInput.value)) && Number(circumferenceInput.value) > 0;
  get('circumference-error').hidden = valid;
  circumferenceInput.setAttribute('aria-invalid', String(!valid));
  if (!valid) return;
  const data = new FormData(form);
  const search = new URLSearchParams();
  for (const [key, value] of data) search.set(key, String(value));
  search.set('hideWhenIdle', /** @type {HTMLInputElement} */ (get('hide-idle')).checked ? '1' : '0');
  options = parseOptions(search);
  if (lastCircumference !== options.circumferenceMm) {
    log.circumferenceMm = options.circumferenceMm;
    // Existing counter deltas remain exact; their aggregate uses the newly chosen circumference.
    lastCircumference = options.circumferenceMm;
  }
  updateOutputs(); refreshSources(); renderTelemetry();
}

/** @type {ReturnType<typeof setTimeout>|undefined} */ let settingsTimer;
form.addEventListener('input', event => {
  const input = /** @type {HTMLInputElement} */ (event.target);
  if (input.id === 'scale') get('scale-value').textContent = Number(input.value).toFixed(1) + '×';
  if (input.id === 'accent') get('accent-value').textContent = input.value.toUpperCase();
  clearTimeout(settingsTimer); settingsTimer = setTimeout(readSettings, input.type === 'radio' || input.type === 'checkbox' ? 0 : 180);
});
form.addEventListener('submit', e => e.preventDefault());
get('color-options').addEventListener('click', event => {
  const button = /** @type {HTMLElement} */ (event.target).closest('[data-color]');
  if (button) { /** @type {HTMLInputElement} */ (get('accent')).value = /** @type {HTMLElement} */ (button).dataset.color || DEFAULT_ACCENT; readSettings(); }
});
get('reset-settings').addEventListener('click', () => {
  options = parseOptions(new URLSearchParams()); lastCircumference = options.circumferenceMm; log.circumferenceMm = options.circumferenceMm;
  populateForm(); get('circumference-error').hidden = true; get('circumference').removeAttribute('aria-invalid'); refreshSources(); announce('Widget settings reset to defaults.');
});
get('copy-selected').addEventListener('click', event => void copyURL(selected.id, /** @type {HTMLElement} */ (event.currentTarget)));
get('pause-preview').addEventListener('click', () => {
  previewPaused = !previewPaused;
  const button = get('pause-preview');
  button.innerHTML = icon(previewPaused ? 'play' : 'pause');
  button.setAttribute('aria-label', previewPaused ? 'Resume preview motion' : 'Pause preview motion');
  button.setAttribute('title', previewPaused ? 'Resume preview motion' : 'Pause preview motion');
  button.setAttribute('aria-pressed', String(previewPaused));
  for (const frame of document.querySelectorAll('iframe')) /** @type {HTMLIFrameElement} */ (frame).contentWindow?.postMessage({ type: 'wheely:pause', paused: previewPaused }, location.origin);
});
get('test-alert').addEventListener('click', () => {
  sceneFrame.contentWindow?.postMessage({ type: 'wheely:preview-alert' }, location.origin);
  announce('Preview alert sent. Broadcast sources are unaffected.');
});

for (const trigger of document.querySelectorAll('[data-open-setup]')) trigger.addEventListener('click', () => {
  dialogTrigger = /** @type {HTMLElement} */ (trigger); dialog.showModal();
});
for (const id of ['close-setup', 'done-setup']) get(id).addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  }
});
dialog.addEventListener('close', () => dialogTrigger?.focus());
document.addEventListener('click', event => {
  const link = /** @type {HTMLElement} */ (event.target).closest('a[href^="#"]');
  if (link?.getAttribute('href') === '#telemetry') {
    for (const item of document.querySelectorAll('.main-nav a')) { item.classList.remove('active'); item.removeAttribute('aria-current'); }
    link.classList.add('active'); link.setAttribute('aria-current', 'location');
  }
  if (link?.getAttribute('href') === '#widgets') {
    for (const item of document.querySelectorAll('.main-nav a')) { item.classList.remove('active'); item.removeAttribute('aria-current'); }
    link.classList.add('active'); link.setAttribute('aria-current', 'location');
  }
});

get('download-log').addEventListener('click', () => {
  const blob = new Blob([log.exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = `wheely-poll-log-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`Exported ${log.entries.length} polls from this browser session.`);
});

function renderTelemetry() {
  const now = Date.now(); const s = feed.status;
  const fresh = freshness(s?.measurement, now);
  const failed = Object.values(feed.errors).some(Boolean);
  const connection = get('api-status');
  connection.dataset.state = failed || fresh.stale ? 'stale' : 'live';
  const label = feed.pending ? 'Connecting to feed' : !s ? 'Feed unavailable · retrying' : failed ? 'Some feeds interrupted' : fresh.stale ? `Wheel stale · ${ageLabel(fresh.age)} old` : 'Public feed connected';
  connection.innerHTML = `<i></i>${esc(label)}`;
  get('preview-summary').textContent = !s ? feed.pending ? 'Waiting for the first wheel measurement…' : 'Feed unavailable. Retrying every 5s.' : `${isRunning(s) ? 'Running' : 'Asleep'} · ${format(s.measurement.rpmMilli / 1000, 1)} rpm · ${fresh.stale || feed.errors.status ? 'STALE · ' : ''}${ageLabel(fresh.age)} old`;
  get('observation-age').textContent = s ? `${fresh.stale || feed.errors.status ? 'STALE · ' : 'OK · '}${ageLabel(fresh.age)} old` : 'STALE · no measurement';
  get('observation-detail').textContent = fresh.reason;
  const summary = log.summary(); const lastAnomaly = summary.anomalies.at(-1);
  get('integrity-verdict').textContent = `${lastAnomaly ? 'IMPLAUSIBLE' : fresh.stale || feed.errors.status ? 'STALE' : 'OK'} · ${summary.anomalies.length}/${summary.count} flagged`;
  get('integrity-detail').textContent = lastAnomaly?.reasons.join('; ') ?? summary.latest?.reasons.join('; ') ?? 'Your log starts with the first poll.';
  get('chain-work').textContent = feed.core ? `${format(integer(feed.core.core.cumulativeWork))} units` : '–';
  get('chain-detail').textContent = feed.core ? `${feed.errors.core ? 'STALE · ' : ''}Core ${ageLabel((now - feed.fetchedAt.core) / 1000)} ago · ${feed.core.core.paused ? 'paused' : 'unpaused'}` : 'STALE · core unavailable';
  get('mining-blocks').textContent = feed.economy?.mining.fundedBlocks !== undefined ? format(integer(feed.economy.mining.fundedBlocks)) : '–';
  const supply = feed.economy?.supply.liveSupplyBaseUnits;
  const decimals = feed.economy?.asset?.decimals;
  const supplyInteger = integer(supply);
  const wholeSupply = supplyInteger !== null && decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals < 100 ? supplyInteger / (10n ** BigInt(decimals)) : null;
  get('economy-detail').textContent = feed.economy ? `${feed.errors.economy ? 'STALE · ' : ''}${wholeSupply !== null ? format(wholeSupply) + ' ' + (feed.economy.asset?.symbol ?? 'tokens') + ' live supply · ' : ''}updated ${ageLabel((now - feed.fetchedAt.economy) / 1000)} ago` : 'STALE · economy unavailable';
  get('diagnostics-body').innerHTML = Object.entries(ENDPOINTS).map(([endpoint,url]) => {
    const key = /** @type {Endpoint} */ (endpoint); const at = feed.fetchedAt[key];
    return `<div class="endpoint-row"><strong>${endpoint === 'economy' ? 'Economy' : endpoint === 'core' ? 'Core' : 'Wheel status'}</strong><code>${esc(url)}</code><span>${feed.errors[key] ? `STALE · ${esc(feed.errors[key])}; ` : ''}${at ? `Last success ${ageLabel((now-at)/1000)} ago` : 'No successful fetch; retrying every 5s'}</span></div>`;
  }).join('') + (s ? `<div class="diagnostic-detail"><strong>Reported attestation</strong><p>${esc(s.signer.kind)} · ${esc(s.signer.algorithm)} · key slot ${esc(s.signer.keySlot)} · last verified ${ageLabel((now - Date.parse(s.signer.lastVerifiedAt))/1000)} ago</p><p>${esc(s.measurement.provenance)} provenance · ${esc(s.measurement.freshness)} freshness · counter epoch ${esc(s.measurement.counterEpoch)}</p></div><div class="diagnostic-detail"><strong>Hardware modules (${s.modules.length})</strong>${s.modules.map(m=>`<div class="module-row"><span>${esc(m.instanceId)}</span><span>${esc(m.moduleType)}</span><span>${esc(m.driverId)}</span><span>${esc(m.state)}</span></div>`).join('') || '<p>No modules reported.</p>'}</div>` : '') + (feed.economy ? `<div class="diagnostic-detail"><strong>Economy core identity</strong><p>${esc(feed.economy.identities.core ?? 'Not supplied')}</p></div>` : '');
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.data?.type !== 'wheely:ready') return;
  const frame = [...document.querySelectorAll('iframe')].find(f=>f.contentWindow === event.source);
  if (frame) {
    frame.contentWindow?.postMessage({ type: 'wheely:feed', feed }, location.origin);
    frame.contentWindow?.postMessage({ type: 'wheely:pause', paused: previewPaused }, location.origin);
    if (frame === sceneFrame) testAlertButton.disabled = false;
    const alertButton = /** @type {HTMLButtonElement|null} */ (frame.closest('.widget-card')?.querySelector('[data-test-card]'));
    if (alertButton) alertButton.disabled = false;
  }
});
populateForm(); buildLibrary(); selectWidget('ticker');
const observer = new ResizeObserver(resizePreviews); observer.observe(scene); observer.observe(get('widget-grid'));
const poller = new Poller(next => { feed = next; log.ingest(feed); broadcastFeed(); renderTelemetry(); });
poller.start();
setInterval(renderTelemetry, 1000);
window.addEventListener('pagehide', () => poller.stop());
renderTelemetry();
