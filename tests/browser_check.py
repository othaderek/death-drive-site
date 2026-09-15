"""Real-browser QA against a running local server (optional; not needed to build the site).

    npm run dev -- --port 4323                      # review build with draft projects
    python3 tests/browser_check.py --base http://127.0.0.1:4323
    python3 tests/browser_check.py --base http://127.0.0.1:4322 --public   # against `npm run preview -- --port 4322`

Requires the Python `playwright` package and a Chromium build (`playwright install chromium`), or set
CHROMIUM_PATH / WEBKIT_PATH to existing browser executables. Pages are loaded over real HTTP navigation,
so direct URLs, refresh and Back are exercised. Writes artifacts/browser-report.json and screenshots.
"""
from __future__ import annotations
import argparse, glob, json, os, re, sys, time, urllib.error, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, Error as PlaywrightError

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / 'artifacts'
SHOTS = ART / 'screenshots'
SIZES = [(320, 568), (390, 844), (768, 1024), (1024, 768), (1440, 900), (1920, 1080)]

parser = argparse.ArgumentParser()
parser.add_argument('--base', default=os.getenv('DDP_TEST_BASE_URL', 'http://127.0.0.1:4323'))
parser.add_argument('--public', action='store_true', help='Check a production-filtered server (no draft pages).')
parser.add_argument('--engines', default='chromium,webkit')
args = parser.parse_args()
BASE = args.base.rstrip('/')

site = json.loads((ROOT / 'content/site.json').read_text())
projects = json.loads((ROOT / 'content/projects.json').read_text())
media = json.loads((ROOT / 'content/media.json').read_text())
def route(p):
    if p['kind'] == 'music-video':
        artist = p.get('artistSlug', '')
        return f"/music-videos/{artist + '/' if artist else ''}{p['slug']}/"
    if p['kind'] == 'episode':
        return f"/series/{next(s['slug'] for s in projects if s['id'] == p['series'])}/{p['slug']}/"
    return f"/{'series' if p['kind'] == 'series' else 'films'}/{p['slug']}/"
project_routes = [route(p) for p in projects]
ROUTES = ['/', '/films/', '/series/', '/music-videos/', '/about/', '/contact/'] + ([] if args.public else project_routes)

report = {'base': BASE, 'mode': 'public' if args.public else 'review', 'engines': {}, 'http': [], 'failures': []}
def fail(message):
    report['failures'].append(message); print('FAIL', message)

# ---------------------------------------------------------------- HTTP / exposure
def status(path):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE + path, method='GET'), timeout=10) as r: return r.status, dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, dict(e.headers)
for path in ROUTES:
    code, headers = status(path); again, _ = status(path)
    report['http'].append({'path': path, 'status': code, 'repeat': again, 'csp': 'Content-Security-Policy' in headers})
    if code != 200 or again != 200: fail(f'HTTP {path} -> {code}/{again}')
private = ['/not-a-page/', '/content/projects.json', '/content/asset-sources.json', '/content/media.json', '/package.json',
           '/DDP-ASSETS/Domestic/', '/assets/web/', '/assets/intake/inventory.json', '/references/review-content.json',
           '/docs/ASSET-MAPPING.md', '/scripts/intake.py', '/%2e%2e/package.json', '/..%2fpackage.json', '/media/../package.json']
if args.public:
    private += project_routes
    # Draft stills must not be reachable in the public output.
    private += [m['src'] for mid, m in media.items() if not mid.startswith('brand-')][:6]
for path in private:
    code, _ = status(path)
    report['http'].append({'path': path, 'status': code, 'expected': 404})
    if code not in (400, 403, 404): fail(f'Private/missing path {path} returned {code}')

