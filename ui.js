// ui.js
// Inizializza la UI, monta header, main (login o tools) e footer.
import { initAuthUI, isAuthenticated, logout } from './auth.js?v=rox19';
import { initChecklistUI, cleanupChecklistEffects } from './checklist.js?v=rox19';
import * as Notes from './notes.js?v=rox19';
import { initLoggerPanel, logEvent } from './logger.js?v=rox19';
import { initBackgrounds } from './backgrounds.js?v=rox19';
import { upsert as upsertMeta, remove as removeMeta, subscribe as subscribeMeta } from './sync.js?v=rox19';
import { list as listMeta } from './sync.js?v=rox19';
import { clearAllForUser as resetLocalData } from './sync.js?v=rox19';

// Util per id
function uid() { return Math.random().toString(36).slice(2); }

// Helper utente corrente (solo username) per leggere le chiavi per-utente
function currentUsername() {
  try {
    const raw = localStorage.getItem('roxstar_auth_user') || sessionStorage.getItem('roxstar_auth_user');
    const u = JSON.parse(raw || '{}');
    return (u && u.username) ? String(u.username) : null;
  } catch {
    return null;
  }
}

// Gestione documenti creati (Note/Checklist); primo sempre la lista fissa
const DOCS = new Map([[ 'fixed_list', { title: 'LISTA DAA SPESSA', type: 'checklist' } ]]);
let currentDoc = { id: null, type: null };
// Assicurati che currentDoc sia inizializzato prima di qualsiasi chiamata a toolsPage/render
// rimosso: let currentDoc = { id: null, type: null };

// Bootstrap da storage della tabella "documents" (offline o online)
(function bootstrapDocsFromStorage(){
  try {
    const user = currentUsername();
    if (!user) return; // nessun bootstrap se non autenticato
    const key = `roxstar_table_${user}_documents`;
    const raw = localStorage.getItem(key);
    const arr = JSON.parse(raw || '[]');
    try { logEvent('docs', 'bootstrap_local', { count: Array.isArray(arr) ? arr.length : 0, key }); } catch {}
    if (Array.isArray(arr)) {
      arr.forEach(r => { if (r && r.id && r.title && r.type) DOCS.set(r.id, { title: r.title, type: r.type }); });
    }
  } catch {}
  if (!DOCS.has('fixed_list')) DOCS.set('fixed_list', { title: 'LISTA DAA SPESSA', type: 'checklist' });
})();

// Hydration remoto rimosso qui: esiste una sola IIFE di hydrateDocsFromRemote più sotto con logging diagnostico.

// helper per pulire prefissi tecnici del compat layer
function sanitizeTitle(raw) {
  let t = String(raw || '');
  // rimuove prefisso __DOC__: e prefisso checklist __CHK__:docId|
  t = t.replace(/^__DOC__:/, '');
  t = t.replace(/^__CHK__:[^|]*\|/, '');
  return t;
}

// Sottoscrizione realtime ai cambiamenti della tabella documents (se Supabase è configurato)
// subscribeMeta('documents') rimosso qui: la sottoscrizione è definita più sotto con logging diagnostico per evitare duplicazioni.

