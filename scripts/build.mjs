import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadContent, validateContent, mediaFile, routeFor} from '../src/content.mjs';
import {createRenderer, esc} from '../src/render.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'none'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
};

/** Generate real HTML files. Source directories are never copied wholesale. */
export async function build({root = ROOT, review = false, output} = {}) {
  const out = output || path.join(root, review ? '.preview' : 'dist');
  const data = await loadContent(root, {review});
  const {projects, usedIDs} = validateContent(data, {review});
  const renderer = createRenderer({...data, projects, review});
  const pages = new Map([
    ['/',renderer.home()], ['/films/',renderer.index('film')], ['/series/',renderer.index('series')],
    ['/music-videos/',renderer.index('music-video')],
    ['/about/',renderer.about()], ['/contact/',renderer.contact()], ['/404.html',renderer.notFound()]
  ]);
  for (const project of projects) {
    pages.set(routeFor(project, projects), project.kind === 'series' ? renderer.series(project) : renderer.project(project));
  }
  // Validate every referenced asset before removing the previous output.
  const assets = new Map();
  for (const id of usedIDs) {
    const media = data.media[id];
    const source = media.previewOnly ? 'references/concept-images' : 'assets/web';
    for (const url of new Set([media.src,media.full || media.src,...(media.sources || []).map(s=>s.src)])) {
      const filename = mediaFile(url);
      const original = path.join(root, source, filename);
      const stats = await fs.stat(original).catch(()=>null);
      if (!stats?.isFile()) throw new Error(`Missing derivative for ${id}: ${original}`);
      if (assets.has(url) && assets.get(url)!==original) throw new Error(`Conflicting asset path: ${url}`);
      assets.set(url, original);
    }
  }
  const allowedDefault = [path.join(root, 'dist'),path.join(root, '.preview')];
  if (!allowedDefault.includes(out) && !out.includes(`${path.sep}.test-output${path.sep}`)) {
    throw new Error('Output must be dist, .preview, or a .test-output subdirectory.');
  }
  // Build into a sibling staging folder, then swap it in. A server reading the previous
  // output never sees a half-deleted directory, and stale files still disappear.
  const staging=`${out}.building-${process.pid}-${Math.random().toString(36).slice(2)}`;
  await fs.rm(staging, {recursive:true, force:true});
  await fs.mkdir(staging,{recursive:true});
  try {
    for (const [route,html] of pages) {
      const destination=path.join(staging,route.endsWith('/')?route.slice(1)+'index.html':route.slice(1));
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await fs.writeFile(destination,html);
    }
    for (const filename of ['styles.css','site.js']) await fs.copyFile(path.join(root,'src',filename),path.join(staging,filename));
    for (const [url,original] of assets) {
      const destination=path.join(staging,url.slice(1));
      await fs.mkdir(path.dirname(destination),{recursive:true});
      // Derivatives are immutable, content-hashed files: link them when possible instead of copying megabytes per rebuild.
      await fs.link(original,destination).catch(()=>fs.copyFile(original,destination));
    }
    const indexable = data.site.launchApproved === true && !review;
    await fs.writeFile(path.join(staging,'robots.txt'),indexable?`User-agent: *\nAllow: /\nSitemap: ${data.site.domain}/sitemap.xml\n`:'User-agent: *\nDisallow: /\n');
    const sitemapRoutes=indexable?[...pages.keys()].filter(r=>r!=='/404.html'):[];
    await fs.writeFile(path.join(staging,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapRoutes.map(r=>`\n  <url><loc>${esc(data.site.domain+r)}</loc></url>`).join('')}\n</urlset>\n`);
    const headers={...securityHeaders,...(!indexable?{'X-Robots-Tag':'noindex, nofollow'}:{})};
    await fs.writeFile(path.join(staging,'_headers'),`/*\n${Object.entries(headers).map(([k,v])=>`  ${k}: ${v}`).join('\n')}\n\n/media/*\n  Cache-Control: public, max-age=3600\n`);
    // Another local server may be swapping in its own rebuild at the same moment; retry briefly.
    for (let attempt=1;;attempt++) {
      const retired=`${out}.retired-${process.pid}-${Math.random().toString(36).slice(2)}`;
      const hadPrevious=await fs.rename(out,retired).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
      try {
        await fs.rename(staging,out);
        if (hadPrevious) await fs.rm(retired,{recursive:true,force:true});
        break;
      } catch (error) {
        const retryable=['ENOTEMPTY','EEXIST'].includes(error.code) && attempt<3;
        if (hadPrevious) await (retryable ? fs.rm(retired,{recursive:true,force:true}) : fs.rename(retired,out).catch(()=>{}));
        if (!retryable) throw error;
      }
    }
  } catch (error) {
    await fs.rm(staging,{recursive:true,force:true});
    throw error;
  }
  const indexable = data.site.launchApproved === true && !review;
  return {mode:review?'LOCAL REVIEW — NOT FOR DEPLOYMENT':'PRODUCTION-FILTERED',output:out,routes:[...pages.keys()],projectCount:projects.length,assetFiles:assets.size,indexable};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { const report=await build({review:process.argv.includes('--review')}); console.log(JSON.stringify(report,null,2)); }
  catch(error) { console.error(`Build failed: ${error.message}`); process.exitCode=1; }
}
