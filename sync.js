// sync.js
/**
 * Integrazione Supabase Realtime e caricamento config.
 * Fornisce helper CRUD e subscription; qui si carica config.json se presente, altrimenti config.example.json come fallback.
 */
import { logError, logEvent } from './logger.js';

let cachedConfig = null;

export async function getConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) { cachedConfig = await res.json(); return cachedConfig; }
  } catch {}
  try {
    const res = await fetch('./config.example.json', { cache: 'no-store' });
    if (res.ok) { cachedConfig = await res.json(); return cachedConfig; }
  } catch (e) {
    logError('config_load_failed', e);
  }
  return {};
}

// Lazy import del client Supabase solo quando necessario
let supabaseClient = null;
let supabaseDisabled = false; // circuit breaker: se c'è un errore, disattiva ulteriori tentativi
function isPlaceholder(v) {
  return typeof v === 'string' && /^\s*\$\{[A-Za-z0-9_]+\}\s*$/.test(v);
}
function looksLikeJwt(s) {
  return typeof s === 'string' && s.split('.').length === 3 && s.length > 80;
}
function hasValidSupabaseConfig(cfg) {
  const url = cfg?.supabase?.url?.trim();
  const key = cfg?.supabase?.anonKey?.trim();
  if (!url || !key) return false;
  const badToken = /YOUR_|REPLACE|CHANGEME|EXAMPLE/i;
  if (isPlaceholder(url) || isPlaceholder(key)) return false;
  if (badToken.test(url) || badToken.test(key)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (!/\.supabase\.co/i.test(url)) return false;
  if (!looksLikeJwt(key)) return false;
  return true;
}
export async function getSupabase() {
  if (supabaseDisabled) return null; // già disattivato per errori precedenti
  if (supabaseClient) return supabaseClient;
  const cfg = await getConfig();
  // Abilita Supabase SOLO se esplicitamente richiesto da config
  const realtimeEnabled = cfg?.realtime?.enabled === true;
  if (!realtimeEnabled || !hasValidSupabaseConfig(cfg)) {
    return null; // modalità offline di default
  }
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabaseClient = createClient(cfg.supabase.url, cfg.supabase.anonKey, { auth: { persistSession: false } });
  return supabaseClient;
}

// ===== Persistenza OFFLINE (LocalStorage) =====
const LS_PREFIX = 'roxstar_table_';
function lsKey(table){ return `${LS_PREFIX}${table}`; }
function readOffline(table){
  try { return JSON.parse(localStorage.getItem(lsKey(table)) || '[]'); } catch { return []; }
}
function writeOffline(table, rows){
  try { localStorage.setItem(lsKey(table), JSON.stringify(rows)); } catch {}
}
function upsertOffline(table, values){
  const arr = Array.isArray(values) ? values : [values];
  const existing = readOffline(table);
  const byId = new Map(existing.map(r => [r.id, r]));
  arr.forEach(r => { if (r && r.id) byId.set(r.id, { ...byId.get(r.id), ...r }); });
  const merged = Array.from(byId.values());
  writeOffline(table, merged);
  return merged;
}
function removeOffline(table, match){
  const existing = readOffline(table);
  let filtered = existing;
  if (match && match.id) filtered = existing.filter(r => r.id !== match.id);
  writeOffline(table, filtered);
  return filtered;
}

// Helpers di base per tabella generica
export async function upsert(table, values) {
  try {
    const sb = await getSupabase();
    const arr = Array.isArray(values) ? values : [values];
    // mappatura tabella per Supabase
    const isChecklist = /^checklist(_.+)?$/.test(table);
    const docId = isChecklist ? (table === 'checklist' ? 'fixed_list' : table.replace(/^checklist_/, '')) : null;
    const remoteTable = isChecklist ? 'checklist_items' : table;
    const toRemote = isChecklist ? arr.map(r => ({ ...r, doc_id: docId })) : arr;
    if (!sb) {
      const data = upsertOffline(table, values);
      logEvent('sync', 'upsert_offline', { table, count: Array.isArray(values) ? values.length : 1 });
      return { data, error: null };
    }
    const { data, error } = await sb.from(remoteTable).upsert(toRemote).select();
    if (error) throw error;
    return { data, error: null };
  } catch (e) {
    // Degrada in offline senza segnalare errore bloccante
    supabaseDisabled = true; // disattiva ulteriori tentativi in questa sessione
    const data = upsertOffline(table, values);
    logEvent('sync', 'upsert_offline_fallback', { table, reason: e?.message });
    return { data, error: null };
  }
}

export async function remove(table, match) {
  try {
    const sb = await getSupabase();
    // mappatura tabella per Supabase
    const isChecklist = /^checklist(_.+)?$/.test(table);
    const docId = isChecklist ? (table === 'checklist' ? 'fixed_list' : table.replace(/^checklist_/, '')) : null;
    const remoteTable = isChecklist ? 'checklist_items' : table;
    const remoteMatch = isChecklist ? { ...(match || {}), doc_id: docId } : (match || {});
    if (!sb) {
      const data = removeOffline(table, match);
      logEvent('sync', 'delete_offline', { table, match });
      return { data, error: null };
    }
    const { data, error } = await sb.from(remoteTable).delete().match(remoteMatch).select();
    if (error) throw error;
    return { data, error: null };
  } catch (e) {
    supabaseDisabled = true;
    const data = removeOffline(table, match);
    logEvent('sync', 'delete_offline_fallback', { table, reason: e?.message, match });
    return { data, error: null };
  }
}

export async function list(table, match = null) {
  try {
    const sb = await getSupabase();
    const isChecklist = /^checklist(_.+)?$/.test(table);
    const docId = isChecklist ? (table === 'checklist' ? 'fixed_list' : table.replace(/^checklist_/, '')) : null;
    const remoteTable = isChecklist ? 'checklist_items' : table;
    const remoteMatch = isChecklist ? { ...(match || {}), doc_id: docId } : (match || {});
    if (!sb) {
      const rows = readOffline(table);
      if (!match) return rows;
      // filtro semplice lato client
      return rows.filter(r => Object.entries(match).every(([k, v]) => r[k] === v));
    }
    let query = sb.from(remoteTable).select('*');
    if (remoteMatch && Object.keys(remoteMatch).length) query = query.match(remoteMatch);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (e) {
    supabaseDisabled = true;
    logEvent('sync', 'list_offline_fallback', { table, reason: e?.message });
    return readOffline(table);
  }
}

export async function getById(table, id) {
  try {
    const sb = await getSupabase();
    const isChecklist = /^checklist(_.+)?$/.test(table);
    const docId = isChecklist ? (table === 'checklist' ? 'fixed_list' : table.replace(/^checklist_/, '')) : null;
    const remoteTable = isChecklist ? 'checklist_items' : table;
    if (!sb) {
      const rows = readOffline(table);
      return rows.find(r => r.id === id) || null;
    }
    let query = sb.from(remoteTable).select('*').eq('id', id);
    if (isChecklist) query = query.eq('doc_id', docId);
    const { data, error } = await query.maybeSingle?.() ?? query.single();
    if (error) throw error;
    return data || null;
  } catch (e) {
    supabaseDisabled = true;
    logEvent('sync', 'getById_offline_fallback', { table, reason: e?.message, id });
    const rows = readOffline(table);
    return rows.find(r => r.id === id) || null;
  }
}

export async function subscribe(table, callback) {
  try {
    const sb = await getSupabase();
    if (!sb) return () => {};
    const isChecklist = /^checklist(_.+)?$/.test(table);
    const docId = isChecklist ? (table === 'checklist' ? 'fixed_list' : table.replace(/^checklist_/, '')) : null;
    const remoteTable = isChecklist ? 'checklist_items' : table;
    const channelName = `table:${remoteTable}${docId ? ':' + docId : ''}`;
    const ch = sb.channel(channelName);
    const params = { event: '*', schema: 'public', table: remoteTable };
    if (isChecklist) params.filter = `doc_id=eq.${docId}`;
    ch.on('postgres_changes', params, payload => callback(payload));
    ch.subscribe();
    return () => sb.removeChannel(ch);
  } catch (e) {
    supabaseDisabled = true;
    logEvent('sync', 'subscribe_offline_fallback', { table, reason: e?.message });
    return () => {};
  }
}