function refreshDocsList() {
  const ul = document.getElementById('docs-list');
  if (!ul) return;
  // assicurati che la lista fissa esista sempre
  if (!DOCS.has('fixed_list')) DOCS.set('fixed_list', { title: 'LISTA DAA SPESSA', type: 'checklist' });
  ul.innerHTML = '';
  const entries = Array.from(DOCS.entries());
  if (entries.length === 0) {
    // fallback estremo: reinietta la lista fissa
    DOCS.set('fixed_list', { title: 'LISTA DAA SPESSA', type: 'checklist' });
  }
  // Filtra eventuali artefatti di self-test (non mostrarli mai in lista)
  const visibleEntries = Array.from(DOCS.entries()).filter(([id, meta]) => {
    const t = (meta?.title || '').toLowerCase();
    return !(String(id).startsWith('test_') || t.includes('self test doc'));
  });
  // ordina con la lista fissa in cima
  const sorted = visibleEntries.sort((a, b) => {
    if (a[0] === 'fixed_list') return -1;
    if (b[0] === 'fixed_list') return 1;
    const ta = a[1]?.type || '';
    const tb = b[1]?.type || '';
    const byType = ta.localeCompare(tb);
    if (byType !== 0) return byType;
    const ta2 = (a[1]?.title || '').toLowerCase();
    const tb2 = (b[1]?.title || '').toLowerCase();
    return ta2.localeCompare(tb2);
  });
  sorted.forEach(([id, meta]) => {
    const li = document.createElement('li');
    li.textContent = meta?.title || String(id);
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => selectDocument(id));
    ul.appendChild(li);
  });
}
window.addEventListener('doc_saved', (e) => {
  const { id, title, type } = e.detail || {};
  const existed = id ? DOCS.has(id) : false; // valuta PRIMA di aggiornare DOCS
  try { logEvent('docs', 'doc_saved_event', { id, type, existed, origin: e?.detail?.origin || 'unknown' }); } catch {}
  if (id && title) DOCS.set(id, { title, type: type || (id === 'fixed_list' ? 'checklist' : 'note') });
  // Aggiorna meta documento su backend SOLO quando necessario per non sovrascrivere il testo delle note
  // - Checklist: sempre (serve solo il catalogo)
  // - Note: solo alla creazione (quando il documento non esisteva nel catalogo)
  const isChecklist = (type === 'checklist') || (id === 'fixed_list');
  const isNewDoc = !existed;
  if (isChecklist || isNewDoc) {
    try { logEvent('docs', 'catalog_upsert', { id, type: isChecklist ? 'checklist' : (type || 'note'), reason: isChecklist ? 'checklist' : 'new_doc', origin: e?.detail?.origin || 'unknown' }); } catch {}
    if (id && title) upsertMeta('documents', { id, title, type: type || (id === 'fixed_list' ? 'checklist' : 'note') });
  }
  // Se è un documento nuovo diverso da fixed_list, selezionalo automaticamente
  if (isNewDoc && id && id !== 'fixed_list') {
    currentDoc = { id, type: type || 'note' };
  }
  refreshDocsList();
  render();
});

// Listener mancanti per rename/remove con diagnostica
window.addEventListener('doc_removed', (e) => {
  const { id } = e.detail || {};
  try { logEvent('docs', 'doc_removed_event', { id, origin: e?.detail?.origin || 'unknown' }); } catch {}
  if (id && id !== 'fixed_list') DOCS.delete(id);
  if (id) removeMeta('documents', { id });
  if (id && id === currentDoc.id) { currentDoc = { type: null, id: null }; }
  refreshDocsList();
  render();
});

window.addEventListener('doc_renamed', (e) => {
  const { id, title, type } = e.detail || {};
  try { logEvent('docs', 'doc_renamed_event', { id, title, type, origin: e?.detail?.origin || 'unknown' }); } catch {}
  if (id && title && DOCS.has(id)) {
    const meta = DOCS.get(id) || {};
    const newMeta = { ...meta, title, type: type || meta.type };
    DOCS.set(id, newMeta);
    upsertMeta('documents', { id, title: newMeta.title, type: newMeta.type || 'note' });
  }
  refreshDocsList();
});
// Tracciare realtime su catalogo documenti
subscribeMeta('documents', (payload) => {
  try {
    const evt = payload?.eventType || payload?.event;
    const newRow = payload?.new;
    const oldRow = payload?.old;
    try { logEvent('docs', 'documents_realtime', { evt, newId: newRow?.id || null, oldId: oldRow?.id || null }); } catch {}
    if (newRow && newRow.id) {
      // Nota: l'evento arriva dalla tabella remota 'notes' e contiene i prefissi tecnici
      const title = sanitizeTitle(newRow.title);
      let type = newRow.type || 'note';
      if (!newRow.type && newRow.body) {
        try { type = JSON.parse(newRow.body || '{}')?.type || 'note'; } catch {}
      }
      DOCS.set(newRow.id, { title, type });
      refreshDocsList();
    } else if ((evt === 'DELETE' || !newRow) && oldRow?.id) {
      if (oldRow.id !== 'fixed_list') DOCS.delete(oldRow.id);
      refreshDocsList();
      // Se sto visualizzando il documento rimosso, non forzare la fixed_list: torna al placeholder
      if (currentDoc.id === oldRow.id) { currentDoc = { type: null, id: null }; render(); }
     }
  } catch {}
});

