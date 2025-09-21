// backgrounds.js
/**
 * Caricamento snippet esterni dalla cartella ./backgrounds e attivazione/disattivazione.
 */
import { logEvent } from './logger.js?v=rox19';
// Bump manuale dei background snippet per evitare caching persistente
const loadSnippet = (snippet) => {
  const s = document.createElement('script');
  s.type = 'text/javascript';
  s.async = true;
  s.src = `./backgrounds/${snippet}.js?v=rox19&cb=${Date.now()}`;
  document.head.appendChild(s);
};

let active = [];
let lastInitToken = 0; // evita race tra chiamate ravvicinate

// Heuristics per capire se usare un background "leggero" in login
function shouldPreferLightLogin() {
  try {
    // Override manuale: localStorage rox_bg_login = 'light' | 'heavy' | 'auto'
    const pref = (localStorage.getItem('rox_bg_login') || 'auto').toLowerCase();
    if (pref === 'light') return true;
    if (pref === 'heavy') return false;

    const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return true;

    const saveData = navigator.connection && navigator.connection.saveData;
    if (saveData) return true;

    // WebGL disponibile? Se no, usa light
    const glSupported = (() => {
      try {
        const c = document.createElement('canvas');
        return !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch { return false; }
    })();
    if (!glSupported) return true;

    // Heuristic: desktop/laptop con poche risorse o DPI alto su risoluzione ampia
    const ua = navigator.userAgent || '';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    const mem = Number(navigator.deviceMemory || 8);
    const cores = Number(navigator.hardwareConcurrency || 4);
    const dpr = window.devicePixelRatio || 1;
    const wide = window.innerWidth || screen.width || 0;

    // Preferisci light se: non mobile e (pochi core/mem oppure combinazione dpr alto + schermo ampio)
    if (!isMobile && (mem <= 4 || cores <= 4 || (dpr >= 2 && wide >= 1400))) return true;
  } catch {}
  return false;
}

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
  if (isLogin) {
    // Selezione adattiva: usa una variante leggera quando opportuno, anche se il manifest non la elenca
    const useLight = shouldPreferLightLogin();
    // Spegni entrambe per sicurezza prima di accendere quella scelta
    toggleBackground('vantaDiskLogin', false);
    toggleBackground('lightRaysLogin', false);
    if (useLight) {
      toggleBackground('lightRaysLogin', true);
      try { logEvent('backgrounds', 'login_bg_selected', { mode: 'light' }); } catch {}
    } else {
      // Abilita vanta solo se presente nel manifest oppure in fallback
      if (names.includes('vantaDiskLogin') || true) {
        toggleBackground('vantaDiskLogin', true);
        try { logEvent('backgrounds', 'login_bg_selected', { mode: 'vanta' }); } catch {}
      }
    }
  } else {
    // Tools: rispetta il manifest, di default usa vantaFogTools
    if (names.includes('vantaFogTools')) toggleBackground('vantaFogTools', true);
    // Spegni eventuali attivi non previsti
    ['vantaDiskLogin','lightRaysLogin'].forEach(sn => toggleBackground(sn, false));
  }

  // Spegni eventuali attivi non previsti dal manifest (tollerando l'aggiunta di lightRaysLogin per il login)
  active.slice().forEach(sn => {
    const isKnown = ['vantaDiskLogin','vantaFogTools','lightRaysLogin'].includes(sn);
    if (!isKnown) toggleBackground(sn, false);
  });
}

export function toggleBackground(snippet, enable) {
  const id = `bg-${snippet}`;
  const exists = document.getElementById(id);
  if (enable && !exists) {
    const s = document.createElement('script');
    s.type = 'module';
    s.src = `./backgrounds/${snippet}.js?v=rox19&cb=${Date.now()}`;
    s.id = id;
    document.body.appendChild(s);
    if (!active.includes(snippet)) active.push(snippet);
    logEvent('backgrounds', 'enable', { snippet });
  } else if (!enable && exists) {
    try {
      if (snippet === 'lightRaysLogin') {
        const canvas = document.getElementById('rays-login-bg');
        if (canvas && typeof canvas.__cleanup === 'function') canvas.__cleanup();
        else if (canvas) canvas.remove();
      }
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
    s.src = `./backgrounds/${snippet}.js?v=rox19&cb=${Date.now()}`;
    document.body.appendChild(s);
    logEvent('bg_load', 'append_script', { snippet });
  } catch (e) {
    console.error(e);
  }
}