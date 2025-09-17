// backgrounds/lightRaysLogin.js
// Effetto raggi luminosi verdi per la pagina login, su canvas fisso dietro alla UI.
(function(){
  const CANVAS_ID = 'rays-login-bg';
  if (document.getElementById(CANVAS_ID)) return;

  const canvas = document.createElement('canvas');
  canvas.id = CANVAS_ID;
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', zIndex: '0', pointerEvents: 'none', background: 'transparent'
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let w=0,h=0,raf;

  function resize(){
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function rnd(a,b){ return Math.random()*(b-a)+a; }

  function frame(){
    ctx.clearRect(0,0,w,h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i=0;i<16;i++){
      const x = rnd(0,w), y = rnd(0,h*0.4);
      const len = rnd(h*0.2, h*0.8);
      const angle = rnd(-0.2, 0.2);
      const width = rnd(2, 6);
      const grad = ctx.createLinearGradient(x,y, x+Math.cos(angle)*len, y+Math.sin(angle)*len);
      grad.addColorStop(0, 'rgba(0,255,100,0.18)');
      grad.addColorStop(1, 'rgba(0,255,100,0.00)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+Math.cos(angle)*len, y+Math.sin(angle)*len);
      ctx.stroke();
    }
    raf = requestAnimationFrame(frame);
  }
  frame();

  window.__cleanup_lightRaysLogin = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
})();