// Arricchisco hydration con logging diagnostico
(async function hydrateDocsFromRemote(){
  try {
    const rows = await listMeta('documents');
    const fetched = Array.isArray(rows) ? rows : [];
    const newIds = new Set(fetched.filter(r => r && r.id && r.title).map(r => r.id));
    try { logEvent('docs', 'documents_hydrate', { count: fetched.length, ids: fetched.map(r=>r.id).slice(0,50) }); } catch {}
    // Riconciliazione: rimuovi tutto ciò che non è più presente remotamente (eccetto fixed_list)
    try {
      for (const id of Array.from(DOCS.keys())) {
        if (id !== 'fixed_list' && !newIds.has(id)) DOCS.delete(id);
      }
    } catch {}
    // Upsert dei documenti remoti
    fetched.forEach(r => { if (r && r.id && r.title) DOCS.set(r.id, { title: r.title, type: r.type || 'note' }); });
    refreshDocsList();
  } catch {}
})();

function toolsPage() {
  const container = el('div', { class: '' });
  const toolbar = el('div', { id: 'toolbar', class: 'toolbar', style: 'display:flex; gap:8px; align-items:center;' });

  const layout = el('div', { style: 'display:grid; grid-template-columns: 280px 1fr; gap:16px; align-items:start;' });

  const docArea = el('section', { class: '' });
  if (currentDoc && currentDoc.type === 'checklist') {
    const meta = DOCS.get(currentDoc.id) || {};
    initChecklistUI(docArea, { id: currentDoc.id, title: meta.title });
  } else if (currentDoc && currentDoc.type === 'note') {
    Notes.initNotesUI(docArea);
    if (currentDoc.id && typeof Notes.openNote === 'function') {
      const meta = DOCS.get(currentDoc.id) || {};
      Notes.openNote(docArea, { id: currentDoc.id, title: meta.title || '', body: '' });
    }
  } else {
    // Nessun documento selezionato: mostra solo pannello documenti e un placeholder
    const placeholder = el('div', { class: 'muted', style: 'padding:8px 0;' }, 'Seleziona un documento dal pannello a sinistra.');
    docArea.appendChild(placeholder);
  }

  layout.append(documentsPanel(), docArea);
  // Ensure two-column layout: documents panel on the left, content on the right
  try { layout.style.gridTemplateColumns = '280px 1fr'; } catch {}
  container.append(toolbar, layout);
  return container;
}

function loginPage() {
  const container = el('div', { class: '' });
  initAuthUI(container, () => { logEvent('auth', 'login_success'); render(); });
  return container;
}

