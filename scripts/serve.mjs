import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {isIPv4} from 'node:net';
import {build, ROOT, securityHeaders} from './build.mjs';

const review=process.argv.includes('--review');
const watch=process.argv.includes('--watch');
const portArg=process.argv.indexOf('--port');
const port=Number(portArg>=0?process.argv[portArg+1]:process.env.PORT||4321);
const hostArg=process.argv.indexOf('--host');
const host=hostArg>=0?process.argv[hostArg+1]:'127.0.0.1'; // Explicit LAN address for phone testing; loopback by default.
if (!isIPv4(host)) throw new Error('Use an IPv4 address with --host.');
if (!Number.isInteger(port)||port<1||port>65535) throw new Error('Use a port between 1 and 65535.');
const output=path.join(ROOT,review?'.preview':'dist');
await build({review});
let rebuilding=null;
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.avif':'image/avif','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'});res.end('Method not allowed');return;}
    let pathname;
    try { pathname=decodeURIComponent(new URL(req.url,`http://${host}`).pathname); }
    catch {res.writeHead(400);res.end('Bad request');return;}
    if (pathname.includes('\0')||pathname.includes('\\')) {res.writeHead(400);res.end('Bad request');return;}
    const extension=path.extname(pathname);
    if (watch && (!extension||extension==='.html')) {
      rebuilding ||= build({review}).finally(()=>{rebuilding=null;});
      await rebuilding;
    } else if (rebuilding) await rebuilding;
    let file=path.resolve(output, '.'+pathname);
    if (!(file===output||file.startsWith(output+path.sep))) {res.writeHead(403);res.end('Forbidden');return;}
    let status=200;
    let stat=await fs.stat(file).catch(()=>null);
    if (stat?.isDirectory()) {
      if (!pathname.endsWith('/')) {res.writeHead(301,{Location:pathname+'/'});res.end();return;}
      file=path.join(file,'index.html'); stat=await fs.stat(file).catch(()=>null);
    }
    if (!stat?.isFile()) {status=404;file=path.join(output,'404.html');}
    const body=await fs.readFile(file);
    res.writeHead(status,{
      ...securityHeaders,'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow',
      'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':body.length
    });
    res.end(req.method==='HEAD'?undefined:body);
  } catch(error) {
    console.error(error.message);
    res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Build or file error. See the terminal.');
  }
});
server.listen(port,host,()=>console.log(`${review?'LOCAL REVIEW':'Production-filtered preview'}: http://${host}:${port}\n${watch?'Refresh after source/content edits. ':''}Ctrl+C to stop. Nothing has been deployed.`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
