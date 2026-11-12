'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const net=require('node:net');
async function freePort(){return new Promise(res=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>res(p));});});}
async function waitUntil(fn,timeout=5000){const start=Date.now();while(Date.now()-start<timeout){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out waiting for server message');}
function client(port){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`);const messages=[];
 ws.addEventListener('message',e=>messages.push(JSON.parse(e.data)));
 return {ws,messages,send:m=>ws.send(JSON.stringify(m)),get:type=>messages.find(x=>x.type===type)};
}
test('real sockets: hosting, joining, readiness, authoritative snapshots and reconnect',async t=>{
 const port=await freePort();
 const proc=spawn(process.execPath,['server/index.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:'pipe'});
 t.after(()=>{proc.kill('SIGTERM');});
 await waitUntil(()=>fetch(`http://127.0.0.1:${port}/healthz`).then(x=>x.ok).catch(()=>false),3000);
 const health=await fetch(`http://127.0.0.1:${port}/healthz`);assert.equal(health.status,200);
 const html=await(await fetch(`http://127.0.0.1:${port}/`)).text();assert.match(html,/ONLINE 1v1/);assert.match(html,/skinArt/);
 const a=client(port);await waitUntil(()=>a.ws.readyState===WebSocket.OPEN);
 a.send({type:'create',name:'Alpha',map:'jungle',skin:'fire'});
 const joinedA=await waitUntil(()=>a.get('joined'));
 const b=client(port);await waitUntil(()=>b.ws.readyState===WebSocket.OPEN);
 b.send({type:'join',code:joinedA.code,name:'Beta',skin:'neon'});
 const joinedB=await waitUntil(()=>b.get('joined'));
 assert.equal(joinedB.seat,1);
 const room=await waitUntil(()=>a.messages.find(x=>x.type==='room'&&x.players[1]?.name==='Beta'));
 assert.equal(room.map,'jungle');
 a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});
 await waitUntil(()=>a.messages.find(x=>x.type==='room'&&x.phase==='countdown'));
 const state=await waitUntil(()=>a.messages.find(x=>x.type==='state'&&x.boards),4000);
 assert.equal(state.boards.length,2);assert.equal(state.boards[0].map,'jungle');
 const started=await waitUntil(()=>b.messages.find(x=>x.type==='room'&&x.phase==='playing'),5000);
 assert.equal(started.round,1);
 a.send({type:'turn',direction:'up'});
 const snapshot=await waitUntil(()=>b.messages.find(x=>x.type==='state'&&x.phase==='playing'&&x.boards[0].dir==='up'),3000);
 assert.ok(snapshot.boards[0].snake.length>=3);
 // A reconnects using the original seat token while B stays in the room.
 a.ws.close();
 await waitUntil(()=>b.messages.find(x=>x.type==='room'&&x.phase==='interrupted'),2000);
 const a2=client(port);await waitUntil(()=>a2.ws.readyState===WebSocket.OPEN);
 a2.send({type:'join',code:joinedA.code,token:joinedA.token});
 const rejoined=await waitUntil(()=>a2.get('joined'));
 assert.equal(rejoined.seat,0);
 await waitUntil(()=>a2.messages.find(x=>x.type==='room'&&['playing','round-end'].includes(x.phase)),2000);
 a2.ws.close();b.ws.close();
});