# ---------------------------------------------------------------- browser checks
LAYOUT_JS = r'''async () => {
  const w = innerWidth, d = document, issues = [];
  if (d.documentElement.scrollWidth > w + 1) issues.push('horizontal overflow ' + d.documentElement.scrollWidth);
  const wide = [...d.querySelectorAll('body *')].filter(el => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > w + 1 && !el.closest('dialog'); });
  if (wide.length) issues.push('element past right edge: ' + wide.slice(0, 3).map(e => e.tagName + '.' + e.className).join(' | '));
  if (d.querySelectorAll('main h1').length !== 1) issues.push('h1 count ' + d.querySelectorAll('main h1').length);
  const brand = d.querySelector('.brand')?.getBoundingClientRect();
  const nav = [...d.querySelectorAll('.primary-nav > a, .mobile-menu summary')].filter(a => a.getClientRects().length).map(a => a.getBoundingClientRect());
  if (brand && nav.length) { const left = Math.min(...nav.map(n => n.left)); if (left < brand.right + 8) issues.push('logo/nav gap ' + Math.round(left - brand.right)); }
  const logo = d.querySelector('.brand-image'); if (logo && logo.getBoundingClientRect().width < 144) issues.push('logo narrower than 144px');
  for (const t of d.querySelectorAll('h1, h2, h3')) if (t.scrollWidth > t.clientWidth + 2) issues.push('text overflow in ' + t.tagName + ': ' + t.textContent.slice(0, 30));
  // Load lazy images, then confirm every image decoded and kept its proportions where uncropped.
  for (let y = 0; y < d.body.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
  scrollTo(0, 0);
  const deadline = Date.now() + 8000;
  while ([...d.images].some(i => !i.closest('dialog') && !i.complete) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  for (const img of [...d.images].filter(i => !i.closest('dialog'))) {
    if (!img.getAttribute('width') || !img.getAttribute('height')) issues.push('image without dimensions ' + img.src);
    if (!img.complete || img.naturalWidth === 0) issues.push('image not loaded ' + img.currentSrc);
    const fit = getComputedStyle(img).objectFit, box = img.getBoundingClientRect();
    if (img.closest('.still') && box.width) {
      const ratio = box.width / box.height, natural = img.naturalWidth / img.naturalHeight;
      if (Math.abs(ratio - natural) / natural > 0.02 || fit === 'cover') issues.push('gallery image cropped ' + img.currentSrc);
    }
  }
  const hero = d.querySelector('.hero-image');
  let heroMode = null;
  if (hero) {
    const stacked = getComputedStyle(d.querySelector('.hero-picture')).position !== 'absolute';
    heroMode = stacked ? 'stacked' : 'full-bleed';
    if (stacked) {
      const img = hero.getBoundingClientRect(), title = d.querySelector('.hero h1').getBoundingClientRect();
      if (img.bottom > title.top + 1) issues.push('stacked hero overlaps title');
      const ratio = img.width / img.height, natural = hero.naturalWidth / hero.naturalHeight;
      if (Math.abs(ratio - natural) / natural > 0.02) issues.push('stacked hero cropped');
    }
  }
  return {issues, heroMode, logoWidth: logo ? Math.round(logo.getBoundingClientRect().width) : null};
}'''

def wait_js(page, expression, arg=None, timeout=10):
    """Poll with page.evaluate: the site's CSP (no unsafe-eval) correctly blocks wait_for_function."""
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate(expression, arg) if arg is not None else page.evaluate(expression): return
        page.wait_for_timeout(50)
    raise AssertionError(f'Timed out waiting for {expression}')

def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f'{name}.png'))
    return f'artifacts/screenshots/{name}.png'

