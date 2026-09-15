import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../src/site.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const finger = (x, y, identifier = 1) => ({clientX:x, clientY:y, identifier});

// Run the actual browser script against event targets, rather than duplicate the
// gesture algorithm. These checks do not replace physical-device gesture testing.
function carousel(count = 3) {
  const node = () => ({textContent:'', hidden:false, style:{setProperty(){}}, handlers:new Map(),
    addEventListener(type, callback, options) { this.handlers.set(type,{callback,options}); }});
  const image = node(), picture = node(), link = node(), linkText = node();
  picture.querySelector = selector => selector === 'img' ? image : null;
  link.querySelector = () => linkText;
  const slides = Array.from({length:count}, (_,i) => ({title:`Project ${i+1}`, label:'film',
    url:`/films/project-${i+1}/`, alt:`Frame ${i+1}`, position:'50% 50%', mobilePosition:'50% 50%',
    image:{src:`/media/frame-${i+1}.webp`,width:960,height:540}}));
  const nodes = new Map([
    ['picture',picture], ['[data-hero-data]',{textContent:JSON.stringify(slides)}],
    ['[data-feature-link]',link],
    ...['data-hero-count','data-feature-title','data-feature-kind','data-feature-note',
      'data-hero-prev','data-hero-next','data-enhance'].map(key=>[`[${key}]`,node()])
  ]);
  nodes.get('[data-feature-title]').textContent=slides[0].title;
  nodes.get('[data-hero-count]').textContent='01';
  const hero={querySelector:selector=>nodes.get(selector)};
  const viewport={scale:1};
  vm.runInNewContext(source,{
    document:{querySelector:selector=>selector==='[data-hero]'?hero:null},
    window:{visualViewport:viewport,matchMedia:()=>({matches:false})},
    Image:class { decode() { return Promise.resolve(); } },
    setTimeout:()=>0, console
  });
  const emit = (type,touches,changedTouches=[],timeStamp=0) => {
    const event={touches,changedTouches,timeStamp,cancelable:true,defaultPrevented:false,
      preventDefault(){ this.defaultPrevented=true; }};
    picture.handlers.get(type)?.callback(event);
    return event;
  };
  const swipe = async (dx,dy=0,duration=200) => {
    const start=finger(200,200),end=finger(200+dx,200+dy);
    emit('touchstart',[start]);
    const move=emit('touchmove',[end],[],duration/2);
    emit('touchend',[],[end],duration);
    await settle();
    return move;
  };
  return {nodes,picture,image,link,viewport,emit,swipe,
    title:()=>nodes.get('[data-feature-title]').textContent};
}

test('Left/right swipes change the title, image and link, wrap, and work with the arrows',async()=>{
  const c=carousel();
  assert.equal((await c.swipe(-100)).defaultPrevented,true);
  assert.equal(c.title(),'Project 2');
  assert.equal(c.image.src,'/media/frame-2.webp');
  assert.equal(c.link.href,'/films/project-2/');
  assert.equal(c.nodes.get('[data-hero-count]').textContent,'02');
  await c.swipe(100); assert.equal(c.title(),'Project 1');
  await c.swipe(100); assert.equal(c.title(),'Project 3');
  c.nodes.get('[data-hero-next]').handlers.get('click').callback();
  await settle(); assert.equal(c.title(),'Project 1');
});

test('Vertical scrolling, diagonal drags, small taps and long holds do not change slides',async()=>{
  const c=carousel();
  assert.equal((await c.swipe(5,120)).defaultPrevented,false);
  assert.equal((await c.swipe(80,80)).defaultPrevented,false);
  assert.equal((await c.swipe(5,3)).defaultPrevented,false);
  await c.swipe(-100,0,1500);
  assert.equal(c.title(),'Project 1');
  c.emit('touchstart',[finger(200,200)]);
  c.emit('touchmove',[finger(205,240)]);
  c.emit('touchend',[],[finger(100,240)],200);
  await settle(); assert.equal(c.title(),'Project 1','a vertical gesture cannot turn into a slide change');
});

test('Pinching, touch cancellation and zoomed-page panning do not change slides',async()=>{
  const c=carousel();
  c.emit('touchstart',[finger(200,200)]);
  c.emit('touchstart',[finger(200,200),finger(300,200,2)]);
  assert.equal(c.emit('touchmove',[finger(100,200),finger(350,200,2)]).defaultPrevented,false);
  c.emit('touchend',[],[finger(100,200)],200);
  await settle(); assert.equal(c.title(),'Project 1');
  c.emit('touchstart',[finger(200,200)]);
  c.emit('touchcancel',[]);
  c.emit('touchend',[],[finger(100,200)],200);
  await settle(); assert.equal(c.title(),'Project 1');
  c.viewport.scale=2;
  assert.equal((await c.swipe(-100)).defaultPrevented,false);
  assert.equal(c.title(),'Project 1');
  c.viewport.scale=1;
  await c.swipe(-100); assert.equal(c.title(),'Project 2','a fresh swipe works after cancellation or zoom');
});

test('A second touch elsewhere cancels the swipe, and a single slide has no gesture interception',async()=>{
  const c=carousel();
  c.emit('touchstart',[finger(200,200)]);
  const move=c.emit('touchmove',[finger(100,200),finger(300,700,2)]);
  assert.equal(move.defaultPrevented,false);
  c.emit('touchend',[],[finger(100,200)],200);
  await settle(); assert.equal(c.title(),'Project 1');
  assert.equal(carousel(1).picture.handlers.size,0);
});
