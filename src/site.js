/* Progressive enhancement only: normal links and rendered pages work without JS. */
(() => {
  const menu = document.querySelector('.mobile-menu');
  if (menu) {
    document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
    menu.addEventListener('focusout', () => requestAnimationFrame(() => {
      if (!menu.contains(document.activeElement)) menu.open = false;
    }));
    window.matchMedia('(min-width: 701px)').addEventListener('change', event => { if (event.matches) menu.open = false; });
  }

  const hero = document.querySelector('[data-hero]');
  const heroData = hero?.querySelector('[data-hero-data]');
  if (hero && heroData) {
    try {
      const projects = JSON.parse(heroData.textContent);
      if (projects.length > 1) {
        let index = 0, request = 0;
        const picture = hero.querySelector('picture');
        const image = picture.querySelector('img');
        const srcset = p => (p.image.sources || []).map(s => `${s.src} ${s.width}w`).join(', ');
        // Decode the next still before swapping so the hero never flashes to black. A slow
        // or failed load falls back to swapping anyway after a short wait.
        const preload = p => {
          const probe = new Image();
          probe.sizes = image.sizes || '100vw'; probe.srcset = srcset(p); probe.src = p.image.src;
          return Promise.race([probe.decode().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1200))]);
        };
        const render = async step => {
          index = (index + step + projects.length) % projects.length;
          const current = ++request;
          const p = projects[index];
          hero.querySelector('[data-hero-count]').textContent = String(index + 1).padStart(2, '0');
          if (!p.mobile || !window.matchMedia('(max-width: 700px)').matches) await preload(p);
          if (current !== request) return; // A later click has already moved on.
          // Only the selected hero's assets are requested, never all galleries.
          picture.querySelector('source')?.remove();
          if (p.mobile) {
            const source = document.createElement('source');
            source.media = '(max-width: 700px)'; source.srcset = p.mobile.src;
            source.width = p.mobile.width; source.height = p.mobile.height;
            picture.prepend(source);
          }
          image.srcset = srcset(p);
          image.src = p.image.src; image.alt = p.alt;
          image.width = p.image.width; image.height = p.image.height;
          picture.style.setProperty('--focal-point', p.position);
          picture.style.setProperty('--mobile-focal-point', p.mobilePosition);
          hero.querySelector('[data-feature-title]').textContent = p.title;
          hero.querySelector('[data-feature-kind]').textContent = `Selected ${p.label}`;
          const link = hero.querySelector('[data-feature-link]');
          link.href = p.url; link.querySelector('span').textContent = `Explore ${p.label}`;
          hero.querySelector('[data-feature-note]').textContent = p.previewOnly ? 'Concept imagery · not production stills' : '';
        };
        hero.querySelector('[data-hero-prev]').addEventListener('click', () => render(-1));
        hero.querySelector('[data-hero-next]').addEventListener('click', () => render(1));
        // Recognize a deliberate one-finger swipe on the image, leaving vertical
        // scrolling, multi-touch gestures and panning a zoomed page to the browser.
        let swipe = null;
        const zoomed = () => (window.visualViewport?.scale || 1) > 1;
        picture.addEventListener('touchstart', event => {
          const touch = event.touches[0];
          swipe = event.touches.length === 1 && !zoomed()
            ? {id: touch.identifier, x: touch.clientX, y: touch.clientY, time: event.timeStamp, horizontal: false}
            : null;
        }, {passive: true});
        picture.addEventListener('touchmove', event => {
          if (!swipe) return;
          if (event.touches.length !== 1 || zoomed()) { swipe = null; return; }
          const touch = event.touches[0];
          const dx = Math.abs(touch.clientX - swipe.x), dy = Math.abs(touch.clientY - swipe.y);
          if (!swipe.horizontal) {
            if (dy > 12 && dy >= dx) { swipe = null; return; }
            swipe.horizontal = dx > 12 && dx > dy * 1.5;
          }
          if (swipe.horizontal && event.cancelable) event.preventDefault();
        }, {passive: false});
        picture.addEventListener('touchend', event => {
          const start = swipe;
          swipe = null;
          if (!start || event.touches.length || zoomed() || event.timeStamp - start.time > 1000) return;
          const touch = Array.from(event.changedTouches).find(t => t.identifier === start.id);
          if (!touch) return;
          const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
          if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) render(dx < 0 ? 1 : -1);
        }, {passive: true});
        picture.addEventListener('touchcancel', () => { swipe = null; }, {passive: true});
        hero.querySelector('[data-enhance]').hidden = false;
      }
    } catch (error) { console.error('Featured-work enhancement failed; the first project remains accessible.', error); }
  }

  const dialog = document.querySelector('[data-lightbox]');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const image = dialog.querySelector('[data-viewer-image]');
  const close = dialog.querySelector('[data-viewer-close]');
  const previous = dialog.querySelector('[data-viewer-prev]');
  const next = dialog.querySelector('[data-viewer-next]');
  const count = dialog.querySelector('[data-viewer-count]');
  const original = dialog.querySelector('[data-viewer-original]');
  const errorMessage = dialog.querySelector('[data-viewer-error]');
  let entries = [], index = 0, trigger = null, previousOverflow = '', scrollY = 0;
  const render = () => {
    const item = entries[index];
    errorMessage.hidden = true;
    image.alt = item.dataset.alt || item.querySelector('img')?.alt || '';
    image.src = item.href;
    original.href = item.href;
    count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(entries.length).padStart(2, '0')}`;
    previous.hidden = next.hidden = entries.length < 2;
  };
  image.addEventListener('error', () => { errorMessage.hidden = false; });
  image.addEventListener('load', () => { errorMessage.hidden = true; });
  const advance = direction => { index = (index + direction + entries.length) % entries.length; render(); };
  document.querySelectorAll('[data-gallery]').forEach(gallery => {
    gallery.addEventListener('click', event => {
      const link = event.target.closest('[data-gallery-item]');
      if (!link || !gallery.contains(link) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      entries = [...gallery.querySelectorAll('[data-gallery-item]')];
      index = entries.indexOf(link); trigger = link;
      previousOverflow = document.body.style.overflow;
      scrollY = window.scrollY;
      dialog.querySelector('[data-viewer-title]').textContent = `${gallery.dataset.galleryTitle} / Selected frames`;
      render(); dialog.showModal(); document.body.style.overflow = 'hidden'; close.focus();
    });
  });
  close.addEventListener('click', () => dialog.close());
  previous.addEventListener('click', () => advance(-1));
  next.addEventListener('click', () => advance(1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); }
    else if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button, a[href]')].filter(el => !el.hidden && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  // Escape is handled by the native dialog. Its close event restores the gallery exactly.
  dialog.addEventListener('close', () => {
    document.body.style.overflow = previousOverflow;
    window.scrollTo({top: scrollY, behavior:'instant'});
    if (trigger?.isConnected) trigger.focus({preventScroll:true});
  });
  // The gallery viewer leaves native scrolling and pinch zoom available.
})();
