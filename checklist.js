// checklist.js
/**
 * Gestione UI e dati per la checklist in due colonne con regole richieste.
 */
import { logEvent, logError } from './logger.js?v=rox13';
import { upsert, remove, getSupabase } from './sync.js?v=rox13';
import { list as listSync, subscribe as subscribeSync } from './sync.js?v=rox13';

const LEFT = 'left';
const RIGHT = 'right';

function uid() { return Math.random().toString(36).slice(2); }
function stableIdForFixed(text){
  return 'fixed_' + String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Stato per-documento
const states = new Map();
function getState(docId) {
  if (!states.has(docId)) {
    states.set(docId, { items: [], fixedLoaded: docId !== 'fixed_list', fixedAnnounced: false, title: 'Checklist', leftLabel: 'Da comprare', rightLabel: 'Comprato / in Frigo' });
  }
  return states.get(docId);
}
// stato corrente puntato dinamicamente
let state = getState('fixed_list');

function createItem(text, column = LEFT, fixed = false) {
  const id = fixed ? stableIdForFixed(text) : uid();
  return { id, text, checked: false, column, fixed };
}

function restoreOfflineChecklist(table) {
  try {
    const saved = JSON.parse(localStorage.getItem('roxstar_table_' + table) || '[]');
    if (!Array.isArray(saved)) return;
    const byId = new Map(state.items.map(i => [i.id, i]));
    saved.forEach(r => {
      if (r && r.id) {
        if (r.fixed) {
          // aggiorna lo stato delle voci fisse esistenti
          const it = byId.get(r.id);
          if (it) { it.checked = !!r.checked; it.column = r.column === RIGHT ? RIGHT : LEFT; }
        } else {
          // se sto ripristinando la tabella fixed ("checklist"), NON re-inserire voci non fisse
          if (table === 'checklist') return;
          // re-inserisci le voci custom se mancanti per checklist personalizzate
          if (!byId.has(r.id)) { state.items.push({ ...r, fixed: false }); byId.set(r.id, r); }
        }
      }
    });
  } catch {}
}

async function ensureFixedList() {
  if (state.fixedLoaded) return;
  try {
    const res = await fetch('./Assets e risorse/TESTI_APP.txt');
    if (!res.ok) { state.fixedLoaded = true; return; }
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const startIdx = lines.findIndex(l => l.toLowerCase().includes('=== lista daa spessa'));
    if (startIdx === -1) { state.fixedLoaded = true; return; }
    const fixed = [];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const raw = lines[i];
      const l = raw.trim();
      if (!l) continue;
      if (l.toLowerCase().startsWith('whitelist:')) break;
      if (l.startsWith('===')) break;
      fixed.push(l.toUpperCase()); // ingredienti in maiuscolo
    }
    // Rimuovi voci fixed precedenti e ricrea tutte sul lato sinistro, con ID stabili
    state.items = state.items.filter(i => !i.fixed);
    fixed.forEach(name => state.items.push(createItem(name, LEFT, true)));
    // Ripristina stato da storage offline (check/column + voci custom)
    restoreOfflineChecklist('checklist');
  } catch (e) {
    logError('fixed_list_load_failed', e);
  } finally {
    state.fixedLoaded = true;
    if (!state.fixedAnnounced) {
      window.dispatchEvent(new CustomEvent('doc_saved', { detail: { id: 'fixed_list', title: 'LISTA DAA SPESSA', type: 'checklist' } }));
      state.fixedAnnounced = true;
    }
  }
}

