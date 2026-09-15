import fs from 'node:fs/promises';
import path from 'node:path';

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const localMediaPattern = /^\/media\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\.(webp|avif|png|jpe?g|svg|ico)$/i;
export const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
export function mediaFile(url) {
  if (typeof url !== 'string' || !localMediaPattern.test(url) || url.includes('..') || url.includes('//')) {
    throw new Error(`Unsafe media path: ${url}`);
  }
  return url.slice('/media/'.length);
}
export function routeFor(project, allProjects = []) {
  if (project.kind === 'music-video') {
    return `/music-videos/${project.artistSlug ? project.artistSlug+'/' : ''}${project.slug}/`;
  }
  if (project.kind === 'episode') {
    const parent = allProjects.find(p => p.id === project.series && p.kind === 'series');
    if (!parent) throw new Error(`Episode ${project.id} has no series.`);
    return `/series/${parent.slug}/${project.slug}/`;
  }
  return `/${project.kind === 'series' ? 'series' : 'films'}/${project.slug}/`;
}
export function visibleProjects(projects, review = false) {
  const allowed = projects.filter(p => review || (p.status === 'published' && !p.previewOnly));
  return allowed.filter(p => p.kind !== 'episode' || allowed.some(s => s.id === p.series && s.kind === 'series'));
}
function webURL(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label}: expected an absolute HTTPS URL.`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${label}: expected a plain HTTPS URL.`);
}
export function validateContent({site, projects, media}, {review = false, release = false} = {}) {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(site && typeof site.name === 'string' && site.name.trim(), 'Site name is required.');
  webURL(site.domain, 'site.domain');
  assert(Array.isArray(projects), 'projects.json must be an array.');
  assert(media && typeof media === 'object' && !Array.isArray(media), 'media.json must be an object.');
  assert(Array.isArray(site.about) && site.about.every(x => typeof x === 'string'), 'site.about must contain paragraphs.');
  assert(Array.isArray(site.emails) && site.emails.every(email => typeof email === 'string' && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email)), 'site.emails must contain valid email addresses.');
  for (const field of ['featured','selected','links']) assert(Array.isArray(site[field]), `site.${field} must be an array.`);
  for (const link of site.links) { assert(link.label?.trim(), 'Link labels are required.'); webURL(link.url, 'site.links'); }
  const ids = new Set(), routes = new Set();
  for (const p of projects) {
    assert(typeof p.title === 'string' && p.title.trim(), 'Each project requires a title.');
    assert(slugPattern.test(p.id) && slugPattern.test(p.slug), `Invalid ID or slug for ${p.title}.`);
    assert(!ids.has(p.id), `Duplicate project ID: ${p.id}`); ids.add(p.id);
    assert(['film','series','episode','music-video'].includes(p.kind), `${p.id}: invalid kind.`);
    if (p.artist !== undefined) assert(typeof p.artist === 'string' && p.artist.trim(), `${p.id}: artist must be a nonempty name.`);
    if (p.artistSlug !== undefined) assert(p.kind === 'music-video' && p.artist && slugPattern.test(p.artistSlug), `${p.id}: invalid artist slug.`);
    assert(['draft','published'].includes(p.status), `${p.id}: invalid status.`);
    assert(!p.gallery || Array.isArray(p.gallery), `${p.id}: gallery must be an array.`);
    assert(!p.links || Array.isArray(p.links), `${p.id}: links must be an array.`);
    for (const link of p.links || []) { assert(link.label?.trim(), `${p.id}: link requires a label.`); webURL(link.url, p.id); }
    if (p.watchUrl !== undefined) webURL(p.watchUrl, `${p.id}.watchUrl`);
    const route = routeFor(p, projects);
    assert(!routes.has(route), `Duplicate route: ${route}`); routes.add(route);
    if (p.kind === 'episode') assert(p.id !== p.series, `${p.id} cannot be its own series.`);
    if (!review && p.status === 'published') {
      assert(!p.previewOnly, `${p.id}: review fixtures cannot be published.`);
      assert(p.copyApproved === true, `${p.id}: approve copy before publishing.`);
      assert(p.kind !== 'episode' || projects.some(s => s.id === p.series && s.status === 'published' && !s.previewOnly), `${p.id}: publish its series first.`);
    }
    if (!review && p.status !== 'published') continue; // Incomplete drafts never reach the build.
    if (p.hero) {
      assert(p.hero.alt?.trim(), `${p.id}: hero alt text is required.`);
      assert(media[p.hero.image], `${p.id}: hero image is missing.`);
      for (const key of ['desktopPosition','mobilePosition','cardPosition']) if (p.hero[key]) {
        assert(/^(100|\d{1,2})(\.\d+)?% (100|\d{1,2})(\.\d+)?%$/.test(p.hero[key]), `${p.id}: invalid ${key}.`);
      }
      if (p.hero.mobileImage) assert(media[p.hero.mobileImage], `${p.id}: mobile image is missing.`);
    }
    for (const item of p.gallery || []) {
      assert(item.alt?.trim(), `${p.id}: every gallery image requires alt text.`);
      assert(media[item.image], `${p.id}: missing media ${item.image}.`);
    }
  }
  const visible = visibleProjects(projects, review);
  for (const id of [...site.featured, ...site.selected]) assert(ids.has(id), `Unknown featured/selected ID: ${id}`);
  for (const image of Object.values(media)) {
    mediaFile(image.src); mediaFile(image.full || image.src);
    assert(Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0, 'Every image needs pixel dimensions.');
    for (const variant of image.sources || []) {
      mediaFile(variant.src);
      assert(Number.isInteger(variant.width) && variant.width > 0 && variant.width <= image.width, 'Variant width must be positive and must not upscale.');
    }
  }
  const usedIDs = new Set(visible.flatMap(p => [p.hero?.image,p.hero?.mobileImage,...(p.gallery || []).map(g => g.image)]).filter(Boolean));
  for (const id of [site.logo, site.favicon, site.shareImage].filter(Boolean)) { assert(media[id], `Unknown branding media ID: ${id}`); usedIDs.add(id); }
  if (!review) for (const id of usedIDs) {
    assert(media[id] && media[id].approved === true && !media[id].previewOnly, `${id}: only explicitly approved media can enter the public build.`);
  }
  if (release) {
    assert(!review, 'Review builds cannot be released.');
    assert(site.launchApproved === true, 'Launch is not approved. No deployment was attempted.');
    assert(site.brandingApproved === true && site.logo && site.favicon, 'Approved company logo and favicon are required for launch.');
    assert(site.emails.length, 'A contact email is required for launch.');
    assert(visible.some(p => ['film','series','music-video'].includes(p.kind)), 'Approve at least one project before launch.');
    assert(site.featured.some(id => visible.some(p => p.id === id && p.hero)), 'Select an approved homepage hero before launch.');
  }
  return {projects: visible, usedIDs};
}
export async function loadContent(root, {review = false} = {}) {
  const site = await readJSON(path.join(root, 'content/site.json'));
  let projects = await readJSON(path.join(root, 'content/projects.json'));
  let media = await readJSON(path.join(root, 'content/media.json'));
  // Concept fixtures only stand in for an empty site. Once genuine projects exist they are never mixed in.
  if (review && projects.length === 0) {
    try {
      const fixture = await readJSON(path.join(root, 'references/review-content.json'));
      // Genuine projects take precedence; never overwrite user content with fixtures.
      const realIDs = new Set(projects.map(p => p.id));
      const extras = fixture.projects.filter(p => !realIDs.has(p.id));
      const referenceMedia = await readJSON(path.join(root, 'references/media.json'));
      const collisions = Object.keys(referenceMedia).filter(id => Object.hasOwn(media, id));
      if (collisions.length) throw new Error(`Reference media IDs conflict with real media: ${collisions.join(', ')}. Remove review fixtures or rename the reference IDs.`);
      projects = [...projects, ...extras];
      media = {...referenceMedia, ...media};
      if (!site.featured.length) site.featured = fixture.featured;
      if (!site.selected.length) site.selected = fixture.selected;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {site, projects, media};
}