export function render() {
  // Cleanup effetti attivi della checklist (unsubscribe, interval) prima di rimontare la UI
  try { cleanupChecklistEffects && cleanupChecklistEffects(); } catch {}
  const root = document.getElementById('app-root');
  root.innerHTML = '';
  if (isAuthenticated()) document.body.classList.remove('login-bg'); else document.body.classList.add('login-bg');
  
  // Pulisci la mappa DOCS quando entri negli strumenti per evitare voci fantasma da sessioni precedenti
  try {
    if (isAuthenticated()) {
      // non toccare fixed_list
      for (const id of Array.from(DOCS.keys())) {
        if (id !== 'fixed_list') DOCS.delete(id);
      }
    }
  } catch {}

  // Reconciliation automatica da remoto ad ogni render autenticato (senza input utente)
  try {
    if (isAuthenticated()) {
      (async function(){
        const rows = await listMeta('documents');
        const fetched = Array.isArray(rows) ? rows : [];
        const newIds = new Set(fetched.filter(r => r && r.id && r.title).map(r => r.id));
        for (const id of Array.from(DOCS.keys())) {
          if (id !== 'fixed_list' && !newIds.has(id)) DOCS.delete(id);
        }
        fetched.forEach(r => { if (r && r.id && r.title) DOCS.set(r.id, { title: r.title, type: r.type || 'note' }); });
        refreshDocsList();
      })();
    }
  } catch {}

  // Gestione robusta degli sfondi durante il cambio login/strumenti
  const isLogin = document.body.classList.contains('login-bg');
  import('./backgrounds.js?v=rox19').then(mod => {
    // Prima disattivo tutti gli sfondi
    mod.toggleBackground('vantaDiskLogin', false);
    mod.toggleBackground('vantaFogTools', false);
    mod.toggleBackground('lightRaysLogin', false);
    
    // Poi attivo solo quello giusto con un piccolo delay per evitare race conditions
    setTimeout(() => {
      if (isLogin) {
        mod.toggleBackground('vantaDiskLogin', true);
      } else {
        mod.toggleBackground('vantaFogTools', true);
      }
    }, 50);
  });
  root.appendChild(header());
  const main = el('main');
  root.appendChild(main);

  // se esiste ancora un vecchio FAB fisso, rimuovilo
  const oldFab = document.getElementById('log-fab');
  if (oldFab) oldFab.remove();

  // contenitore log non ancorato, in fondo alla pagina sopra il footer
  const logWrap = el('div', { id: 'log-wrap', style: 'margin:16px 0;' });
  const logToggle = el('button', {
    id: 'log-toggle-btn',
    class: 'button muted',
    onclick: () => {
      const p = document.getElementById('log-panel');
      if (p) p.classList.toggle('hidden');
    }
  }, 'Log');
  logWrap.appendChild(logToggle);

  // mount contenitore log prima del footer
  root.appendChild(logWrap);
  // footer non ancorato
  root.appendChild(footer());

  // inizializza pannello log dentro logWrap (non fisso)
  initLoggerPanel(logWrap);
  initBackgrounds();

  if (isAuthenticated()) {
    main.appendChild(toolsPage());
    setTimeout(refreshDocsList, 0);
    // Disabilitato: self-test automatico non visibile in UI
    // setTimeout(() => {
    //   try {
    //     if (!localStorage.getItem('roxstar_selftest_done')) {
    //       if (typeof runSyncSelfTest === 'function') runSyncSelfTest();
    //       localStorage.setItem('roxstar_selftest_done', '1');
    //     }
    //   } catch {}
    // }, 400);
  } else {
    main.appendChild(loginPage());
  }
}

// bootstrap iniziale
render();

// inserisco la chiamata al refresh dopo la creazione documenti
// Trova i gestori di creazione e aggiorna la lista
// Nota: mantenere lo stile esistente, qui aggiorniamo solo la lista visiva
(function patchDocCreationHandlers(){
  const handler = (type) => () => setTimeout(refreshDocsList, 0);
  document.addEventListener('rox:create-checklist:done', handler('checklist'));
  document.addEventListener('rox:create-note:done', handler('note'));
})();

window.addEventListener('DOMContentLoaded', () => {
  render();
});
window.addEventListener('storage', (e) => { if (e.key === 'roxstar_auth_user') render(); });

// Self-test sincronizzazione: non invasivo, nessun documento visibile creato
async function runSyncSelfTest() {
  const indicator = document.getElementById('sync-selftest');
  if (indicator) { indicator.textContent = 'Testing…'; indicator.style.color = '#aaa'; }
  const testId = 'test_' + uid();
  const table = `checklist_${testId}`;
  const itemId = 't_' + uid();
  try {
    // 1) Prepara listener realtime specifico per la checklist (senza creare meta-documenti visibili)
    let gotRealtime = false;
    let gotPolling = false;
    let unsub = null;
    try {
      unsub = await subscribeMeta(table, (payload) => {
        try {
          const newRow = payload?.new;
          if (newRow && (newRow.id === itemId)) {
            gotRealtime = true;
          }
        } catch {}
      });
    } catch {}
    // 2) Upsert di un item che dovrebbe generare evento realtime
    await upsertMeta(table, { id: itemId, text: 'ping', checked: false, column: 'left', fixed: false });
    // 3) Attendi fino a 2.5s per realtime
    await new Promise(r => setTimeout(r, 2500));
    if (!gotRealtime) {
      // 4) Fallback: polling per verificare la presenza dei dati entro 5s
      try {
        const rows = await listMeta(table);
        if (Array.isArray(rows) && rows.find(x => x.id === itemId)) gotPolling = true;
      } catch {}
    }
    // 5) Aggiorna UI
    if (indicator) {
      if (gotRealtime) { indicator.textContent = 'Self-test: realtime OK'; indicator.style.color = '#1db954'; }
      else if (gotPolling) { indicator.textContent = 'Self-test: polling OK'; indicator.style.color = '#e6b800'; }
      else { indicator.textContent = 'Self-test: FAIL'; indicator.style.color = '#e74c3c'; }
    }
    logEvent('selftest', 'sync_result', { realtime: gotRealtime, polling: gotPolling });
    // 6) Cleanup soft (non bloccare in caso fallisca)
    try { if (typeof unsub === 'function') unsub(); } catch {}
    try { await removeMeta(table, { id: itemId }); } catch {}
    // nessuna rimozione documenti perché non creati
  } catch (e) {
    if (indicator) { indicator.textContent = 'Self-test: ERROR'; indicator.style.color = '#e74c3c'; }
    logEvent('selftest', 'error', { message: e?.message });
  }
}