function renderColumn(container, column, table) {
  container.innerHTML = '';

  const isCustom = table !== 'checklist';
  const title = document.createElement('h2');
  const label = column === LEFT ? (state.leftLabel || 'Da comprare') : (state.rightLabel || 'Comprato / in Frigo');
  title.textContent = label;
  // Colore titolo per distinguere: fisso (rosso/viola), custom (giallo/azzurro)
  title.style.color = isCustom
    ? (column === LEFT ? 'var(--giallo)' : 'var(--azzurro-colonna)')
    : (column === LEFT ? 'var(--rosso-colonna)' : 'var(--viola-colonna)');
  container.appendChild(title);

  const moveBtn = document.createElement('button');
  moveBtn.className = 'button';
  moveBtn.textContent = "Sposta nell'altra colonna";
  moveBtn.addEventListener('click', () => {
    const selected = state.items.filter(i => i.column === column && i.checked);
    if (selected.length === 0) {
      logEvent('checklist', 'move_selected_skipped', { from: column, reason: 'none_selected' });
      updateAll(table);
      return;
    }
    selected.forEach(i => { i.column = column === LEFT ? RIGHT : LEFT; i.checked = false; });
    logEvent('checklist', 'move_selected', { count: selected.length, from: column });
    upsert(table, selected);
    updateAll(table);
  });
  container.appendChild(moveBtn);

  const list = document.createElement('div');
  container.appendChild(list);

  // Mostra prima voci fisse (senza X), poi le altre
  const items = state.items.filter(i => i.column === column).sort((a,b) => (a.fixed === b.fixed ? 0 : a.fixed ? -1 : 1));
  items.forEach(i => list.appendChild(renderItem(i, table)));
}

function renderItem(item, table) {
  const row = document.createElement('div');
  row.className = 'item' + (item.checked ? ' checked' : '');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = !!item.checked; // spunta = selezione temporanea (barratura) per spostare
  checkbox.title = 'Seleziona per spostare';
  checkbox.addEventListener('change', () => {
    item.checked = checkbox.checked;
    logEvent('checklist', item.checked ? 'check' : 'uncheck', { id: item.id });
    upsert(table, item);
    updateAll(table);
  });

  const span = document.createElement('span');
  span.className = 'text';
  span.textContent = item.text;

  const removeBtn = (!item.fixed) ? (() => {
    const b = document.createElement('button');
    b.className = 'remove';
    b.textContent = 'X';
    b.addEventListener('click', () => {
      const idx = state.items.findIndex(x => x.id === item.id);
      if (idx >= 0) state.items.splice(idx, 1);
      logEvent('checklist', 'delete', { id: item.id });
      remove(table, { id: item.id });
      updateAll(table);
    });
    return b;
  })() : null;

  if (removeBtn) row.append(checkbox, span, removeBtn); else row.append(checkbox, span);
  return row;
}

function updateAll(table) {
  // Normalizza eventuali item senza colonna assegnata (evita sparizioni)
  state.items.forEach(i => { if (i.column !== LEFT && i.column !== RIGHT) i.column = LEFT; });
  const leftCol = document.getElementById('col-left');
  const rightCol = document.getElementById('col-right');
  if (leftCol && rightCol) {
    renderColumn(leftCol, LEFT, table);
    renderColumn(rightCol, RIGHT, table);
    // Telemetria di rendering per diagnostica rapida
    try {
      const leftCount = state.items.filter(i => i.column === LEFT).length;
      const rightCount = state.items.filter(i => i.column === RIGHT).length;
      logEvent('checklist', 'render', { leftCount, rightCount });
    } catch {}
  }
}

