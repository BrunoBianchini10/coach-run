/* PaceCoach — service worker.
   Suba VERSION para forçar a reinstalação do shell num deploy. */
const VERSION = 'v1';
const SHELL = 'pacecoach-shell-' + VERSION;
const TILES = 'pacecoach-tiles-' + VERSION;
const FONTS = 'pacecoach-fonts-' + VERSION;
const TILE_LIMIT = 150;
const KEEP = [SHELL, TILES, FONTS];

const SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', e=>{
  e.waitUntil((async ()=>{
    const c = await caches.open(SHELL);
    // cache:'reload' evita que o cache HTTP do navegador semeie o shell com
    // uma versão velha justamente na instalação
    await c.addAll(SHELL_URLS.map(u=> new Request(u, {cache:'reload'})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e=>{
  e.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=> KEEP.indexOf(k)===-1).map(k=> caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trimCache(name, max){
  const c = await caches.open(name);
  const keys = await c.keys();
  if(keys.length <= max) return;
  await Promise.all(keys.slice(0, keys.length-max).map(k=> c.delete(k)));
}

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method !== 'GET') return;

  let url;
  try{ url = new URL(req.url); }catch(err){ return; }

  // tiles do mapa: cache primeiro, com teto. Repetir a mesma rota passa a
  // funcionar offline, e o volume não cresce sem limite
  if(url.hostname === 'tile.openstreetmap.org' || url.hostname.endsWith('.tile.openstreetmap.org')){
    e.respondWith((async ()=>{
      const c = await caches.open(TILES);
      const hit = await c.match(req);
      if(hit) return hit;
      try{
        const res = await fetch(req);
        if(res && (res.ok || res.type === 'opaque')){
          await c.put(req, res.clone());
          trimCache(TILES, TILE_LIMIT);
        }
        return res;
      }catch(err){
        return new Response('', {status:504, statusText:'tile indisponível'});
      }
    })());
    return;
  }

  // fontes do Google: sem elas o app abre offline mas com a tipografia trocada
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith((async ()=>{
      const c = await caches.open(FONTS);
      const hit = await c.match(req);
      if(hit) return hit;
      try{
        const res = await fetch(req);
        if(res && (res.ok || res.type === 'opaque')) await c.put(req, res.clone());
        return res;
      }catch(err){
        return new Response('', {status:504, statusText:'fonte indisponível'});
      }
    })());
    return;
  }

  if(url.origin !== self.location.origin) return;

  // a página em si: rede primeiro. Assim um deploy novo aparece sem precisar
  // remover o app da tela de início; o cache fica só como rede de segurança
  if(req.mode === 'navigate'){
    e.respondWith((async ()=>{
      try{
        const res = await fetch(req);
        const c = await caches.open(SHELL);
        c.put('./index.html', res.clone());
        return res;
      }catch(err){
        const c = await caches.open(SHELL);
        return (await c.match('./index.html')) || (await c.match('./')) ||
               new Response('Sem conexão e sem cópia local.', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
      }
    })());
    return;
  }

  // demais arquivos do site: responde do cache e revalida em segundo plano
  e.respondWith((async ()=>{
    const c = await caches.open(SHELL);
    const hit = await c.match(req);
    const net = fetch(req).then(res=>{ if(res && res.ok) c.put(req, res.clone()); return res; }).catch(()=> null);
    return hit || (await net) || new Response('', {status:504});
  })());
});