// Helper DOM minimale
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  if (attrs && typeof attrs === 'object') {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class' || k === 'className') node.className = v || '';
      else if (k === 'style' && typeof v === 'string') node.setAttribute('style', v);
      else if (k.startsWith('on') && typeof v === 'function') node[k] = v;
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
  }
  for (const ch of children) {
    if (ch == null) continue;
    if (Array.isArray(ch)) ch.forEach(c => c != null && node.append(c.nodeType ? c : document.createTextNode(String(c))));
    else node.append(ch.nodeType ? ch : document.createTextNode(String(ch)));
  }
  return node;
}

function header() {
  const authenticated = typeof isAuthenticated === 'function' && isAuthenticated();
  if (!authenticated) {
    // Login: header con marquee scorrevole
    const track = el('div', { class: 'track' }, 'ROXSTAR RIZOZZE GESTIANALI');
    const h = el('header', { class: 'marquee' }, track);
    return h;
  }
  // Tools: titolo richiesto + pulsanti a destra
  const left = el('h1', { class: 'tools-title' }, 'STURMENTI E RIZOZZE GESTIANALI ROXSTAR');
  const right = el('div', {});
  if (authenticated) {
    const resetBtn = el('button', { class: 'button muted', style: 'margin-right:8px;', onclick: async () => {
      try { await resetLocalData(['documents']); } catch {}
      try { for (const id of Array.from(DOCS.keys())) { if (id !== 'fixed_list') DOCS.delete(id); } } catch {}
      try { await (async function(){ const rows = await listMeta('documents'); const fetched = Array.isArray(rows) ? rows : []; const newIds = new Set(fetched.filter(r => r && r.id && r.title).map(r => r.id)); for (const id of Array.from(DOCS.keys())) { if (id !== 'fixed_list' && !newIds.has(id)) DOCS.delete(id); } fetched.forEach(r => { if (r && r.id && r.title) DOCS.set(r.id, { title: r.title, type: r.type || 'note' }); }); refreshDocsList(); })(); } catch {}
    } }, 'Reset cache locale');
    const btn = el('button', { class: 'button', onclick: () => { try { logout(); } catch {}; render(); } }, 'Logout');
    right.append(resetBtn, btn);
  }
  const h = el('header', { class: 'app-header tools-header', style: 'display:flex; justify-content:space-between; align-items:center; padding:8px 0;' }, left, right);
  return h;
}

function footer() {
  // Footer glow richiesto dalla guida
  const text = el('div', { class: 'text' }, 'COOKED BY FRED CAMPZILLA');
  return el('footer', { class: 'glow' }, text);
}

function documentsPanel() {
  const sec = el('section', {});
  const h2 = el('h2', {}, 'Documenti');
  const ul = el('ul', { id: 'docs-list' });
  sec.append(h2, ul);
  return sec;
}

function selectDocument(id) {
  const meta = DOCS.get(id) || {};
  const type = meta.type || (id === 'fixed_list' ? 'checklist' : 'note');
  currentDoc = { id, type };
  render();
}