export function initChecklistUI(container, opts = {}) {
  const docId = opts.id || 'fixed_list';
  state = getState(docId);
  const isFixed = docId === 'fixed_list';
  const table = isFixed ? 'checklist' : `checklist_${docId}`;
  if (opts.title) state.title = opts.title;

  // helper per meta colonne
  function loadMeta() {
    if (isFixed) return;
    try {
      const meta = JSON.parse(localStorage.getItem('roxstar_meta_' + table) || '{}');
      if (meta && typeof meta === 'object') {
        if (meta.leftLabel) state.leftLabel = String(meta.leftLabel);
        if (meta.rightLabel) state.rightLabel = String(meta.rightLabel);
      }
    } catch {}
  }
  function saveMeta() {
    if (isFixed) return;
    try {
      const meta = { leftLabel: state.leftLabel, rightLabel: state.rightLabel };
      localStorage.setItem('roxstar_meta_' + table, JSON.stringify(meta));
    } catch {}
  }

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '8px';
  actions.style.marginBottom = '8px';
  actions.style.flexWrap = 'wrap';

  const titleEl = document.createElement('input');
  titleEl.type = 'text';
  titleEl.value = state.title || (isFixed ? 'LISTA DAA SPESSA' : 'Checklist');
  titleEl.placeholder = 'Titolo checklist';
  titleEl.disabled = isFixed; // non rinominabile
  titleEl.style.minWidth = '220px';
  actions.appendChild(titleEl);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'button';
  saveBtn.textContent = 'Salva';
  saveBtn.addEventListener('click', async () => {
    // salva tutti gli item correnti
    await upsert(table, state.items);
    // salva meta documento (titolo, etichette colonne)
    saveMeta();
    // salva meta per titolo documento
    window.dispatchEvent(new CustomEvent('doc_saved', { detail: { id: docId, title: titleEl.value || state.title || 'Checklist', type: 'checklist' } }));
    logEvent('checklist', 'save', { id: docId, count: state.items.length });
  });
  actions.appendChild(saveBtn);

  const renameBtn = document.createElement('button');
  renameBtn.className = 'button';
  renameBtn.textContent = 'Rinomina';
  renameBtn.disabled = isFixed; // non rinominabile la lista fissa
  renameBtn.addEventListener('click', () => {
    if (isFixed) return;
    // Abilita editing inline del titolo
    const prev = titleEl.value || state.title || 'Checklist';
    titleEl.disabled = false;
    titleEl.focus();
    titleEl.select();
    const finalize = () => {
      const newTitle = (titleEl.value || '').trim();
      titleEl.removeEventListener('blur', finalize);
      titleEl.removeEventListener('keydown', onKey);
      titleEl.disabled = false; // rimane editabile
      if (!newTitle || newTitle === prev) return;
      state.title = newTitle;
      titleEl.value = newTitle;
      window.dispatchEvent(new CustomEvent('doc_renamed', { detail: { id: docId, title: newTitle, type: 'checklist' } }));
      logEvent('checklist', 'rename', { id: docId, title: newTitle });
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); finalize(); } };
    titleEl.addEventListener('blur', finalize);
    titleEl.addEventListener('keydown', onKey);
  });
  actions.appendChild(renameBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'button';
  deleteBtn.textContent = 'Elimina';
  deleteBtn.disabled = isFixed; // non eliminabile
  deleteBtn.addEventListener('click', async () => {
    if (isFixed) return;
    if (!confirm('Eliminare questa checklist?')) return;
    // elimina tutti gli item salvati offline/online
    try {
      const raw = JSON.parse(localStorage.getItem('roxstar_table_' + table) || '[]');
      if (Array.isArray(raw)) {
        for (const r of raw) await remove(table, { id: r.id });
      }
    } catch {}
    states.delete(docId);
    window.dispatchEvent(new CustomEvent('doc_removed', { detail: { id: docId } }));
    logEvent('checklist', 'remove', { id: docId });
  });
  actions.appendChild(deleteBtn);

  // Indicatore stato sync (realtime/polling)
  const rtIndicator = document.createElement('span');
  rtIndicator.style.marginLeft = 'auto';
  rtIndicator.style.fontSize = '12px';
  rtIndicator.style.opacity = '0.8';
  rtIndicator.textContent = 'Sync: …';
  actions.appendChild(rtIndicator);

  // Per checklist custom aggiungo campi nome colonne
  let leftInput, rightInput;
  if (!isFixed) {
    loadMeta();
    leftInput = document.createElement('input');
    leftInput.type = 'text';
    leftInput.placeholder = 'Nome colonna sinistra';
    leftInput.value = state.leftLabel || 'Da comprare';
    leftInput.style.minWidth = '180px';

    rightInput = document.createElement('input');
    rightInput.type = 'text';
    rightInput.placeholder = 'Nome colonna destra';
    rightInput.value = state.rightLabel || 'Comprato / in Frigo';
    rightInput.style.minWidth = '180px';

    const applyLabels = () => {
      state.leftLabel = (leftInput.value || 'Da comprare').trim();
      state.rightLabel = (rightInput.value || 'Comprato / in Frigo').trim();
      saveMeta();
      updateAll(table);
      logEvent('checklist', 'columns_renamed', { id: docId, left: state.leftLabel, right: state.rightLabel });
    };
    leftInput.addEventListener('change', applyLabels);
    rightInput.addEventListener('change', applyLabels);
    leftInput.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); applyLabels(); } });
    rightInput.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); applyLabels(); } });

    actions.appendChild(leftInput);
    actions.appendChild(rightInput);
  }

  const input = document.createElement('div');
  input.innerHTML = `
    <h2 style="margin-top:0;">Checklist</h2>
    <div style="display:flex; gap:8px;">
      <input type="text" id="new-item-text" placeholder="Aggiungi voce..." />
      <button class="button" id="add-item">Aggiungi</button>
    </div>
  `;

  const grid = document.createElement('div');
  grid.className = 'checklists';
  if (!isFixed) grid.classList.add('custom');
  const left = document.createElement('div'); left.className = 'column left'; left.id = 'col-left';
  const right = document.createElement('div'); right.className = 'column right'; right.id = 'col-right';
  grid.append(left, right);

  container.append(actions, input, grid);

  // Carica da remoto (se disponibile) e sottoscrivi agli aggiornamenti
  (async () => {
    const applyRows = (rows) => {
      try {
        if (!Array.isArray(rows) || rows.length === 0) return;
        const byId = new Map(state.items.map(i => [i.id, i]));
        rows.forEach(r => {
          if (r && r.id) {
            // Protezione: in checklist personalizzate ignora eventuali item fissi della lista principale
            if (!isFixed && /^fixed_/i.test(String(r.id))) return;
            const prev = byId.get(r.id) || {};
            const isFx = (r.fixed === true) || (prev.fixed === true) || (r.id && /^fixed_/i.test(r.id));
            const col = (r.column === RIGHT ? RIGHT : (r.column === LEFT ? LEFT : (r.column === 'right' ? RIGHT : (prev.column === RIGHT ? RIGHT : LEFT))));
            let text = (r.text !== undefined) ? r.text : prev.text;
            if (isFx && (!text || !String(text).trim())) text = prev.text; // preserva testo ingredienti fissi
            const item = {
              id: r.id,
              text,
              checked: (r.checked !== undefined ? !!r.checked : !!prev.checked),
              column: col,
              fixed: isFx && isFixed // se non è la lista fissa, forzare non-fisso
            };
            byId.set(item.id, item);
          }
        });
        state.items = Array.from(byId.values());
        updateAll(table);
      } catch {}
    };

    try {
      // Carica prima la lista fissa per avere testi corretti come base di merge
      if (isFixed) { await ensureFixedList(); }
      const rows = await listSync(table);
      applyRows(rows);
    } catch {}

    let sb = null;
    try { sb = await getSupabase(); } catch {}

    try {
      const unsub = await subscribeSync(table, (payload) => {
        try {
          const evt = payload?.eventType || payload?.event;
          const newRow = payload?.new; const oldRow = payload?.old;
          if (newRow && newRow.id) {
            applyRows([newRow]);
          } else if ((evt === 'DELETE' || !newRow) && oldRow && oldRow.id) {
            const byId = new Map(state.items.map(i => [i.id, i]));
            byId.delete(oldRow.id);
            state.items = Array.from(byId.values());
            updateAll(table);
          }
        } catch {}
      });
      // opzionalmente memorizza unsub se servisse cancellare in futuro
      container.__unsubChecklist = unsub;
    } catch {}

    // Aggiorna indicatore e fallback a polling se necessario
    rtIndicator.textContent = sb ? 'Sync: realtime + polling' : 'Sync: polling';
    container.__pollChecklist = setInterval(async () => {
      try {
        const rows = await listSync(table);
        applyRows(rows);
      } catch {}
    }, 5000);
    })();
  input.querySelector('#add-item').addEventListener('click', () => {
    const text = input.querySelector('#new-item-text').value.trim();
    if (!text) return;
    const item = createItem(text, LEFT, false);
    state.items.push(item);
    logEvent('checklist', 'create', { text });
    upsert(table, item);
    input.querySelector('#new-item-text').value = '';
    updateAll(table);
  });

  if (isFixed) {
    ensureFixedList().then(() => updateAll(table));
  } else {
    // custom checklist: non caricare lista fissa; ripristina eventuale salvataggio
    restoreOfflineChecklist(table);
    updateAll(table);
  }
}

// Reset dello stato checklist per forzare re-inizializzazione
export function resetChecklistState() {
  states.clear();
  state = getState('fixed_list');
}