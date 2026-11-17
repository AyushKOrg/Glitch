(function () {
  // Detect the current form factor for device-specific UI behavior.
  // Prefer the browser's mobile hint when available, with touch/viewport fallback.
  const mobileViewport = window.matchMedia('(max-width: 760px)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  function detectGlitchDevice() {
    const ua = navigator.userAgent || '';
    const uaMobile = /Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua);
    const uaTablet = /iPad|Tablet/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const phone = !uaTablet && (navigator.userAgentData?.mobile === true || uaMobile || (mobileViewport.matches && coarsePointer.matches));
    const device = phone ? 'phone' : uaTablet ? 'tablet' : 'pc';
    document.documentElement.dataset.device = device;
    document.body.dataset.device = device;
    document.documentElement.classList.toggle('is-phone', device === 'phone');
    document.documentElement.classList.toggle('is-pc', device === 'pc');
  }
  detectGlitchDevice();
  mobileViewport.addEventListener?.('change', detectGlitchDevice);
  coarsePointer.addEventListener?.('change', detectGlitchDevice);
  window.addEventListener('resize', detectGlitchDevice, { passive: true });
  window.addEventListener('orientationchange', detectGlitchDevice, { passive: true });
  window.GlitchDevice = { detect: detectGlitchDevice };
})();
