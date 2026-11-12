'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {upgrade}=require('./ws-native');
const {RoomServer}=require('./room-server');
const PORT=Number(process.env.PORT)||3000;
const files={
  '/':['index.html','text/html; charset=utf-8'],
  '/index.html':['index.html','text/html; charset=utf-8'],
  '/multiplayer.css':['multiplayer.css','text/css; charset=utf-8'],
  '/multiplayer.js':['multiplayer.js','text/javascript; charset=utf-8'],
};
const root=path.join(__dirname,'..','public');
const rooms=new RoomServer();
const server=http.createServer((req,res)=>{
  if(req.url==='/healthz'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({ok:true,rooms:rooms.rooms.size}));return;}
  const file=files[req.url];
  if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');return;}
  const filePath=path.join(root,file[0]);
  fs.stat(filePath,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':file[1],'Cache-Control':file[0]==='index.html'?'no-cache':'public,max-age=3600',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',
      'Content-Security-Policy':"default-src 'self' data: blob:; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'",'Content-Length':stat.size});
    if(req.method==='HEAD'){res.end();return;}
    fs.createReadStream(filePath).on('error',()=>res.destroy()).pipe(res);
  });
});
server.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws') {socket.destroy();return;}
  const peer=upgrade(req,socket,head);if(peer)rooms.attach(peer);
});
const ticker=setInterval(()=>rooms.tick(),25);
const heart=setInterval(()=>rooms.heartbeat(),25000);
server.listen(PORT,'0.0.0.0',()=>console.log(`Snake 2 online server: http://localhost:${PORT}`));
function shutdown(){clearInterval(ticker);clearInterval(heart);for(const p of rooms.clients)p.close(1001);server.close(()=>process.exit(0));}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
module.exports={server,rooms};
