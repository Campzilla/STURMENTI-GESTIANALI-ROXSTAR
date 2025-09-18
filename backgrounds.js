// backgrounds.js
/**
 * Caricamento snippet esterni dalla cartella ./backgrounds e attivazione/disattivazione.
 */
import { logEvent } from './logger.js?v=rox13';

let active = [];
let lastInitToken = 0; // evita race tra chiamate ravvicinate

export function initBackgrounds() {
  const token = ++lastInitToken;
  const desiredIsLogin = document.body.classList.contains('login-bg');
  fetch('./backgrounds/manifest.json')
    .then(r => r.json())
    .then(manifest => {
      if (token !== lastInitToken) return; // init obsoleto
      const names = Array.isArray(manifest?.snippets)
        ? manifest.snippets
        : ['vantaDiskLogin', 'vantaFogTools'];
      applyState(names, desiredIsLogin);
    })
    .catch(() => {
      if (token !== lastInitToken) return; // init obsoleto
      applyState(['vantaDiskLogin','vantaFogTools'], desiredIsLogin);
    });
}

function applyState(names, isLogin){
  // Disabilita tutto ciò che non serve prima
  ['vantaDiskLogin','vantaFogTools','lightRaysLogin'].forEach(sn => {
    const shouldEnable = (sn === 'vantaDiskLogin' || sn === 'lightRaysLogin') ? isLogin : !isLogin;
    if (!shouldEnable) toggleBackground(sn, false);
  });
  // Abilita solo ciò che serve
  if (names.includes('vantaDiskLogin')) toggleBackground('vantaDiskLogin', isLogin);
  if (names.includes('lightRaysLogin')) toggleBackground('lightRaysLogin', isLogin);
  if (names.includes('vantaFogTools')) toggleBackground('vantaFogTools', !isLogin);
  // Spegni eventuali attivi non previsti dal manifest
  active.slice().forEach(sn => {
    if (!names.includes(sn) && ['vantaDiskLogin','vantaFogTools','lightRaysLogin'].includes(sn)) toggleBackground(sn, false);
  });
}

export function toggleBackground(snippet, enable) {
  const id = `bg-${snippet}`;
  const exists = document.getElementById(id);
  if (enable && !exists) {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = `./backgrounds/${snippet}.js?v=rox8&cb=${Date.now()}`;
    s.id = id;
    document.body.appendChild(s);
    if (!active.includes(snippet)) active.push(snippet);
    logEvent('backgrounds', 'enable', { snippet });
  } else if (!enable && exists) {
    try {
      if (snippet === 'lightRaysLogin') {
        const canvas = document.getElementById('rb-light-rays-login');
        if (canvas && typeof canvas.__cleanup === 'function') canvas.__cleanup();
        else if (canvas) canvas.remove();
      }
      // cleanup generico opzionale esposto dagli snippet
      const fn = window[`__cleanup_${snippet}`];
      if (typeof fn === 'function') fn();
    } catch {}
    exists.remove();
    active = active.filter(x => x !== snippet);
    logEvent('backgrounds', 'disable', { snippet });
  }
}

export function loadBackground(snippet){
  try {
    const s = document.createElement('script');
    s.type = 'module';
    s.defer = true;
    s.src = `./backgrounds/${snippet}.js?v=rox13`;
    document.body.appendChild(s);
    logEvent('bg_load', 'append_script', { snippet });
  } catch (e) {
    console.error(e);
  }
}