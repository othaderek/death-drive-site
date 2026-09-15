import {routeFor} from './content.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const number = value => String(value).padStart(2, '0');
// Draw arrows directly so mobile font fallback cannot turn them into emoji.
const arrowIcon = (direction = 'up-right') => {
  const paths = {'up-right':'M7 17 17 7M7 7h10v10',left:'M19 12H5m6-6-6 6 6 6',right:'M5 12h14m-6-6 6 6-6 6'};
  return `<svg class="arrow" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[direction]}"></path></svg>`;
};
const arrow = arrowIcon();
const kicker = value => `<p class="eyebrow">${esc(value)}</p>`;
const textLink = (href, text) => `<a class="text-link" href="${esc(href)}"><span>${esc(text)}</span>${arrow}</a>`;
const externalLinks = links => (links || []).map(l => textLink(l.url, l.label)).join('');
const watchLabel = p => p.kind === 'music-video' ? 'Watch music video' : 'Watch film';
const playIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"></path></svg>';
/** Accurate noun for a project: a music video is not called a film, and a series is never "television". */
export const kindLabel = p => p.kind === 'series' ? 'series' : p.kind === 'episode' ? 'episode' : p.kind === 'music-video' || /music video/i.test(p.format || '') ? 'music video' : 'film';

export function createRenderer({site, projects, media, review}) {
  const byID = id => projects.find(p => p.id === id);
  const url = p => routeFor(p, projects);
  const image = (id, alt, {className = '', eager = false, sizes = '100vw', attrs = ''} = {}) => {
    const m = media[id];
    if (!m) return '';
    const srcset = (m.sources || []).map(s => `${s.src} ${s.width}w`).join(', ');
    return `<img class="${esc(className)}" src="${esc(m.src)}" ${srcset ? `srcset="${esc(srcset)}" sizes="${esc(sizes)}"` : ''} width="${m.width}" height="${m.height}" alt="${esc(alt)}" loading="${eager ? 'eager' : 'lazy'}" ${eager ? 'fetchpriority="high"' : ''} decoding="async" ${attrs}>`;
  };
  const heroPicture = p => {
    if (!p?.hero) return '';
    const mobile = media[p.hero.mobileImage];
    return `<picture class="hero-picture" style="--focal-point:${esc(p.hero.desktopPosition || '50% 50%')};--mobile-focal-point:${esc(p.hero.mobilePosition || '50% 50%')}">
      ${mobile ? `<source media="(max-width: 700px)" srcset="${esc(mobile.src)}" width="${mobile.width}" height="${mobile.height}">` : ''}
      ${image(p.hero.image, p.hero.alt, {eager: true, className: 'hero-image'})}
    </picture>`;
  };
  const reviewLabel = p => review && p.previewOnly ? '<p class="asset-note">Concept imagery · not production stills</p>' : '';
  const metadata = p => `<div class="project-meta">${[p.format,p.year,p.runtime,p.productionStatus].filter(Boolean).map(v=>`<span>${esc(v)}</span>`).join('')}</div>`;
  const navigation = [['Films','/films/'],['Series','/series/'],['Music Videos','/music-videos/'],['About','/about/'],['Contact','/contact/']];
  const navLinks = route => navigation.map(([label,href])=>`<a href="${href}" ${route.startsWith(href)?`aria-current="${route===href?'page':'true'}"`:''}>${label}</a>`).join('');
  // The link carries the accessible name, so the logo image itself is decorative here.
  const brand = () => site.logo ? image(site.logo, '', {eager: true, className: 'brand-image', sizes:'(max-width: 700px) 144px, 160px'}) : '<span class="brand-text">Death<br>Drive<br>Pictures</span>';
  const previewShown = projects.some(p => p.previewOnly);
  const draftsShown = projects.some(p => p.status !== 'published');
  const header = (route, home) => `<a class="skip-link" href="#main">Skip to content</a>
    ${review ? `<aside class="review-notice" aria-label="Review status"><span>Local review only · not deployed</span><span>${previewShown ? 'Concept images & draft copy · not for publication' : draftsShown ? 'Draft projects shown · excluded from the public build' : 'Review build'}</span></aside>` : ''}
    <header class="site-header ${home ? 'over-hero' : ''}">
      <a class="brand" href="/" aria-label="Death Drive Pictures — home">${brand()}</a>
      <nav class="primary-nav" aria-label="Primary navigation">
        ${navLinks(route)}
        <details class="mobile-menu"><summary aria-label="Navigation menu"><span aria-hidden="true">☰</span></summary><nav aria-label="Site pages">${navLinks(route)}</nav></details>
      </nav>
    </header>`;
  const footer = () => `<footer class="site-footer"><a href="/" class="footer-name">Death Drive Pictures</a><p>${esc(site.tagline)}</p><a class="footer-contact" href="/contact/">Contact ${arrow}</a>${review?`<p class="footer-review">Review build.${draftsShown?' Projects marked draft appear only here, never in the public build.':''}${site.logo?'':' Temporary system typography; branding awaits approval.'}</p>`:''}</footer>`;
  function layout({title, description = site.description, route = '/', content, home = false, shareImage = null, noindex = false, lightbox = false}) {
    const indexable = site.launchApproved && !review && !noindex;
    const canonical = `${site.domain.replace(/\/$/, '')}${route}`;
    const share = media[shareImage] || media[site.shareImage] || null;
    const icon = media[site.favicon];
    const iconSize = size => icon?.sources?.find(s => s.width === size)?.src;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="theme-color" content="#0b0c0b">
<title>${esc(title === site.name ? title : title+' — '+site.name)}${review?' · Review':''}</title>
<meta name="description" content="${esc(description)}"><meta name="robots" content="${indexable?'index, follow':'noindex, nofollow'}">
${indexable?`<link rel="canonical" href="${esc(canonical)}">`:''}
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(site.name)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
${indexable?`<meta property="og:url" content="${esc(canonical)}">`:''}
${share && !share.previewOnly ? `<meta property="og:image" content="${esc(site.domain+share.src)}"><meta property="og:image:width" content="${share.width}"><meta property="og:image:height" content="${share.height}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
${icon?`<link rel="icon" type="image/png" sizes="32x32" href="${esc(iconSize(32) || icon.src)}"><link rel="icon" type="image/png" sizes="512x512" href="${esc(icon.src)}"><link rel="apple-touch-icon" href="${esc(iconSize(180) || icon.src)}">`:''}
<link rel="stylesheet" href="/styles.css"><script src="/site.js" defer></script></head>
<body class="${review?'is-review ':''}${home?'is-home':''}">${header(route,home)}<main id="main" tabindex="-1">${content}</main>${footer()}${lightbox?viewer():''}</body></html>`;
  }
  const card = (p, {heading='h3'} = {}) => `<article class="project-card${p.kind==='series'?' series-card':''}"><a href="${url(p)}" aria-label="Explore ${esc(p.artist ? p.artist+' — '+p.title : p.title)}">
    ${p.hero?`<div class="card-image" style="--card-focal:${esc(p.hero.cardPosition || p.hero.desktopPosition || '50% 50%')}">${image(p.hero.image,p.hero.alt,{sizes:'(max-width: 700px) 92vw, 46vw'})}</div>`:'<div class="no-artwork"><span>Images to follow</span></div>'}
    <div class="card-caption"><${heading}>${esc(p.title)}</${heading}><span class="card-format">${esc(p.artist || p.format || (p.kind==='series'?'Series':p.kind==='music-video'?'Music video':'Film'))}</span>${arrow}</div>
    </a>${reviewLabel(p)}</article>`;
  const empty = text => `<div class="empty-state"><p>${esc(text)}</p></div>`;
  const selectedProjects = () => (site.selected.length ? site.selected.map(byID).filter(Boolean) : projects.filter(p=>p.kind!=='episode').slice(0,4));
  function home() {
    const featured = site.featured.map(byID).filter(p=>p?.hero && p.kind!=='episode');
    const first = featured[0];
    const selected = selectedProjects();
    const heroData = featured.map(p=>({title:p.title,kind:p.kind,label:kindLabel(p),url:url(p),format:p.format,alt:p.hero.alt,position:p.hero.desktopPosition||'50% 50%',mobilePosition:p.hero.mobilePosition||'50% 50%',previewOnly:!!p.previewOnly,image:media[p.hero.image],mobile:p.hero.mobileImage?media[p.hero.mobileImage]:null}));
    const content = first ? `<section class="hero" aria-label="Featured work" data-hero>
      ${heroPicture(first)}
      <div class="hero-body"><p class="eyebrow hero-kind"><span class="status-dot" aria-hidden="true"></span><span data-feature-kind>Selected ${kindLabel(first)}</span></p><h1 data-feature-title>${esc(first.title)}</h1><a class="text-link" data-feature-link href="${url(first)}"><span>Explore ${kindLabel(first)}</span>${arrow}</a></div>
      ${featured.length>1?`<div class="hero-controls" hidden data-enhance><span class="hero-counter" aria-live="polite" aria-atomic="true"><span data-hero-count>01</span> / ${number(featured.length)}<span class="sr-only"> featured projects</span></span><button class="round-button" data-hero-prev aria-label="Previous featured project">${arrowIcon('left')}</button><button class="round-button" data-hero-next aria-label="Next featured project">${arrowIcon('right')}</button></div>`:''}
      <div class="hero-note"><p>${esc(site.tagline)}</p><p data-feature-note>${review && first.previewOnly?'Concept imagery · not production stills':''}</p></div>
      ${featured.length>1?`<script type="application/json" data-hero-data>${json(heroData)}</script>`:''}
    </section>` : `<section class="holding-home page-shell"><p class="eyebrow">${esc(site.tagline)}</p><h1>Death Drive<br>Pictures</h1><p class="holding-description">${esc(site.description)}</p>${textLink('/films/','Explore the work')}</section>`;
    return layout({title:site.name,home:!!first,shareImage:first?.hero.image,content:content+`
      ${selected.length?`<section class="section page-shell"><div class="section-heading">${kicker('Selected work')}<span class="eyebrow muted">01 — ${number(selected.length)}</span></div><div class="work-grid">${selected.map(p=>card(p)).join('')}</div></section>`:''}
      <section class="quiet-about page-shell"><h2>Films, series<br>& music videos.</h2><div><p>${esc(site.description)}</p>${textLink('/about/','About the company')}</div></section>`});
  }
  function index(kind) {
    if (kind === 'music-video') {
      const list=projects.filter(p=>p.kind===kind).sort((a,b)=>Number(!a.artist)-Number(!b.artist) || (a.artist||'').localeCompare(b.artist||'') || a.title.localeCompare(b.title));
      const artists=[...new Set(list.map(p=>p.artist||''))];
      const groups=artists.map(artist=>{
        const videos=list.filter(p=>(p.artist||'')===artist);
        return `<section class="music-group" aria-label="${esc(artist||'More music videos')}">${artist?`<h2 class="artist-heading">${esc(artist)}</h2>`:''}<div class="work-grid ${videos.length===1?'single-project':''}">${videos.map(p=>card(p,{heading:artist?'h3':'h2'})).join('')}</div></section>`;
      }).join('');
      return layout({title:'Music Videos',route:'/music-videos/',description:`Music videos from ${site.name}.`,content:`<section class="page page-shell music-index"><header class="page-intro"><div class="index-title"><h1>Music Videos</h1><span class="eyebrow muted">${number(list.length)} ${list.length===1?'video':'videos'}</span></div></header>${list.length?groups:empty('No music videos listed.')}</section>`});
    }
    const list=projects.filter(p=>p.kind===kind), title=kind==='series'?'Series':'Films';
    return layout({title,route:`/${title.toLowerCase()}/`,description:`${title} from ${site.name}.`,content:`<section class="page page-shell"><header class="page-intro"><p class="eyebrow">Death Drive Pictures / ${title}</p><div class="index-title"><h1>${title}</h1><span class="eyebrow muted">${number(list.length)} ${list.length===1?'project':'projects'}</span></div></header>${list.length?`<div class="work-grid ${list.length===1?'single-project':''}">${list.map(p=>card(p,{heading:'h2'})).join('')}</div>`:empty(`No ${title.toLowerCase()} listed.`)}</section>`});
  }
  function gallery(p) {
    const items=p.gallery||[];
    return items.length?`<section class="project-gallery" aria-label="${esc(p.title)} image gallery"><div class="gallery-heading"><h2 class="eyebrow">Selected frames / ${number(items.length)}</h2><span class="eyebrow muted">${review&&p.previewOnly?'Concept references · not production stills':p.watchUrl?'Play video or view stills full screen':'Select an image to view full screen'}</span></div><div class="gallery-grid" data-gallery data-gallery-title="${esc(p.title)}">${items.map((g,i)=>{
      const m=media[g.image];
      const stillAttrs=`href="${esc(m.full||m.src)}" data-gallery-item data-alt="${esc(g.alt)}" aria-label="Open image ${i+1} of ${items.length}: ${esc(g.alt)}"`;
      const stillImage=image(g.image,g.alt,{eager:i===0,sizes:i===0?'92vw':'(max-width: 700px) 92vw, 46vw'});
      if (i===0 && p.watchUrl) return `<div class="watch-frame"><a class="watch-preview" href="${esc(p.watchUrl)}" aria-label="${watchLabel(p)}: ${esc(p.artist?p.artist+' — '+p.title:p.title)}">${stillImage}<span class="watch-badge">${playIcon}<span>${watchLabel(p)}</span></span></a><span class="image-number" aria-hidden="true">${number(i+1)}</span><a class="still-expand" ${stillAttrs} title="View still full screen">${arrow}</a></div>`;
      return `<a class="still" ${stillAttrs}>
        ${stillImage}<span class="image-number" aria-hidden="true">${number(i+1)}</span><span class="still-expand" aria-hidden="true">${arrow}</span></a>`;
    }).join('')}</div></section>`:'';
  }
  function credits(p) {
    return p.credits?.length?`<dl class="project-credits" aria-label="Project credits">${p.credits.map(c=>`<div><dt>${esc(c.role)}</dt><dd>${esc(c.name)}</dd></div>`).join('')}</dl>`:'';
  }
  function project(p) {
    const parent=p.kind==='episode'?byID(p.series):null;
    const music=p.kind==='music-video';
    const back=parent?url(parent):music?'/music-videos/':'/films/';
    const crumb=parent?parent.title:music?'Music Videos':'Films';
    const title=p.artist?`${p.title} — ${p.artist}`:p.title;
    const projectLinks=(p.watchUrl?textLink(p.watchUrl,watchLabel(p)):'')+externalLinks(p.links);
    const links=projectLinks?`<div class="project-links">${projectLinks}</div>`:'';
    return layout({title,description:p.logline||`${title} — ${music?'Music video from ':''}${site.name}.`,route:url(p),shareImage:p.hero?.image,lightbox:!!p.gallery?.length,content:`<article class="page page-shell${music?' music-project':''}">
      <header class="page-intro"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="${back}">${esc(crumb)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.title)}</span></nav>
      <div class="intro-grid"><div>${p.artist?`<p class="project-artist">${esc(p.artist)}</p>`:''}<h1>${esc(p.title)}</h1>${metadata(p)}</div>${p.logline?`<div class="intro-copy">${review&&p.copyApproved!==true?kicker('Draft logline'):''}<p>${esc(p.logline)}</p>${links}</div>`:links}</div>${credits(p)}</header>
      ${gallery(p)}${!p.gallery?.length && p.hero?`<figure class="lead-artwork">${image(p.hero.image,p.hero.alt,{eager:true})}${reviewLabel(p)}</figure>`:''}
      <div class="project-bottom">${textLink(back,parent?'Back to '+parent.title:music?'All music videos':'All films')}${reviewLabel(p)}</div></article>`});
  }
  function series(p) {
    const episodes=projects.filter(e=>e.kind==='episode'&&e.series===p.id);
    return layout({title:p.title,description:p.logline||`${p.title} — ${site.name}.`,route:url(p),shareImage:p.hero?.image,content:`<article class="page page-shell series-page"><header class="page-intro"><nav class="breadcrumb" aria-label="Breadcrumb"><a href="/series/">Series</a><span aria-hidden="true">/</span><span aria-current="page">${esc(p.title)}</span></nav><div class="intro-grid"><div><h1>${esc(p.title)}</h1>${metadata(p)}</div><div class="intro-copy">${review&&p.copyApproved!==true?kicker('Draft description'):''}${p.logline?`<p>${esc(p.logline)}</p>`:''}${p.links?.length?`<div class="project-links">${externalLinks(p.links)}</div>`:''}</div></div>${credits(p)}</header>
      ${p.hero?`<figure class="series-artwork">${image(p.hero.image,p.hero.alt,{eager:true,sizes:'92vw'})}${reviewLabel(p)}</figure>`:''}
      <section class="episodes"><div class="section-heading"><h2 class="eyebrow">${review&&p.previewOnly?'Episode layout preview':'Episodes'}</h2><span class="eyebrow muted">${number(episodes.length)}</span></div>${episodes.length?episodes.map(e=>`<article class="episode-card${e.hero?'':' no-episode-artwork'}">${e.hero?`<a class="episode-artwork" href="${url(e)}" aria-label="Explore ${esc(e.title)}">${image(e.hero.image,e.hero.alt,{sizes:'(max-width: 700px) 92vw, 30vw'})}</a>`:''}<div>${kicker(e.format||'Episode')}<h3><a href="${url(e)}">${esc(e.title)}</a></h3>${e.logline?`${review&&e.copyApproved!==true?'<p class="eyebrow muted draft-label">Draft logline</p>':''}<p>${esc(e.logline)}</p>`:''}${textLink(url(e),'Explore episode')}${reviewLabel(e)}</div></article>`).join(''):empty('Episode information will be added here.')}</section></article>`});
  }
  function about() {
    return layout({title:'About',route:'/about/',content:`<section class="page page-shell simple-page"><p class="eyebrow">The company</p><h1>About.</h1><div class="about-grid"><h2>Death Drive<br>Pictures</h2><div class="simple-copy">${site.about.map(p=>`<p>${esc(p)}</p>`).join('')}${textLink('/contact/','Contact')}</div></div></section>`});
  }
  function contact() {
    return layout({title:'Contact',route:'/contact/',content:`<section class="page page-shell simple-page contact-page"><p class="eyebrow">Death Drive Pictures</p><h1>Contact.</h1>${site.emails.length?`<div class="contact-emails">${site.emails.map(email=>`<a class="contact-email" href="mailto:${esc(email)}"><span>${esc(email)}</span>${arrow}</a>`).join('')}</div>`:''}${site.links.length?`<nav class="contact-links" aria-label="Death Drive Pictures elsewhere">${externalLinks(site.links)}</nav>`:''}</section>`});
  }
  function notFound() {return layout({title:'Page not found',route:'/404.html',noindex:true,content:`<section class="page page-shell simple-page"><p class="eyebrow">404 / Page not found</p><h1>Not here.</h1><p class="content-note">The page may have moved, or the address may be incomplete.</p>${textLink('/','Back to the work')}</section>`});}
  return {home,index,project,series,about,contact,notFound};
}
function viewer() {
  return `<dialog class="lightbox" aria-labelledby="viewer-title" data-lightbox><div class="viewer-layout">
    <header class="viewer-top"><h2 id="viewer-title" class="eyebrow" data-viewer-title>Selected frames</h2><button class="viewer-close" data-viewer-close autofocus><span>Close</span><span aria-hidden="true">×</span></button></header>
    <div class="viewer-stage"><img data-viewer-image alt=""><p class="viewer-error" hidden data-viewer-error>Image unavailable. Use the original-image link below or try the next frame.</p></div>
    <footer class="viewer-bottom"><a data-viewer-original class="viewer-original" href="#">Open image</a><div class="viewer-controls"><button class="round-button" data-viewer-prev aria-label="Previous image">${arrowIcon('left')}</button><span class="viewer-count" data-viewer-count aria-live="polite" aria-atomic="true"></span><button class="round-button" data-viewer-next aria-label="Next image">${arrowIcon('right')}</button></div></footer>
  </div></dialog>`;
}
