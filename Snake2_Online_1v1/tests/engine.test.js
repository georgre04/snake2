'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeBoard,queueTurn,advanceBoard,boardState,speedMs}=require('../server/game-engine');
const {RoomServer}=require('../server/room-server');
const {EventEmitter}=require('node:events');
class FakePeer extends EventEmitter {constructor(){super();this.messages=[];}send(m){this.messages.push(m);}close(){this.emit('close');}}
test('server board: starts at 14x14 with the face-apple gameplay and speed increases',()=>{
 const b=makeBoard(234,'garden');assert.equal(b.snake.length,3);assert.equal(b.apples.length,1);
 const before=speedMs(b);b.eaten=5;assert.ok(speedMs(b)<before);
 const s=boardState(b);assert.equal(s.snake.length,3);assert.ok(s.apples[0]);
});
test('server board: prevents reversing and handles powerups',()=>{
 const b=makeBoard(2,'garden');assert.equal(queueTurn(b,'left'),false);assert.equal(queueTurn(b,'up'),true);
 advanceBoard(b,220);assert.equal(b.dir,'up');
 b.power={x:b.snake[0].x,y:b.snake[0].y-1,type:'shield',expires:99999};
 advanceBoard(b,200);assert.equal(b.shield,1);
});
test('room lifecycle: private code, ready, synchronized round, best of 5 and rematch',()=>{
 let n=100000;const m=new RoomServer({now:()=>n});const a=new FakePeer(),b=new FakePeer();m.attach(a);m.attach(b);
 m.onMessage(a,{type:'create',name:'Alice',skin:'neon',map:'garden'});
 const joinA=a.messages.find(x=>x.type==='joined');assert.match(joinA.code,/^[A-Z2-9]{6}$/);
 m.onMessage(b,{type:'join',code:joinA.code,name:'Bob',skin:'gold'});
 const joinB=b.messages.find(x=>x.type==='joined');assert.equal(joinB.seat,1);
 const r=m.rooms.get(joinA.code);assert.equal(r.players[0].skin,'neon');assert.equal(r.map,'garden');
 m.onMessage(a,{type:'ready',ready:true});m.onMessage(b,{type:'ready',ready:true});assert.equal(r.phase,'countdown');
 n+=3100;m.tick();assert.equal(r.phase,'playing');
 m.onMessage(a,{type:'turn',direction:'up'});n+=125;m.tick();assert.ok(r.boards[0].pending.length>0);
 for(let i=0;i<3;i++){
   r.boards[0].score=10;r.boards[1].score=2;
   r.boards[0].alive=false;r.boards[1].alive=false;n+=120;m.tick();assert.equal(r.wins[0],i+1);
   if(i<2){assert.equal(r.phase,'round-end');n+=4700;m.tick();assert.equal(r.phase,'countdown');n+=3100;m.tick();assert.equal(r.phase,'playing');}
 }
 assert.equal(r.phase,'match-end');assert.ok(a.messages.some(x=>x.type==='round-result'&&x.matchOver));
 m.onMessage(a,{type:'rematch'});assert.equal(r.phase,'match-end');m.onMessage(b,{type:'rematch'});assert.equal(r.phase,'countdown');assert.deepEqual(r.wins,[0,0]);
});
test('no third player can join full room, but token reconnect works',()=>{
 let n=100;const m=new RoomServer({now:()=>n});const p=[new FakePeer(),new FakePeer(),new FakePeer()];p.forEach(x=>m.attach(x));
 m.onMessage(p[0],{type:'create'});const j=p[0].messages.find(x=>x.type==='joined');
 m.onMessage(p[1],{type:'join',code:j.code});
 m.onMessage(p[2],{type:'join',code:j.code});assert.equal(p[2].messages.at(-1).code,'ROOM_FULL');
 p[0].emit('close');
 const p3=new FakePeer();m.attach(p3);m.onMessage(p3,{type:'join',code:j.code,token:j.token});
 assert.equal(p3.messages.find(x=>x.type==='joined').seat,0);
});
