// ui.js
// Inizializza la UI, monta header, main (login o tools) e footer.
import { initAuthUI, isAuthenticated, logout } from './auth.js?v=rox13';
import { initChecklistUI, cleanupChecklistEffects } from './checklist.js?v=rox13';
import * as Notes from './notes.js?v=rox13';
import { initLoggerPanel, logEvent } from './logger.js?v=rox13';
import { initBackgrounds } from './backgrounds.js?v=rox13';
import { upsert as upsertMeta, remove as removeMeta, subscribe as subscribeMeta } from './sync.js?v=rox13';
import { list as listMeta } from './sync.js?v=rox13';

// Util per id
function uid() { return Math.random().toString(36).slice(2); }

// Gestione documenti creati (Note/Checklist); primo sempre la lista fissa
const DOCS = new Map([[ 'fixed_list', { title: 'LISTA DAA SPESSA', type: 'checklist' } ]]);

// Bootstrap da storage della tabella "documents" (offline o online)
(function bootstrapDocsFromStorage(){
  try {
    const raw = localStorage.getItem('roxstar_table_documents');
    const arr = JSON.parse(raw || '[]');
    if (Array.isArray(arr)) {
      arr.forEach(r => { if (r && r.id && r.title && r.type) DOCS.set(r.id, { title: r.title, type: r.type }); });
    }
  } catch {}
  if (!DOCS.has('fixed_list')) DOCS.set('fixed_list', { title: 'LISTA DAA SPESSA', type: 'checklist' });
})();

// Hydration remoto: se Supabase è configurato, carica e fondi i documenti
(async function hydrateDocsFromRemote(){
  try {
    const rows = await listMeta('documents');
    if (Array.isArray(rows) && rows.length) {
      rows.forEach(r => { if (r && r.id && r.title) DOCS.set(r.id, { title: r.title, type: r.type || 'note' }); });
      refreshDocsList();
    }
  } catch {}
})();

// helper per pulire prefissi tecnici del compat layer
function sanitizeTitle(raw) {
  let t = String(raw || '');
  // rimuove prefisso __DOC__: e prefisso checklist __CHK__:docId|
  t = t.replace(/^__DOC__:/, '');
  t = t.replace(/^__CHK__:[^|]*\|/, '');
  return t;
}

// Sottoscrizione realtime ai cambiamenti della tabella documents (se Supabase è configurato)
subscribeMeta('documents', (payload) => {
  try {
    const evt = payload?.eventType || payload?.event;
    const newRow = payload?.new;
    const oldRow = payload?.old;
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
  if (id && title) DOCS.set(id, { title, type: type || (id === 'fixed_list' ? 'checklist' : 'note') });
  // Aggiorna meta documento su backend SOLO quando necessario per non sovrascrivere il testo delle note
  // - Checklist: sempre (serve solo il catalogo)
  // - Note: solo alla creazione (quando il documento non esisteva nel catalogo)
  const isChecklist = (type === 'checklist') || (id === 'fixed_list');
  const isNewDoc = !existed;
  if (isChecklist || isNewDoc) {
    if (id && title) upsertMeta('documents', { id, title, type: type || (id === 'fixed_list' ? 'checklist' : 'note') });
  }
  // Se è un documento nuovo diverso da fixed_list, selezionalo automaticamente
  if (isNewDoc && id && id !== 'fixed_list') {
    currentDoc = { id, type: type || 'note' };
  }
  refreshDocsList();
  render();
});
window.addEventListener('doc_removed', (e) => {
  const { id } = e.detail || {};
  if (id && id !== 'fixed_list') DOCS.delete(id);
  // rimuovi meta dal catalogo
  if (id) removeMeta('documents', { id });
  // se sto visualizzando il documento rimosso, torna al placeholder (nessun documento selezionato)
  if (id && id === currentDoc.id) { currentDoc = { type: null, id: null }; }
  refreshDocsList();
  render();
});
window.addEventListener('doc_renamed', (e) => {
  const { id, title, type } = e.detail || {};
  if (id && title && DOCS.has(id)) {
    const meta = DOCS.get(id) || {};
    const newMeta = { ...meta, title, type: type || meta.type };
    DOCS.set(id, newMeta);
    upsertMeta('documents', { id, title: newMeta.title, type: newMeta.type || 'note' });
  }
  refreshDocsList();
});

function documentsPanel() {
  const card = el('section', { class: '' });
  card.appendChild(el('h2', { class: 'docs-title' }, 'Documenti'));
  const list = el('ul', { id: 'docs-list', style: 'margin:0; padding-left:0;' });
  card.appendChild(list);
  refreshDocsList();
  return card;
}

let cachedMarquee = null;
// Carica titoli header da TESTI_APP.txt (sezione: App - Titoli e intestazioni)
let cachedTitles = null;
async function loadTitlesFromAssets() {
  if (cachedTitles) return cachedTitles;
  try {
    const res = await fetch('./Assets e risorse/TESTI_APP.txt');
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex(l => l.toLowerCase().includes('app - titoli'));
    if (idx === -1) return null;
    const block = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim()) break;
      if (l.startsWith('===')) break;
      block.push(l.trim());
    }
    const stripParens = s => s?.replace(/\s*\(.*?\)\s*$/, '').trim();
    const login = stripParens(block.find(l => l.toLowerCase().includes('login')) || '');
    const tools = stripParens(block.find(l => l.toLowerCase().includes('pagina strumenti')) || '');
    cachedTitles = { login, tools };
    return cachedTitles;
  } catch {
    return null;
  }
}
async function loadMarqueeFromAssets() {
  if (cachedMarquee) return cachedMarquee;
  try {
    const res = await fetch('./Assets e risorse/TESTI_APP.txt');
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const idx = lines.findIndex(l => l.toLowerCase().startsWith('=== marquee'));
    if (idx !== -1) {
      const parts = [];
      for (let i = idx + 1; i < lines.length; i++) {
        const l = lines[i];
        if (!l.trim()) break;
        if (l.startsWith('===')) break;
        parts.push(l.trim());
      }
      cachedMarquee = parts.join(' ').trim();
      return cachedMarquee;
    }
    return null;
  } catch {
    return null;
  }
}

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') e.className = v; else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v); else if (k === 'html') e.innerHTML = v; else e.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}

