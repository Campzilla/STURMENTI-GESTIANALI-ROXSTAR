// notes.js
/**
 * UI Note con editor semplice titolo + testo
 */
import { logEvent, logError } from './logger.js?v=rox13';
import { upsert, remove } from './sync.js?v=rox13';
import { getById, subscribe as subscribeSync } from './sync.js?v=rox13';

export const Notes = {
  currentNoteId: null
};

export function initNotesUI(container) {
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'notes';

  const title = document.createElement('input');
  title.type = 'text';
  title.placeholder = 'Titolo nota';

  const body = document.createElement('textarea');
  body.rows = 10;
  body.placeholder = 'Scrivi la nota qui...';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'button';
  saveBtn.textContent = 'Salva';
  saveBtn.addEventListener('click', async () => {
    const id = Notes.currentNoteId || ('nt_' + Math.random().toString(36).slice(2));
    const titleVal = title.value.trim() || 'Nuova nota';
    const row = { id, title: titleVal, body: body.value || '' };
    try {
      await upsert('notes', row);
      window.dispatchEvent(new CustomEvent('doc_saved', { detail: { id, title: titleVal, type: 'note' } }));
      logEvent('notes', 'save', { id });
    } catch (e) {
      logError('notes_save_failed', e);
    }
    Notes.currentNoteId = id;
  });

  const renameBtn = document.createElement('button');
  renameBtn.className = 'button';
  renameBtn.textContent = 'Rinomina';
  renameBtn.addEventListener('click', () => {
    const id = Notes.currentNoteId;
    if (!id) return;
    const newTitle = (title.value || '').trim();
    if (!newTitle) return;
    window.dispatchEvent(new CustomEvent('doc_renamed', { detail: { id, title: newTitle, type: 'note' } }));
    logEvent('notes', 'rename', { id });
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'button';
  deleteBtn.textContent = 'Elimina';
  deleteBtn.addEventListener('click', async () => {
    const id = Notes.currentNoteId;
    if (!id) return;
    try {
      await remove('notes', { id });
      window.dispatchEvent(new CustomEvent('doc_removed', { detail: { id } }));
      logEvent('notes', 'remove', { id });
      Notes.currentNoteId = null;
      title.value = '';
      body.value = '';
    } catch (e) {
      logError('notes_delete_failed', e);
    }
  });

  wrap.append(title, body, saveBtn, renameBtn, deleteBtn);
  container.appendChild(wrap);

  // realtime su note
  try {
    subscribeSync('notes', (payload) => {
      // ignoro eventi tecnici filtrati in sync.js
      const evt = payload?.eventType || payload?.event;
      if (evt === 'DELETE') {
        if (payload?.old?.id && payload.old.id === Notes.currentNoteId) {
          Notes.currentNoteId = null;
          title.value = '';
          body.value = '';
        }
        return;
      }
      const row = payload?.new;
      if (!row || !row.id) return;
      if (Notes.currentNoteId && Notes.currentNoteId !== row.id) return;
      if (row.title) title.value = row.title;
      if (typeof row.body === 'string') body.value = row.body;
    });
  } catch {}
}

export function openNote(container, meta = {}) {
  const { id, title: initialTitle = '', body: initialBody = '' } = meta || {};
  Notes.currentNoteId = id || null;
  const inputs = container.querySelectorAll('input[type="text"], textarea');
  const [title, body] = inputs;
  if (title) title.value = initialTitle || '';
  if (body) body.value = initialBody || '';
}