// cntrl demo: draws a screen's HTML into an 800×480 PNG when the demo's service worker asks
// (it stands in for the headless Chrome the real server uses). One at a time.
(() => {
  if (!('serviceWorker' in navigator)) return;
  const W = 800, H = 480;
  let queue = Promise.resolve();

  // TRMNL's own fonts (its stylesheet's @font-face), fetched once and embedded: an SVG image can't load anything.
  const TRMNL_FONTS = {
    TRMNL12: [['normal', 'TRMNL12-Regular.woff2'], ['bold', 'TRMNL12-Bold.woff2']],
    TRMNL16: [['normal', 'TRMNL16-Regular.woff2'], ['bold', 'TRMNL16-Bold.woff2']],
    TRMNL21: [['normal', 'TRMNL21-Regular.woff2'], ['bold', 'TRMNL21-Bold.woff2']],
    NicoClean: [['normal', 'NicoClean-Regular.ttf']], NicoPups: [['normal', 'NicoPups-Regular.ttf']], BlockKie: [['normal', 'BlockKie.ttf']],
    'Inter Variable': [['100 900', 'Inter.ttf']],
  };
  const fontCache = new Map();
  const dataUrl = async (url) => {
    const b = await (await fetch(url)).blob();
    return new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  };
  const famOf = (block) => ((/font-family\s*:\s*["']?([^;"'}]+)/i.exec(block) || [])[1] || '').trim();
  async function embedUrls(block, base) {
    // Keep the first source in the best format and make it a data URL.
    const urls = [...block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)\s*(format\(["']?([a-z0-9-]+)["']?\))?/gi)].map((m) => ({ u: m[1], f: (m[3] || m[1].split('.').pop()).toLowerCase() }));
    if (!urls.length || urls.some((x) => x.u.startsWith('data:'))) return block;
    const rank = (f) => (/woff2/.test(f) ? 0 : /woff/.test(f) ? 1 : 2);
    const best = urls.sort((a, b) => rank(a.f) - rank(b.f))[0];
    const abs = new URL(best.u, base).href;
    if (!fontCache.has(abs)) fontCache.set(abs, dataUrl(abs).catch(() => null));
    const src = await fontCache.get(abs);
    if (!src) return '';
    return block.replace(/src\s*:[^;}]+;?/gi, '').replace(/\}\s*$/, `;src:url("${src}")}`);
  }
  const sheetCache = new Map();
  async function fontFaces(families, doc) {
    let css = '';
    for (const fam of families) {
      for (const [weight, file] of TRMNL_FONTS[fam] || []) {
        if (!fontCache.has(file)) fontCache.set(file, dataUrl(`https://trmnl.com/fonts/${file}`).catch(() => null));
        const src = await fontCache.get(file);
        if (src) css += `@font-face{font-family:"${fam}";font-weight:${weight};src:url("${src}")}`;
      }
    }
    // @font-face from the screen's own <style> tags and from stylesheets on hosts that allow it (cdnjs etc.).
    const sources = [...doc.querySelectorAll('style')].map((st) => [st.textContent, location.href]);
    for (const l of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
      if (/^https:\/\/trmnl\.com\//.test(l.href)) continue;
      if (!sheetCache.has(l.href)) sheetCache.set(l.href, fetch(l.href).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
      sources.push([await sheetCache.get(l.href), l.href]);
    }
    for (const [text, base] of sources) {
      for (const m of String(text).matchAll(/@font-face\s*\{[^}]*\}/gi)) {
        if (!families.has(famOf(m[0]))) continue;
        css += await embedUrls(m[0], base);
      }
    }
    return css;
  }

  // Default styles per tag, so only what a stylesheet changed gets written inline.
  const defaults = new Map();
  function defaultsFor(doc, tag) {
    if (defaults.has(tag)) return defaults.get(tag);
    const el = doc.createElement(tag);
    doc.body.appendChild(el);
    const cs = doc.defaultView.getComputedStyle(el);
    const d = {};
    for (const p of cs) if (!p.startsWith('--')) d[p] = cs.getPropertyValue(p);
    el.remove();
    defaults.set(tag, d);
    return d;
  }

  // Bake the page's computed styles into the elements (the stylesheets are on trmnl.com and an SVG image can't
  // use them), turn canvases into pictures and pictures into data URLs.
  async function inline(doc) {
    defaults.clear();
    const win = doc.defaultView;
    const families = new Set();
    const pseudo = [];
    let n = 0;
    const els = [doc.documentElement, ...doc.querySelectorAll('body, body *')];
    const styles = els.map((el) => {
      const cs = win.getComputedStyle(el);
      const d = defaultsFor(doc, el.tagName.toLowerCase());
      let text = '';
      for (const p of cs) { if (p.startsWith('--')) continue; const v = cs.getPropertyValue(p); if (v !== d[p] || p === 'display' || p.startsWith('font')) text += `${p}:${v};`; }
      String(cs.fontFamily).split(',').forEach((f) => families.add(f.trim().replace(/^["']|["']$/g, '')));
      for (const which of ['::before', '::after']) {
        const ps = win.getComputedStyle(el, which);
        const content = ps.getPropertyValue('content');
        if (!content || content === 'none' || content === 'normal') continue;
        let t = '';
        for (const p of ps) if (!p.startsWith('--')) t += `${p}:${ps.getPropertyValue(p)};`;
        String(ps.fontFamily).split(',').forEach((f) => families.add(f.trim().replace(/^["']|["']$/g, '')));
        pseudo.push([el, which, t]);
      }
      return text;
    });
    els.forEach((el, i) => el.setAttribute('style', styles[i]));
    let rules = '';
    for (const [el, which, t] of pseudo) { const id = `p${n++}`; el.setAttribute('data-px', id); rules += `[data-px="${id}"]${which}{${t}}`; }
    for (const img of doc.querySelectorAll('img[src]')) {
      if (img.src.startsWith('data:')) continue;
      try { img.setAttribute('src', await dataUrl(img.src)); } catch { img.removeAttribute('src'); }
    }
    for (const c of doc.querySelectorAll('canvas')) {
      const img = doc.createElement('img');
      try { img.src = c.toDataURL(); } catch {}
      img.setAttribute('style', c.getAttribute('style') || '');
      img.width = c.width; img.height = c.height;
      c.replaceWith(img);
    }
    const faces = await fontFaces(families, doc);
    doc.querySelectorAll('script, noscript, iframe, link, style').forEach((n) => n.remove());
    const st = doc.createElement('style');
    st.textContent = faces + rules;
    doc.head.appendChild(st);
  }

  async function draw(html) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = `position:fixed;left:-${W * 2}px;top:0;width:${W}px;height:${H}px;border:0;visibility:hidden;pointer-events:none`;
    const loaded = new Promise((r) => { frame.onload = r; });
    frame.srcdoc = html;
    document.body.appendChild(frame);
    try {
      await loaded;
      const doc = frame.contentDocument;
      try { await doc.fonts?.ready; } catch {}
      await new Promise((r) => setTimeout(r, 600)); // a recipe's own scripts (charts) finish drawing
      await inline(doc);
      doc.documentElement.style.width = `${W}px`;
      doc.documentElement.style.height = `${H}px`;
      const xml = new XMLSerializer().serializeToString(doc.documentElement);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${xml}</foreignObject></svg>`;
      const img = new Image();
      img.decoding = 'sync';
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => { window.cntrlLastSvg = svg; rej(new Error('SVG draw failed')); }; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`; });
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.drawImage(img, 0, 0, W, H);
      const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
      return await blob.arrayBuffer();
    } finally {
      frame.remove();
    }
  }

  window.cntrlDraw = draw; // for checking a drawing by hand
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'cntrl-render') return;
    const port = e.ports[0];
    queue = queue.then(() => draw(e.data.html))
      .then((png) => port.postMessage({ png }, [png]))
      .catch((err) => { console.warn('cntrl demo: drawing a screen failed:', err); port.postMessage({ error: String(err?.message || err) }); });
  });
})();
