// logger.js
/**
 * Logger centralizzato con pannello UI. Registra eventi e errori con timestamp, user-id e dettagli.
 */
const state = {
  entries: []
};

function nowISO() { return new Date().toISOString(); }

export function logEvent(area, action, details = {}) {
  const user = JSON.parse(localStorage.getItem('roxstar_auth_user') || '{}');
  const entry = { type: 'event', ts: nowISO(), user: user.username || null, area, action, details };
  state.entries.push(entry);
  refreshPanel();
  console.debug('[LOG]', entry);
}

export function logError(action, error, details = {}) {
  const user = JSON.parse(localStorage.getItem('roxstar_auth_user') || '{}');
  const entry = { type: 'error', ts: nowISO(), user: user.username || null, action, details: { ...details, message: error?.message, stack: error?.stack } };
  state.entries.push(entry);
  refreshPanel();
  console.error('[ERR]', entry);
}

export function initLoggerPanel(root) {
  let panel = document.getElementById('log-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'log-panel';
    panel.className = 'hidden';
    // pannello log leggero e trasparente (leggermente più leggibile)
    panel.style.width = 'min(700px, 100%)';
    panel.style.maxHeight = '40vh';
    panel.style.overflow = 'auto';
    panel.style.marginTop = '8px';
    panel.style.zIndex = '1';
    panel.style.background = 'rgba(18,18,18,0.20)';
    panel.style.border = '1px solid rgba(34,34,34,0.4)';
    panel.style.borderRadius = '10px';
    panel.style.backdropFilter = 'blur(3px)';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '8px';
    controls.style.marginBottom = '8px';

    const filter = document.createElement('input');
    filter.type = 'text';
    filter.placeholder = 'Filtra log...';
    filter.style.flex = '1';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'button';
    copyBtn.textContent = 'Copia JSON';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(state.entries, null, 2));
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'button';
    clearBtn.textContent = 'Pulisci';
    clearBtn.addEventListener('click', () => { state.entries = []; refreshPanel(); });

    const list = document.createElement('div');
    list.id = 'log-list';
    list.style.fontFamily = 'ui-monospace, Menlo, Consolas, monospace';
    list.style.fontSize = '12px';
    list.style.color = '#ff4d4d'; // rosso

    controls.append(filter, copyBtn, clearBtn);
    panel.append(controls, list);
    root.appendChild(panel);

    filter.addEventListener('input', () => refreshPanel(filter.value));
    refreshPanel();

    // auto-refresh periodico come un terminal
    setInterval(() => refreshPanel(filter.value), 1500);
  }
}

function renderEntry(entry) {
  const div = document.createElement('div');
  div.style.padding = '6px 0';
  div.style.borderBottom = '1px solid #222';
  div.textContent = `[${entry.ts}] [${entry.type}] [${entry.user ?? '-'}] ${entry.area ? '['+entry.area+'] ' : ''}${entry.action} ${entry.details ? JSON.stringify(entry.details) : ''}`;
  return div;
}

function refreshPanel(filterText = '') {
  const list = document.getElementById('log-list');
  if (!list) return;
  const p = document.getElementById('log-panel');
  const f = (filterText || '').toLowerCase();
  list.innerHTML = '';
  state.entries
    .filter(e => JSON.stringify(e).toLowerCase().includes(f))
    .slice(-500)
    .forEach(e => list.appendChild(renderEntry(e)));
  // auto-scroll in fondo
  list.scrollTop = list.scrollHeight;
}

// Capture globale di errori runtime per diagnosi rapida
if (typeof window !== 'undefined' && !window.__rox_logger_bound) {
  window.__rox_logger_bound = true;
  window.addEventListener('error', (e) => {
    try {
      const err = e.error || new Error(e.message || 'window.error');
      logError('global_error', err, { source: e.filename, lineno: e.lineno, colno: e.colno });
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const reason = e.reason instanceof Error ? e.reason : new Error(typeof e.reason === 'string' ? e.reason : JSON.stringify(e.reason));
      logError('unhandled_rejection', reason, {});
    } catch {}
  });
}