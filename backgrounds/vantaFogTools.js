// backgrounds/vantaFogTools.js
// Integra VANTA.FOG per la pagina strumenti, alleggerendo il fondo.

(function(){
  const CONTAINER_ID = 'vanta-tools-bg';
  const SCRIPT_THREE_ID = 'lib-threejs';
  const SCRIPT_FOG_ID = 'lib-vanta-fog';

  if (document.getElementById(CONTAINER_ID)) return;

  const el = document.createElement('div');
  el.id = CONTAINER_ID;
  Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none', background: 'transparent' });
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
      s.id = id; s.src = src; s.defer = true;
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
      await loadWithFallback(SCRIPT_THREE_ID, [
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js',
        '/Assets%20e%20risorse/three.min.js?v=rox7'
      ]);
      await loadWithFallback(SCRIPT_FOG_ID, [
        'https://cdn.jsdelivr.net/npm/vanta@0.5.24/dist/vanta.fog.min.js',
        'https://unpkg.com/vanta@0.5.24/dist/vanta.fog.min.js',
        '/Assets%20e%20risorse/vanta.fog.min.js?v=rox7'
      ]);

      if (!window.VANTA || !window.VANTA.FOG) throw new Error('VANTA.FOG non disponibile');

      const instance = window.VANTA.FOG({
        el,
        mouseControls: true,
        touchControls: true,
        gyroControls: false,
        highlightColor: 0x00d63a,
        midtoneColor: 0x0f8a20,
        lowlightColor: 0x0b5d16,
        baseColor: 0x101010, // non nero pieno
        blurFactor: 0.55,
        speed: 0.9,
        zoom: 0.8
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

      window.__cleanup_vantaFogTools = () => {
        try { instance && instance.destroy && instance.destroy(); } catch {}
        if (boundCanvas) {
          try { boundCanvas.removeEventListener('webglcontextlost', handleContextLost, { once: true }); } catch {}
          boundCanvas = null;
        }
        const c = document.getElementById(CONTAINER_ID);
        if (c) c.remove();
      };
    } catch(e) {
      console.error(e);
    }
  }

  boot();
})();