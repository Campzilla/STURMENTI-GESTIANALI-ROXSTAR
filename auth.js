// auth.js
/**
 * Gestione autenticazione e whitelist.
 * La whitelist non è in chiaro nel repo: verrà fornita via Secrets/Actions e caricata come config runtime.
 */
import { logEvent, logError } from './logger.js?v=rox18';
import { getConfig } from './sync.js?v=rox18';

const AUTH_KEY = 'roxstar_auth_user';
let cachedWhitelist = null;

export function isAuthenticated() {
  return !!(localStorage.getItem(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY));
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  logEvent('auth', 'logout');
}

async function loadWhitelistFromAssets() {
  if (cachedWhitelist) return cachedWhitelist;
  try {
    const res = await fetch('./Assets e risorse/TESTI_APP.txt');
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const wl = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.toLowerCase().startsWith('user:')) {
        const username = l.split(':')[1]?.trim();
        // cerca la riga pass successiva
        while (i + 1 < lines.length && lines[i + 1].trim() === '') i++;
        const pLine = lines[i + 1]?.trim() || '';
        if (pLine.toLowerCase().startsWith('pass:')) {
          const password = pLine.split(':')[1]?.trim();
          if (username && password) wl.push({ username, password });
        }
      }
    }
    cachedWhitelist = wl.length ? wl : null;
    return cachedWhitelist;
  } catch (e) {
    logError('whitelist_assets_load_failed', e);
    return null;
  }
}

async function validateCredentials(username, password) {
  try {
    const cfg = await getConfig();
    if (cfg.whitelist && Array.isArray(cfg.whitelist)) {
      return cfg.whitelist.some(pair => pair.username === username && pair.password === password);
    }
    const assetsWL = await loadWhitelistFromAssets();
    if (assetsWL) {
      return assetsWL.some(pair => pair.username === username && pair.password === password);
    }
    // Nessun fallback in produzione: accesso negato se non configurato
    return false;
  } catch (e) {
    logError('auth_validate_failed', e);
    return false;
  }
}

export function initAuthUI(container, onSuccess) {
  const form = document.createElement('form');
  form.innerHTML = `
    <h2>Login</h2>
    <label>Username</label>
    <input type="text" name="username" required autocomplete="username" />
    <label>Password</label>
    <input type="password" name="password" required autocomplete="current-password" />
    <label style="display:flex; align-items:center; gap:8px; margin-top:8px;">
      <input type="checkbox" name="stay" checked /> Resta connesso
    </label>
    <div style="margin-top:10px; display:flex; gap:8px;">
      <button class="button" type="submit">Login</button>
      <span id="login-msg" style="color:#f55;"></span>
    </div>
  `;
  function showGandalfModal() {
    const modal = document.createElement('div');
    modal.className = 'modal warning';
    modal.innerHTML = `
      <div class="modal-body">
        <img src="./Assets e risorse/gaandalfo.png" alt="Gandalf" class="modal-img" />
        <div class="modal-text">TUUUU NON PUOOI PASSAREEH!!!</div>
        <button class="button modal-close">Ok</button>
      </div>
    `;
    document.body.appendChild(modal);
    const close = modal.querySelector('.modal-close');
    close.addEventListener('click', () => modal.remove());
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value;
    const stay = !!form.stay?.checked;
    const ok = await validateCredentials(username, password);
    if (ok) {
      // salva su localStorage se “resta connesso”, altrimenti su sessionStorage
      const payload = JSON.stringify({ username });
      if (stay) localStorage.setItem(AUTH_KEY, payload);
      else sessionStorage.setItem(AUTH_KEY, payload);
      logEvent('auth', 'login', { username, stay });
      onSuccess && onSuccess();
    } else {
      const msg = document.getElementById('login-msg');
      if (msg) msg.textContent = '';
      showGandalfModal();
      logEvent('auth', 'login_denied', { username });
    }
  });
  container.appendChild(form);
}