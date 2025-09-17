// notes.js
/**
 * Editor Note con titolo, area testo e pulsanti Salva, Elimina, Rinomina.
 */
import { logEvent } from './logger.js';
import { upsert, remove } from './sync.js?v=rox7';
import { getById, subscribe as subscribeSync } from './sync.js?v=rox7';

let currentId = null;
let unsubscribeNotes = null;

function uid() { return Math.random().toString(36).slice(2); }

export function initNotesUI(container) {
  const wrap = document.createElement('div');
  wrap.className = 'notes';
  wrap.innerHTML = `
    <h2 style="margin:0">Note</h2>
    <input type="text" id="note-title" placeholder="Titolo" />
    <textarea id="note-body" rows="8" placeholder="Scrivi qui..."></textarea>
    <div style="display:flex; gap:8px;">
      <button class="button" id="save">Salva</button>
      <button class="button" id="rename">Rinomina</button>
      <button class="button" id="delete">Elimina</button>
    </div>
  `;
  container.appendChild(wrap);

  const title = wrap.querySelector('#note-title');
  const body = wrap.querySelector('#note-body');
  const save = wrap.querySelector('#save');
  const rename = wrap.querySelector('#rename');
  const del = wrap.querySelector('#delete');

  save.addEventListener('click', () => {
    if (!currentId) currentId = uid();
    const note = { id: currentId, title: title.value.trim() || 'Senza titolo', body: body.value };
    upsert('notes', note);
    logEvent('notes', 'save', { id: currentId, title: note.title });
    window.dispatchEvent(new CustomEvent('doc_saved', { detail: { id: currentId, title: note.title, type: 'note' } }));
  });

  rename.addEventListener('click', () => {
    if (!currentId) return;
    // Rinominazione inline: focus e conferma su Enter/blur
    title.disabled = false;
    title.focus();
    title.select();
    const prev = title.value.trim();
    const finalize = () => {
      const newTitle = title.value.trim();
      title.removeEventListener('blur', finalize);
      title.removeEventListener('keydown', onKey);
      if (!newTitle || newTitle === prev) return;
      const note = { id: currentId, title: newTitle, body: body.value };
      upsert('notes', note);
      logEvent('notes', 'rename', { id: currentId, title: newTitle });
      window.dispatchEvent(new CustomEvent('doc_renamed', { detail: { id: currentId, title: newTitle, type: 'note' } }));
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); finalize(); } };
    title.addEventListener('blur', finalize);
    title.addEventListener('keydown', onKey);
  });

  del.addEventListener('click', () => {
    if (!currentId) return;
    remove('notes', { id: currentId });
    logEvent('notes', 'delete', { id: currentId });
    window.dispatchEvent(new CustomEvent('doc_removed', { detail: { id: currentId } }));
    currentId = null;
    title.value = '';
    body.value = '';
  });

  // Sottoscrizione realtime alle note
  (async () => {
    try { if (typeof unsubscribeNotes === 'function') unsubscribeNotes(); } catch {}
    unsubscribeNotes = await subscribeSync('notes', (payload) => {
      try {
        const evt = payload?.eventType || payload?.event;
        const newRow = payload?.new; const oldRow = payload?.old;
        if (newRow && currentId && newRow.id === currentId) {
          title.value = newRow.title || '';
          body.value = newRow.body || '';
        } else if ((evt === 'DELETE' || !newRow) && oldRow && currentId && oldRow.id === currentId) {
          currentId = null;
          title.value = '';
          body.value = '';
        }
      } catch {}
    });
  })();
}

// Nuovo: apertura/precompilazione nota per id
export function openNote(container, note = {}) {
  const wrap = container.querySelector('.notes');
  if (!wrap) return;
  currentId = note.id || null;
  const titleEl = wrap.querySelector('#note-title');
  const bodyEl = wrap.querySelector('#note-body');
  if (titleEl) titleEl.value = note.title || '';
  if (bodyEl) bodyEl.value = note.body || '';
  // prova a caricare da remoto se disponibile
  if (currentId) {
    (async () => {
      try {
        const rec = await getById('notes', currentId);
        if (rec) {
          if (titleEl) titleEl.value = rec.title || '';
          if (bodyEl) bodyEl.value = rec.body || '';
        }
      } catch {}
    })();
  }
}