def run_engine(pw, name):
    launcher = getattr(pw, name)
    options = {'headless': True}
    env_path = os.getenv(f'{name.upper()}_PATH')
    if env_path: options['executable_path'] = env_path
    elif name == 'chromium':
        found = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/chromium-*/chrome-mac*/*.app/Contents/MacOS/*')))
        if found: options['executable_path'] = found[-1]
    elif name == 'webkit':
        found = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/webkit-*/pw_run.sh')))
        if found: options['executable_path'] = found[-1]
    elif name == 'firefox':
        found = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/firefox-*/firefox/Nightly.app/Contents/MacOS/firefox')))
        if found: options['executable_path'] = found[-1]
    try:
        browser = launcher.launch(**options)
    except PlaywrightError as error:
        report['engines'][name] = {'launched': False, 'error': str(error).splitlines()[0][:300]}
        print(f'{name}: could not launch ({report["engines"][name]["error"]})'); return
    result = {'launched': True, 'version': browser.version, 'layout': [], 'interactions': [], 'consoleErrors': [], 'failedRequests': [], 'screenshots': []}
    report['engines'][name] = result
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()
    page.on('console', lambda m: m.type == 'error' and not ('404' in m.text and '/films/nope/' in page.url) and result['consoleErrors'].append(m.text[:300]))
    page.on('pageerror', lambda e: result['consoleErrors'].append(str(e)[:300]))
    # Requests aborted by the next navigation in a fast sweep are not failures.
    page.on('requestfailed', lambda r: 'ABORTED' not in (r.failure or '').upper() and 'cancel' not in (r.failure or '').lower() and result['failedRequests'].append(f'{r.failure} {r.url}'))
    page.on('response', lambda r: r.status >= 400 and '/films/nope/' not in r.url and result['failedRequests'].append(f'{r.status} {r.url}'))
    def check(label, fn):
        try:
            detail = fn(); result['interactions'].append({'check': label, 'passed': True, **({'detail': detail} if detail else {})})
        except Exception as error:
            result['interactions'].append({'check': label, 'passed': False, 'error': str(error)[:400]}); fail(f'{name}: {label}: {error}')
    def expect(condition, message):
        if not condition: raise AssertionError(message)

    # Layout sweep.
    for w, h in SIZES:
        page.set_viewport_size({'width': w, 'height': h})
        for path in ROUTES:
            page.goto(BASE + path, wait_until='load')
            measure = page.evaluate(LAYOUT_JS)
            result['layout'].append({'size': f'{w}x{h}', 'route': path, **measure})
            for issue in measure['issues']: fail(f'{name} {w}x{h} {path}: {issue}')

    if not args.public:
        # Homepage hero: manual only, no autoplay.
        page.set_viewport_size({'width': 1440, 'height': 900}); page.goto(BASE + '/', wait_until='load')
        featured = [p for pid in site['featured'] for p in projects if p['id'] == pid and p.get('hero')]
        def hero_manual():
            title = page.locator('[data-feature-title]')
            expect(title.inner_text() == featured[0]['title'], 'initial hero')
            page.wait_for_timeout(4000); expect(title.inner_text() == featured[0]['title'], 'hero changed without input')
            page.locator('[data-hero-next]').click(); wait_js(page, 't => document.querySelector(\"[data-feature-title]\").textContent === t', featured[1]['title'])
            expect(page.locator('[data-feature-link]').get_attribute('href') == route(featured[1]), 'hero link')
            expect(page.locator('[data-hero-count]').inner_text() == '02', 'hero count')
            page.locator('[data-hero-prev]').click(); wait_js(page, 't => document.querySelector(\"[data-feature-title]\").textContent === t', featured[0]['title'])
            return f'{len(featured)} featured, manual next/prev, no change after 4s idle'
        check('Homepage hero is manual (next/prev, no autoplay)', hero_manual)
        result['screenshots'].append(shot(page, f'{name}-home-1440'))
        if name == 'chromium':
            page.set_viewport_size({'width': 1920, 'height': 1080}); page.goto(BASE + '/', wait_until='load'); page.wait_for_timeout(300)
            result['screenshots'].append(shot(page, 'home-1920'))
            page.evaluate('window.scrollTo(0, innerHeight)'); page.wait_for_timeout(400)
            result['screenshots'].append(shot(page, 'home-selected-work-1920'))

        # Navigation, direct URL, Back and refresh.
        page.set_viewport_size({'width': 1440, 'height': 900})
        def navigation():
            page.goto(BASE + '/', wait_until='load')
            page.locator('.primary-nav > a', has_text='Films').click(); page.wait_for_url('**/films/')
            first = page.locator('.project-card a').first; href = first.get_attribute('href'); first.click(); page.wait_for_url('**' + href)
            expect(page.locator('main h1').inner_text() != 'Films', 'project page h1')
            page.go_back(); page.wait_for_url('**/films/')
            page.go_forward(); page.wait_for_url('**' + href)
            page.reload(wait_until='load'); expect(page.url.endswith(href), 'reload keeps URL')
            episode = next(r for r in project_routes if r.count('/') == 4)
            page.goto(BASE + episode, wait_until='load'); expect(page.locator('.breadcrumb a').first.get_attribute('href').startswith('/series/'), 'episode breadcrumb')
            page.goto(BASE + '/films/nope/', wait_until='load'); expect('Not here' in page.content(), '404 page')
            return f'nav -> {href}, Back, Forward, reload, direct episode URL, 404'
        check('Navigation, direct URLs, Back/Forward and refresh', navigation)

        # Gallery + full-screen viewer.
        film = max((p for p in projects if p['kind'] == 'film' and p.get('gallery')), key=lambda p: len(p['gallery']))
        def viewer():
            page.goto(BASE + route(film), wait_until='load')
            items = page.locator('[data-gallery-item]'); total = items.count()
            target = items.nth(2); target.scroll_into_view_if_needed(); page.wait_for_timeout(200)
            before = page.evaluate('scrollY')
            target.click(); dialog = page.locator('dialog[data-lightbox]')
            wait_js(page, 'document.querySelector("dialog[data-lightbox]").open')
            count = page.locator('[data-viewer-count]')
            expect(count.inner_text() == f'03 / {total:02d}', f'count {count.inner_text()}')
            wait_js(page, '(() => { const i = document.querySelector("[data-viewer-image]"); return i.complete && i.naturalWidth > 0; })()')
            fit = page.evaluate('''(() => { const i = document.querySelector("[data-viewer-image]"), s = document.querySelector(".viewer-stage").getBoundingClientRect(), b = i.getBoundingClientRect();
                const scale = Math.min(b.width / i.naturalWidth, b.height / i.naturalHeight); const dw = i.naturalWidth * scale, dh = i.naturalHeight * scale;
                return {fit: getComputedStyle(i).objectFit, inside: dw <= s.width + 1 && dh <= s.height + 1}; })()''')
            expect(fit['fit'] == 'contain' and fit['inside'], f'viewer crops image {fit}')
            expect(page.locator('[data-viewer-close]').is_visible(), 'visible close')
            expect(page.evaluate('document.activeElement.matches("[data-viewer-close]")'), 'focus moves to close')
            page.keyboard.press('ArrowRight'); expect(count.inner_text() == f'04 / {total:02d}', 'ArrowRight')
            page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowLeft'); expect(count.inner_text() == f'02 / {total:02d}', 'ArrowLeft')
            page.locator('[data-viewer-next]').click(); expect(count.inner_text() == f'03 / {total:02d}', 'next button')
            for _ in range(8):
                page.keyboard.press('Tab'); expect(page.evaluate('document.querySelector("dialog[data-lightbox]").contains(document.activeElement)'), 'focus escaped dialog')
            page.keyboard.press('Shift+Tab'); expect(page.evaluate('document.querySelector("dialog[data-lightbox]").contains(document.activeElement)'), 'focus escaped (shift)')
            page.keyboard.press('Escape'); wait_js(page, '!document.querySelector("dialog[data-lightbox]").open')
            expect(abs(page.evaluate('scrollY') - before) <= 2, f'scroll restored {before} -> {page.evaluate("scrollY")}')
            expect(page.evaluate('document.activeElement.matches("[data-gallery-item]")'), 'focus restored to gallery item')
            # Keyboard-only opening.
            page.keyboard.press('Enter'); wait_js(page, 'document.querySelector("dialog[data-lightbox]").open')
            page.locator('[data-viewer-close]').click(); wait_js(page, '!document.querySelector("dialog[data-lightbox]").open')
            return f'{film["title"]}: {total} images, count, arrows, buttons, Tab containment, Escape, scroll+focus restored, Enter opens'
        check('Gallery viewer: uncropped, keyboard, focus and scroll restoration', viewer)
        if name == 'chromium':
            page.goto(BASE + route(film), wait_until='load'); page.wait_for_timeout(500)
            result['screenshots'].append(shot(page, 'film-gallery-1440'))
            page.locator('[data-gallery-item]').first.click(); page.wait_for_timeout(700)
            result['screenshots'].append(shot(page, 'lightbox-1440'))
            page.keyboard.press('Escape')
            series = next(p for p in projects if p['kind'] == 'series')
            page.goto(BASE + route(series), wait_until='load'); result['screenshots'].append(shot(page, 'series-1440'))
            page.goto(BASE + '/films/', wait_until='load'); page.wait_for_timeout(400); result['screenshots'].append(shot(page, 'films-index-1440'))
            page.goto(BASE + '/contact/', wait_until='load'); result['screenshots'].append(shot(page, 'contact-1440'))
            page.goto(BASE + '/about/', wait_until='load'); result['screenshots'].append(shot(page, 'about-1440'))

        # Mobile: stacked hero, compact menu, touch-sized controls.
        mobile = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=name == 'chromium', device_scale_factor=2)
        m = mobile.new_page()
        m.on('pageerror', lambda e: result['consoleErrors'].append(str(e)[:300]))
        def mobile_checks():
            m.goto(BASE + '/', wait_until='load'); m.wait_for_timeout(400)
            expect(m.evaluate(LAYOUT_JS)['heroMode'] == 'stacked', 'mobile hero should be stacked')
            small = m.evaluate('''[...document.querySelectorAll('a, button, summary')].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
                .map(e => [e, e.getBoundingClientRect()]).filter(([e, b]) => (b.height < 44 && b.width < 44) && !e.closest('.skip-link')).map(([e]) => e.outerHTML.slice(0, 60))''')
            expect(not small, f'touch targets under 44px: {small[:3]}')
            m.locator('.mobile-menu summary').tap(); expect(m.locator('.mobile-menu nav').is_visible(), 'menu opens')
            m.keyboard.press('Escape'); expect(not m.locator('.mobile-menu nav').is_visible(), 'Escape closes menu')
            m.locator('.mobile-menu summary').tap(); m.locator('.mobile-menu nav a', has_text='Contact').tap(); m.wait_for_url('**/contact/')
            m.goto(BASE + route(film), wait_until='load'); m.locator('[data-gallery-item]').first.tap()
            wait_js(m, 'document.querySelector("dialog[data-lightbox]").open'); m.locator('[data-viewer-next]').tap()
            expect(m.locator('[data-viewer-count]').inner_text().startswith('02'), 'touch next')
            m.locator('[data-viewer-close]').tap(); wait_js(m, '!document.querySelector("dialog[data-lightbox]").open')
            return 'stacked hero, 44px targets, menu tap/Escape, touch viewer controls'
        check('Mobile 390px: stacked hero, menu, touch controls', mobile_checks)
        if name == 'chromium':
            m.goto(BASE + '/', wait_until='load'); m.wait_for_timeout(500); result['screenshots'].append(shot(m, 'home-390'))
            m.goto(BASE + route(film), wait_until='load'); m.wait_for_timeout(500); result['screenshots'].append(shot(m, 'film-gallery-390'))
            m.locator('[data-gallery-item]').first.tap(); m.wait_for_timeout(700); result['screenshots'].append(shot(m, 'lightbox-390'))
            series = next(p for p in projects if p['kind'] == 'series')
            m.goto(BASE + route(series), wait_until='load'); result['screenshots'].append(shot(m, 'series-390'))
            for (w, h) in [(320, 568), (768, 1024)]:
                t = browser.new_context(viewport={'width': w, 'height': h}).new_page(); t.goto(BASE + '/', wait_until='load'); t.wait_for_timeout(500)
                result['screenshots'].append(shot(t, f'home-{w}')); t.context.close()
        mobile.close()

        # Reduced motion and 200% zoom equivalent.
        rm = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce').new_page()
        def reduced():
            rm.goto(BASE + '/', wait_until='load')
            duration = rm.evaluate('getComputedStyle(document.querySelector(".primary-nav > a"), "::after").transitionDuration')
            expect(duration in ('0s', '0ms'), f'transition {duration}')
        check('prefers-reduced-motion removes transitions', reduced); rm.context.close()
        zoom = browser.new_context(viewport={'width': 720, 'height': 450}, device_scale_factor=2).new_page()
        def zoomed():
            zoom.goto(BASE + route(film), wait_until='load')
            issues = zoom.evaluate(LAYOUT_JS)['issues']; expect(not issues, issues)
            return '1440x900 window at 200% zoom = 720x450 CSS px'
        check('200% browser zoom layout', zoomed); zoom.context.close()
    context.close(); browser.close()
    result['consoleErrors'] = sorted(set(result['consoleErrors'])); result['failedRequests'] = sorted(set(result['failedRequests']))
    for e in result['consoleErrors']: fail(f'{name} console: {e}')
    for r in result['failedRequests']: fail(f'{name} request failed: {r}')
    print(f"{name} {result['version']}: {len(result['layout'])} layout checks, {sum(i['passed'] for i in result['interactions'])}/{len(result['interactions'])} interaction checks")

with sync_playwright() as pw:
    for engine in args.engines.split(','):
        run_engine(pw, engine.strip())

report['untested'] = ['Physical iOS/Android devices and native pinch gestures', 'Desktop Safari and Firefox proper (WebKit/Firefox engines only where launched)',
                      'Production network/CDN image performance and Lighthouse scores', 'Cloudflare hosting, redirects and headers in deployment', 'Full WCAG audit with assistive technology']
ART.mkdir(exist_ok=True)
(ART / f"browser-report{'-public' if args.public else ''}-{args.engines.replace(',', '-')}.json").write_text(json.dumps(report, indent=2) + '\n')
print(f"HTTP checks: {len(report['http'])}; failures: {len(report['failures'])}")
sys.exit(1 if report['failures'] else 0)
