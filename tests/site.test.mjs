import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadContent, validateContent, visibleProjects, routeFor, mediaFile} from '../src/content.mjs';
import {createRenderer, esc} from '../src/render.mjs';
import {build, ROOT} from '../scripts/build.mjs';

const basicSite=()=>({name:'Death Drive Pictures',domain:'https://www.deathdrivepictures.com',description:'An independent production company.',tagline:'Independent films & series',launchApproved:false,brandingApproved:false,logo:null,favicon:null,emails:[],links:[],about:['An independent production company.'],featured:[],selected:[]});
const sample=(extra={})=>({id:'test-film',slug:'test-film',title:'A test title',kind:'film',status:'draft',gallery:[],links:[],...extra});
const data=(projects=[],media={})=>({site:basicSite(),projects,media});
const asset=(extra={})=>({src:'/media/test.webp',full:'/media/test.webp',width:400,height:225,approved:true,...extra});

test('Dedicated routes resolve films, series, and associated episodes',()=>{
 const film=sample(),series=sample({id:'series-one',slug:'series-one',kind:'series'}),episode=sample({id:'episode-one',slug:'episode-one',kind:'episode',series:'series-one'});
 assert.equal(routeFor(film),'/films/test-film/');
 assert.equal(routeFor(episode,[film,series,episode]),'/series/series-one/episode-one/');
});
test('Music video routes distinguish artists, validate paths, and allow an unknown artist',()=>{
 const video=sample({kind:'music-video',id:'wakelee-bangkok',slug:'bangkok',artist:'Wakelee',artistSlug:'wakelee'});
 const other={...video,id:'another-bangkok',artist:'Another band',artistSlug:'another-band'};
 assert.equal(routeFor(video),'/music-videos/wakelee/bangkok/');
 assert.equal(routeFor(other),'/music-videos/another-band/bangkok/');
 assert.equal(routeFor(sample({kind:'music-video',slug:'no-fly-list'})),'/music-videos/no-fly-list/');
 assert.doesNotThrow(()=>validateContent(data([video,other]),{review:true}));
 assert.throws(()=>validateContent(data([{...video,artistSlug:'../private'}]),{review:true}),/artist slug/);
});
test('Music videos are grouped by artist and song, with correct navigation and project metadata',()=>{
 const bangkok=sample({kind:'music-video',id:'wakelee-bangkok',slug:'bangkok',title:'Bangkok',artist:'Wakelee',artistSlug:'wakelee',format:'Music video'});
 const gary={...bangkok,id:'wakelee-garys-outcome',slug:'garys-outcome',title:"Gary's Outcome"};
 const noFly=sample({kind:'music-video',id:'no-fly-list',slug:'no-fly-list',title:'No Fly List'});
 const r=createRenderer({...data([gary,noFly,sample(),bangkok]),review:true});
 const index=r.index('music-video');
 assert(index.indexOf('>Bangkok<')<index.indexOf('>Gary&#39;s Outcome<'));
 assert(index.indexOf('>Gary&#39;s Outcome<')<index.indexOf('>No Fly List<'));
 assert(index.includes('<h2 class="artist-heading">Wakelee</h2>'));
 assert(!r.index('film').includes('>Bangkok<'));assert(!r.index('film').includes('>No Fly List<'));
 const html=r.project(bangkok);
 assert(html.includes('<title>Bangkok — Wakelee — Death Drive Pictures'));
 assert(html.includes('<p class="project-artist">Wakelee</p>'));
 assert(html.includes('All music videos'));assert(!html.includes('All films'));
 assert(html.includes('<a href="/music-videos/" aria-current="true">Music Videos</a>'));
 assert(index.match(/href="\/music-videos\/" aria-current="page"/g).length===2,'desktop and mobile both expose the section');
});
test('An approved music video exports at its own route and enters the sitemap',async()=>{
 const root=path.join(ROOT,'.test-output','music-release');
 await fs.mkdir(path.join(root,'content'),{recursive:true});
 await fs.cp(path.join(ROOT,'src'),path.join(root,'src'),{recursive:true});
 const video=sample({kind:'music-video',id:'wakelee-bangkok',slug:'bangkok',title:'Bangkok',artist:'Wakelee',artistSlug:'wakelee',status:'published',copyApproved:true});
 await fs.writeFile(path.join(root,'content/site.json'),JSON.stringify({...basicSite(),launchApproved:true}));
 await fs.writeFile(path.join(root,'content/projects.json'),JSON.stringify([video]));
 await fs.writeFile(path.join(root,'content/media.json'),'{}');
 const report=await build({root});
 assert(report.routes.includes('/music-videos/wakelee/bangkok/'));
 const html=await fs.readFile(path.join(root,'dist/music-videos/wakelee/bangkok/index.html'),'utf8');
 assert(html.includes('https://www.deathdrivepictures.com/music-videos/wakelee/bangkok/'));
 const sitemap=await fs.readFile(path.join(root,'dist/sitemap.xml'),'utf8');
 assert(sitemap.includes('/music-videos/wakelee/bangkok/'));
 assert(!sitemap.includes('/films/bangkok/'));
});
test('Drafts are omitted; episodes require a visible series',()=>{
 const s=sample({id:'s',slug:'s',kind:'series'}),e=sample({id:'e',slug:'e',kind:'episode',series:'s',status:'published'});
 assert.deepEqual(visibleProjects([s,e]),[]);
 assert.equal(visibleProjects([s,e],true).length,2);
});
test('Empty content is a valid non-publication-ready build',()=>assert.doesNotThrow(()=>validateContent(data())));
test('Release check refuses the unapproved site',()=>assert.throws(()=>validateContent(data(),{release:true}),/Launch is not approved/));
test('Production rejects a review fixture marked as published',()=>assert.throws(()=>validateContent(data([sample({status:'published',previewOnly:true})])),/cannot be published/));
test('Production rejects copy without explicit approval',()=>assert.throws(()=>validateContent(data([sample({status:'published'})])),/approve copy/));
test('Published episodes must have a published parent',()=>{
 const s=sample({id:'s',slug:'s',kind:'series'}),e=sample({id:'e',slug:'e',kind:'episode',series:'s',status:'published',copyApproved:true});
 assert.throws(()=>validateContent(data([s,e])),/publish its series first/);
});
test('Unapproved media never enters public output',()=>{
 const p=sample({status:'published',copyApproved:true,hero:{image:'image',alt:'Test description'}});
 assert.throws(()=>validateContent(data([p],{image:asset({approved:false})})),/explicitly approved media/);
});
test('Reference media never enters public output, even when approved=true',()=>{
 const p=sample({status:'published',copyApproved:true,hero:{image:'image',alt:'Test description'}});
 assert.throws(()=>validateContent(data([p],{image:asset({previewOnly:true})})),/explicitly approved media/);
});
test('Missing alt text is rejected for visible gallery images',()=>{
 const p=sample({gallery:[{image:'image'}]});
 assert.throws(()=>validateContent(data([p],{image:asset()}),{review:true}),/alt text/);
});
test('Duplicate routes and invalid slugs are rejected',()=>{
 assert.throws(()=>validateContent(data([sample(),sample({id:'another'})])),/Duplicate route/);
 assert.throws(()=>validateContent(data([sample({slug:'../bad'})])),/Invalid ID or slug/);
});
test('Media paths prohibit traversal and external resources',()=>{
 for(const src of ['/media/../secret.jpg','/media/a//b.png','https://external.test/x.webp','/media/test.png?private=1']) assert.throws(()=>mediaFile(src));
 assert.equal(mediaFile('/media/films/still-960.webp'),'films/still-960.webp');
});
test('Untrusted link protocols and malformed email are rejected',()=>{
 const d=data(); d.site.links=[{label:'No',url:'javascript:alert(1)'}];assert.throws(()=>validateContent(d),/HTTPS URL/);
 const d2=data();d2.site.emails=['bad\r\n@example.test'];assert.throws(()=>validateContent(d2),/valid email/);
});
test('Variant dimensions cannot request upscaling',()=>assert.throws(()=>validateContent(data([],{a:asset({sources:[{src:'/media/a.webp',width:999}]})})),/must not upscale/));
test('HTML and inline JSON escape user-provided text',()=>{
 assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
 const p=sample({title:'<img src=x onerror=alert(1)>',logline:'<script>alert(1)</script>'});
 const r=createRenderer({...data([p]),review:true});const html=r.project(p);
 assert(!html.includes('<img src=x'));assert(html.includes('&lt;script&gt;'));
});
test('Unknown featured IDs are surfaced rather than silently guessed',()=>{
 const d=data();d.site.featured=['missing'];assert.throws(()=>validateContent(d),/Unknown featured/);
});
test('Omitted metadata and missing contact data produce no fake details',()=>{
 const p=sample();const d=data([p]);const r=createRenderer({...d,review:false});
 assert(!r.project(p).includes('undefined'));assert(!r.project(p).includes('Draft logline'));
 assert(!r.contact().includes('mailto:'));assert(!r.contact().includes('<form'));
});
test('Single featured project has no carousel controls',()=>{
 const p=sample({hero:{image:'image',alt:'Test image'}}),d=data([p],{image:asset()});d.site.featured=[p.id];
 const html=createRenderer({...d,review:true}).home();assert(!html.includes('data-hero-prev'));
});
test('Published metadata and sitemap-ready canonical values use actual content',()=>{
 const p=sample({status:'published',copyApproved:true,logline:'Approved synopsis',hero:{image:'image',alt:'Approved image'}}),d=data([p],{image:asset()});d.site.launchApproved=true;
 const html=createRenderer({...d,review:false}).project(p);
 assert(html.includes('https://www.deathdrivepictures.com/films/test-film/'));
 assert(html.includes('property="og:image"'));assert(html.includes('content="index, follow"'));
});
test('Builds separate review routes/media from production and remove stale outputs',async()=>{
 const fixtureRoot=path.join(ROOT,'.test-output','build-fixture');
 await fs.rm(fixtureRoot,{recursive:true,force:true});
 await fs.mkdir(path.join(fixtureRoot,'content'),{recursive:true});
 await fs.mkdir(path.join(fixtureRoot,'references/concept-images'),{recursive:true});
 await fs.cp(path.join(ROOT,'src'),path.join(fixtureRoot,'src'),{recursive:true});
 await fs.writeFile(path.join(fixtureRoot,'content/site.json'),JSON.stringify(basicSite()));
 await fs.writeFile(path.join(fixtureRoot,'content/projects.json'),'[]');
 await fs.writeFile(path.join(fixtureRoot,'content/media.json'),'{}');
 const fixtureProjects=[
   sample({id:'fixture-film',slug:'fixture-film',previewOnly:true,hero:{image:'pixel',alt:'Synthetic test pixel'}}),
   sample({id:'fixture-series',slug:'fixture-series',kind:'series',previewOnly:true}),
   sample({id:'fixture-episode',slug:'fixture-episode',kind:'episode',series:'fixture-series',previewOnly:true})
 ];
 await fs.writeFile(path.join(fixtureRoot,'references/review-content.json'),JSON.stringify({projects:fixtureProjects,featured:['fixture-film'],selected:['fixture-film']}));
 await fs.writeFile(path.join(fixtureRoot,'references/media.json'),JSON.stringify({pixel:{src:'/media/pixel.png',full:'/media/pixel.png',width:1,height:1,previewOnly:true}}));
 await fs.writeFile(path.join(fixtureRoot,'references/concept-images/pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jTgAAAABJRU5ErkJggg==','base64'));
 const previewOut=path.join(fixtureRoot,'.preview'),publicOut=path.join(fixtureRoot,'dist');
 const preview=await build({root:fixtureRoot,review:true});assert.equal(preview.projectCount,3);assert(preview.assetFiles>0);
 const publicBuild=await build({root:fixtureRoot});assert.equal(publicBuild.projectCount,0);assert.equal(publicBuild.assetFiles,0);
 const files=await fs.readdir(publicOut,{recursive:true});assert(!files.some(f=>f.includes('fixture-film')||f.includes('pixel')||f.includes('fixture-episode')));
 const sitemap=await fs.readFile(path.join(publicOut,'sitemap.xml'),'utf8');assert(!sitemap.includes('<url>'));
 await fs.writeFile(path.join(publicOut,'stale.html'),'private draft');await build({root:fixtureRoot});
 await assert.rejects(fs.stat(path.join(publicOut,'stale.html')));
});
test('Every review page is noindex and retains dedicated anchors',async()=>{
 const series=sample({id:'fixture-series',slug:'fixture-series',kind:'series'});
 const episode=sample({id:'fixture-episode',slug:'fixture-episode',kind:'episode',series:'fixture-series'});
 const d=data([sample(),series,episode]);const r=createRenderer({...d,review:true});
 for(const p of d.projects){const html=p.kind==='series'?r.series(p):r.project(p);assert(html.includes('content="noindex, nofollow"'));assert(!html.includes('rel="canonical"'));}
 assert(r.home().includes('href="/series/fixture-series/"'));
});
test('Browser script contains no autoplay timer, analytics or cookie logic',async()=>{
 const js=await fs.readFile(path.join(ROOT,'src/site.js'),'utf8');
 for(const pattern of ['setInterval','document.cookie','localStorage','googletagmanager','autoplay']) assert(!js.includes(pattern));
});