function header() {
  // Header condizionale: login -> marquee scorrevole; strumenti -> titolo statico da TESTI_APP
  const h = el('header', { class: isAuthenticated() ? 'tools-header' : 'marquee' }, []);
  if (!isAuthenticated()) {
    const track = el('div', { class: 'track' }, 'ROXSTAR RIZOZZE GESTIANALI');
    h.appendChild(track);
    loadMarqueeFromAssets().then(txt => { if (txt) track.textContent = txt; });
  } else {
    const title = el('h1', { class: 'tools-title' }, 'STURMENTI E RIZOZZE GESTIANALI ROXSTAR');
    // Sostituisci con il titolo da file se disponibile
    loadTitlesFromAssets().then(t => { if (t?.tools) title.textContent = t.tools; });
    h.appendChild(title);
  }
  return h;
}

function footer() {
  return el('footer', { class: 'glow' }, [
    el('div', { class: 'text' }, 'COOKED BY FRED CAMPZILLA')
  ]);
}

// Stato documento selezionato (mostra un solo documento alla volta)
let currentDoc = { type: null, id: null };
// Avvio in modalità login se non autenticato
if (!isAuthenticated()) currentDoc = { type: null, id: null };
function selectDocument(id) {
  const meta = DOCS.get(id);
  if (meta?.type) currentDoc = { type: meta.type, id };
  else if (id === 'fixed_list') currentDoc = { type: 'checklist', id };
  else currentDoc = { type: 'note', id };
  render();
}

function toolsPage() {
  const container = el('div', { class: '' });

  const toolbar = el('div', { style: 'display:flex; gap:8px; align-items:center; margin-bottom:12px;' }, [
    el('button', { class: 'button', onclick: () => { logout(); render(); } }, 'Logout'),
    el('button', { class: 'button', onclick: () => {
      const id = 'cl_' + uid();
      window.dispatchEvent(new CustomEvent('doc_saved', { detail: { id, title: 'Nuova checklist', type: 'checklist' } }));
      currentDoc = { type: 'checklist', id };
      render();
    } }, 'Crea checklist'),
    el('button', { class: 'button', onclick: () => {
      const id = 'nt_' + uid();
      window.dispatchEvent(new CustomEvent('doc_saved', { detail: { id, title: 'Nuova nota', type: 'note' } }));
      currentDoc = { type: 'note', id };
      render();
    } }, 'Crea nota'),
    // Pulsante self-test sincronizzazione
    el('button', { id: 'btn-selftest', class: 'button muted', onclick: () => runSyncSelfTest() }, 'Self-test Sync'),
    // Indicatore risultato self-test
    el('span', { id: 'sync-selftest', style: 'margin-left:4px; font-size:12px; color:#aaa;' }, '—')
  ]);

  const layout = el('div', { style: 'display:grid; grid-template-columns: 1fr; gap:16px;' });

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
  
  // Gestione robusta degli sfondi durante il cambio login/strumenti
  const isLogin = document.body.classList.contains('login-bg');
  import('./backgrounds.js?v=rox10').then(mod => {
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
    // dopo aver montato la pagina strumenti aggiorno il pannello documenti
    setTimeout(refreshDocsList, 0);
    // auto self-test solo una volta per sessione
    setTimeout(() => {
      try {
        if (!localStorage.getItem('roxstar_selftest_done')) {
          if (typeof runSyncSelfTest === 'function') runSyncSelfTest();
          localStorage.setItem('roxstar_selftest_done', '1');
        }
      } catch {}
    }, 400);
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