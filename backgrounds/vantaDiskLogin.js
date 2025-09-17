// backgrounds/vantaDiskLogin.js
// Integra lo snippet "vanta disk.txt" (VANTA.TRUNK) nella pagina di login
// Carica p5 + vanta.trunk con fallback CDN -> locale e applica l'effetto su un container full-screen dietro l'interfaccia.

(function(){
  const CONTAINER_ID = 'vanta-login-bg';
  const SCRIPT_P5_ID = 'lib-p5js';
  const SCRIPT_TRUNK_ID = 'lib-vanta-trunk';

  if (document.getElementById(CONTAINER_ID)) return; // già montato

  // crea container dietro
  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  Object.assign(el.style, {
    position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none', background: 'transparent'
  });
  document.body.appendChild(el);

  function loadScriptOnce(id, src){
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing) {
        if (existing.dataset.loaded === '1') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed '+existing.src)));
        return;
      }
      const s = document.createElement('script');
      s.id = id;
      s.src = src;
      s.defer = true;
      s.onload = () => { s.dataset.loaded = '1'; resolve(); };
      s.onerror = () => reject(new Error('Failed '+src));
      document.head.appendChild(s);
    });
  }

  async function loadWithFallback(id, sources){
    let lastErr;
    for (const src of sources){
      try { await loadScriptOnce(id, src); return; } catch(e){ lastErr = e; }
    }
    throw lastErr || new Error('All sources failed for '+id);
  }

  async function boot(){
    try {
      // p5 (cdn -> locale), poi vanta.trunk (cdn -> locale)
      await loadWithFallback(SCRIPT_P5_ID, [
        'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.6.0/p5.min.js',
        '/Assets%20e%20risorse/p5.min.js?v=rox7'
      ]);
      await loadWithFallback(SCRIPT_TRUNK_ID, [
        'https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.trunk.min.js',
        'https://unpkg.com/vanta@0.5.24/dist/vanta.trunk.min.js',
        '/Assets%20e%20risorse/vanta.trunk.min.js?v=rox7'
      ]);

      if (!window.VANTA || !window.VANTA.TRUNK) throw new Error('VANTA.TRUNK non disponibile');

      // Parametri ripresi da vanta disk.txt ma senza fondo nero pieno
      const instance = window.VANTA.TRUNK({
        el,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        minHeight: 200.00,
        minWidth: 200.00,
        scale: 1.00,
        scaleMobile: 1.00,
        color: 0x009f17,
        backgroundColor: 0x101010, // leggermente scuro, non nero pieno
        spacing: 6.50,
        chaos: 7.50
      });

      // Riavvia automaticamente se si perde il contesto WebGL (schermata nera)
      let boundCanvas = null;
      const handleContextLost = (e) => {
        try { e.preventDefault(); } catch {}
        try { instance && instance.destroy && instance.destroy(); } catch {}
        setTimeout(() => { try { boot(); } catch {} }, 50);
      };
      const bindContextListener = () => {
        const c = el.querySelector('canvas');
        if (!c) { setTimeout(bindContextListener, 60); return; }
        boundCanvas = c;
        boundCanvas.addEventListener('webglcontextlost', handleContextLost, { once: true });
      };
      bindContextListener();

      // expose cleanup
      window.__cleanup_vantaDiskLogin = () => {
        try { instance && instance.destroy && instance.destroy(); } catch {}
        if (boundCanvas) {
          try { boundCanvas.removeEventListener('webglcontextlost', handleContextLost, { once: true }); } catch {}
          boundCanvas = null;
        }
        const c = document.getElementById(CONTAINER_ID);
        if (c) c.remove();
      };
    } catch (e) {
      console.error(e);
    }
  }

  boot();
})();