// ---- Real-asset integration (September 2026) ----
import {kindLabel} from '../src/render.mjs';

test('Format-aware labels never call a music video a film, or a series television',()=>{
 assert.equal(kindLabel(sample({format:'Music video'})),'music video');
 assert.equal(kindLabel(sample({format:'Short film'})),'film');
 assert.equal(kindLabel(sample({kind:'series'})),'series');
 const p=sample({format:'Music video',hero:{image:'image',alt:'A performer on stage'}}),d=data([p],{image:asset()});d.site.featured=[p.id];
 const html=createRenderer({...d,review:true}).home();
 assert(html.includes('Selected music video'));assert(html.includes('Explore music video'));assert(!html.includes('Selected film'));
});
test('Concept fixtures are never mixed into a site that has genuine projects',async()=>{
 const {projects,media}=await loadContent(ROOT,{review:true});
 assert(projects.length>0);
 assert(!projects.some(p=>p.previewOnly),'review fixtures leaked into real content');
 assert(!Object.values(media).some(m=>m.previewOnly),'concept media leaked into real content');
});
test('Cards use the content focal point; gallery images stay uncropped',()=>{
 const p=sample({hero:{image:'image',alt:'Test',desktopPosition:'40% 30%',cardPosition:'62% 35%'},gallery:[{image:'image',alt:'Test'}]}),d=data([p],{image:asset()});
 const r=createRenderer({...d,review:true});
 assert(r.index('film').includes('--card-focal:62% 35%'));
 assert(!r.project(p).includes('--card-focal'));
 assert.throws(()=>validateContent(data([sample({hero:{image:'image',alt:'x',cardPosition:'left'}})],{image:asset()}),{review:true}),/cardPosition/);
});
test('Branding renders logo, favicon, touch icon and a share-card fallback',()=>{
 const d=data([],{logo:asset({src:'/media/logo-640.webp',sources:[{src:'/media/logo-320.webp',width:320}]}),icon:asset({src:'/media/icon-512.png',width:512,height:512,sources:[{src:'/media/icon-32.png',width:32},{src:'/media/icon-180.png',width:180},{src:'/media/icon-512.png',width:512}]}),share:asset({src:'/media/share-1200.png',width:1200,height:630})});
 Object.assign(d.site,{logo:'logo',favicon:'icon',shareImage:'share'});
 const html=createRenderer({...d,review:false}).about();
 assert(html.includes('class="brand-image"'));assert(html.includes('href="/media/icon-32.png"'));assert(html.includes('rel="apple-touch-icon" href="/media/icon-180.png"'));
 assert(html.includes('og:image" content="https://www.deathdrivepictures.com/media/share-1200.png"'));
});
test('Real content builds without exposing source names, private paths or unapproved media',async()=>{
 const outDir=path.join(ROOT,'.test-output','real-public');
 const review=await build({review:true,output:path.join(ROOT,'.test-output','real-review')});
 const pub=await build({output:outDir});
 const content=await loadContent(ROOT);
 assert.equal(review.projectCount,visibleProjects(content.projects,true).length);
 assert.equal(pub.projectCount,visibleProjects(content.projects).length);
 const media=JSON.parse(await fs.readFile(path.join(ROOT,'content/media.json'),'utf8'));
 const files=(await fs.readdir(outDir,{recursive:true})).map(String);
 for (const f of files.filter(f=>f.startsWith('media/'))) {
   const entry=Object.entries(media).find(([,m])=>[m.src,m.full,...(m.sources||[]).map(s=>s.src)].includes('/'+f));
   assert(entry,`unregistered file in public build: ${f}`);
   assert.equal(entry[1].approved,true,`unapproved media in public build: ${f}`);
 }
 assert(!files.some(f=>/\.(json|py|mjs|md|eps|pdf|zip)$/.test(f)),'source/content files copied to public build');
 const reviewFiles=(await fs.readdir(path.join(ROOT,'.test-output','real-review'),{recursive:true})).map(String).filter(f=>f.endsWith('.html'));
 for (const f of reviewFiles) {
   const html=await fs.readFile(path.join(ROOT,'.test-output','real-review',f),'utf8');
   assert(!/DDP-ASSETS|Screenshot 20|\.png"|masters\//.test(html.replace(/\/media\/[a-z0-9-]+\.png/g,'')),`source name or path leaked in ${f}`);
 }
});
test('Output is swapped in whole: stale files disappear and no staging folders remain',async()=>{
 const out=path.join(ROOT,'.test-output','swap');
 await build({review:true,output:out});
 await fs.writeFile(path.join(out,'stale.txt'),'old');
 await Promise.all([build({review:true,output:out}),build({review:true,output:out})]);
 await assert.rejects(fs.stat(path.join(out,'stale.txt')));
 const siblings=(await fs.readdir(path.dirname(out))).filter(n=>n.startsWith('swap.'));
 assert.deepEqual(siblings,[]);
 assert((await fs.stat(path.join(out,'index.html'))).isFile());
});
