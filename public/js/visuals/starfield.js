(function () {
  const $ = (id) => document.getElementById(id);
  // Reference-matched starfield: fine points and a few cross-shaped glints.
  function initGlitchStarfield() {
    const stage = document.querySelector('.stage');
    const canvas = $('vfxCanvas');
    if (!stage || !canvas) return;
    // A broad accent-tinted light field smoothly tracks the pointer across the workspace.
    let pointerFrame = 0, targetX = 52, targetY = 38, currentX = 52, currentY = 38;
    function movePointer(event) {
      const rect = stage.getBoundingClientRect();
      targetX = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
      targetY = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
      if (!pointerFrame) pointerFrame = requestAnimationFrame(updatePointerGlow);
    }
    function updatePointerGlow() {
      currentX += (targetX - currentX) * .19;
      currentY += (targetY - currentY) * .19;
      stage.style.setProperty('--pointer-x', currentX.toFixed(2) + '%');
      stage.style.setProperty('--pointer-y', currentY.toFixed(2) + '%');
      if (Math.abs(targetX-currentX) > .08 || Math.abs(targetY-currentY) > .08) {
        pointerFrame = requestAnimationFrame(updatePointerGlow);
      } else {
        currentX = targetX; currentY = targetY;
        stage.style.setProperty('--pointer-x', currentX.toFixed(2) + '%');
        stage.style.setProperty('--pointer-y', currentY.toFixed(2) + '%');
        pointerFrame = 0;
      }
    }
    stage.addEventListener('pointermove', movePointer, { passive:true });
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, dpr = 1, stars = [], raf = 0, lastFrame = 0;
    const random = (min, max) => min + Math.random() * (max - min);
    function toRgb(value, fallback) {
      const match = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
      if (!match) return fallback;
      const hex = match[1];
      return [parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16)].join(',');
    }
    function resize() {
      const rect = stage.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, 1.1);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(48, Math.min(120, Math.round(width * height / 14500)));
      stars = Array.from({ length: count }, (_, i) => ({
        x: random(0, width), y: random(0, height), r: random(.55, 1.3),
        phase: random(0, Math.PI * 2), speed: random(.22, .72),
        cyan: Math.random() < .32, flare: Math.random() < .06,
        flareLength: random(5.5, 9), drift: random(-.055, .055)
      }));
      draw(0, true);
    }
    function draw(time, staticFrame = false) {
      ctx.clearRect(0, 0, width, height);
      const dark = document.documentElement.dataset.scheme !== 'light';
      const rootStyle = getComputedStyle(document.documentElement);
      const accentRgb = toRgb(rootStyle.getPropertyValue('--accent').trim(), '124,58,237');
      const accent2Rgb = toRgb(rootStyle.getPropertyValue('--accent-2').trim(), accentRgb);
      for (const star of stars) {
        const pulse = staticFrame ? .88 : .62 + (Math.sin(time * .001 * star.speed + star.phase) + 1) * .18;
        const alpha = pulse * (dark ? 1 : .42);
        const tint = star.cyan ? accentRgb : accent2Rgb;
        ctx.fillStyle = 'rgba(' + tint + ',' + alpha + ')';
        ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2); ctx.fill();
        if (star.flare) {
          const glow = alpha * .92, length = star.flareLength;
          ctx.save(); ctx.globalAlpha = glow;
          ctx.shadowColor = star.cyan ? '#49eaff' : '#d7f5ff'; ctx.shadowBlur = 5;
          ctx.strokeStyle = star.cyan ? 'rgba(90,235,255,.85)' : 'rgba(220,245,255,.82)';
          ctx.lineWidth = .85; ctx.beginPath();
          ctx.moveTo(star.x - length, star.y); ctx.lineTo(star.x + length, star.y);
          ctx.moveTo(star.x, star.y - length); ctx.lineTo(star.x, star.y + length);
          ctx.stroke(); ctx.restore();
        }
        if (!staticFrame) { star.y += star.drift; if (star.y < -2) star.y = height + 2; if (star.y > height + 2) star.y = -2; }
      }
    }
    function frame(time) {
      if (time - lastFrame >= 33) { draw(time); lastFrame = time; }
      raf = requestAnimationFrame(frame);
    }
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(stage);
    window.addEventListener('resize', resize, { passive: true });
    resize();
    if (!reducedMotion.matches) raf = requestAnimationFrame(frame);
    reducedMotion.addEventListener?.('change', event => {
      if (event.matches) { cancelAnimationFrame(raf); draw(0, true); }
      else { lastFrame = 0; raf = requestAnimationFrame(frame); }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reducedMotion.matches) raf = requestAnimationFrame(frame);
    });
  }
  window.GlitchStarfield = { init: initGlitchStarfield };
})();
