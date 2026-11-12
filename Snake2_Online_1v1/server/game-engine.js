'use strict';

// All gameplay is authoritative on the server. Client controls are directions only.
const SIZE = 14;
const ROUND_MS = 60_000;
const DIRECTIONS = Object.freeze({
  up: {x: 0, y: -1}, right: {x: 1, y: 0}, down: {x: 0, y: 1}, left: {x: -1, y: 0},
});
const MAPS = Object.freeze({
  garden: [],
  jungle: [[2,2],[3,2],[11,3],[10,3],[2,11],[3,11],[10,10],[11,10]],
  volcano: [[2,2],[3,2],[10,2],[11,2],[2,11],[3,11],[10,11],[11,11],[6,3],[7,10]],
  ice: [[3,3],[4,3],[10,3],[9,3],[3,10],[4,10],[9,10],[10,10]],
  neon: [[6,2],[7,2],[6,11],[7,11]],
});
const SKINS = ['green', 'gold', 'ice', 'fire', 'neon'];
function rand32(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
const equal = (a,b) => !!a && !!b && a.x === b.x && a.y === b.y;
const key = p => p.x + ',' + p.y;
function freeCells(board) {
  const taken = new Set(board.snake.map(key));
  for(const o of MAPS[board.map]) taken.add(o[0]+','+o[1]);
  for(const a of board.apples) taken.add(key(a));
  if(board.power) taken.add(key(board.power));
  const cells = [];
  for(let y=0;y<SIZE;y++) for(let x=0;x<SIZE;x++) {
    if(!taken.has(x+','+y) && !(board.map==='neon' && ((x===1&&y===2)||(x===12&&y===11)))) cells.push({x,y});
  }
  return cells;
}
function spawnApple(board) {
  const free = freeCells(board); if(!free.length) return false;
  const p = free[Math.floor(board.rng()*free.length)];
  board.apples.push({...p, type: board.rng()<0.16 ? 'gold' : 'normal'});
  return true;
}
function makeBoard(seed,map='garden') {
  if(!MAPS[map]) map='garden';
  const b={map,seed, rng:rand32(seed), snake:[{x:5,y:7},{x:4,y:7},{x:3,y:7}], dir:'right', pending:[],
    apples:[], power:null, powerAt:6600, score:0,eaten:0, shield:0, freezeUntil:0,alive:true,
    deathReason:'', elapsed:0,accum:0,blockedUntil:0, events:[]};
  spawnApple(b);
  return b;
}
function queueTurn(board,direction) {
  if(!board.alive || !DIRECTIONS[direction] || board.pending.length >= 2) return false;
  const last = board.pending.length ? board.pending[board.pending.length-1] : board.dir;
  const a=DIRECTIONS[last], b=DIRECTIONS[direction];
  if(a.x===b.x && a.y===b.y || a.x===-b.x && a.y===-b.y) return false;
  board.pending.push(direction); return true;
}
function speedMs(b) {
  const base=b.map==='ice'?183:194;
  const step=Math.max(78,base-b.eaten*8.5);
  return b.elapsed<b.freezeUntil ? step*1.85 : step;
}
function rescue(board) {
  for(const [x,y] of [[5,7],[5,4],[5,11],[9,7],[3,6],[9,3],[11,9]]) {
    const parts=[{x,y},{x:x-1,y},{x:x-2,y}];
    const rocks=new Set(MAPS[board.map].map(p=>p.join(',')));
    if(parts.every(p=>p.x>=0 && p.x<SIZE && p.y>=0 && p.y<SIZE && !rocks.has(key(p)) && !board.apples.some(a=>equal(a,p)))) {
      board.snake=parts;board.dir='right';board.pending=[];board.accum=0;board.events.push('shield');return;
    }
  }
  board.snake=[{x:5,y:7},{x:4,y:7},{x:3,y:7}];board.dir='right';board.pending=[];board.accum=0;
}
function collide(board, reason) {
  if(board.shield>0){ board.shield=0;rescue(board);return; }
  board.alive=false; board.deathReason=reason; board.events.push('crash');
}
function applyPower(board,type){
  if(type==='freeze') board.freezeUntil=board.elapsed+8000;
  if(type==='shield') board.shield=1;
  if(type==='shrink') board.snake=board.snake.slice(0,Math.max(3,board.snake.length-5));
  board.events.push('power-'+type);
}
function nextStep(board){
  if(!board.alive)return;
  if(board.pending.length) board.dir=board.pending.shift();
  const d=DIRECTIONS[board.dir],head=board.snake[0];
  let h={x:head.x+d.x,y:head.y+d.y};
  if(board.map==='neon') {
    if(equal(h,{x:1,y:2})) h={x:12,y:11};
    else if(equal(h,{x:12,y:11})) h={x:1,y:2};
  }
  if(h.x<0||h.y<0||h.x>=SIZE||h.y>=SIZE){collide(board,'Wall');return;}
  if(MAPS[board.map].some(p=>p[0]===h.x&&p[1]===h.y)){collide(board,'Obstacle');return;}
  const apple=board.apples.find(a=>equal(a,h));
  const tail=apple?board.snake:board.snake.slice(0,-1);
  if(tail.some(p=>equal(p,h))){collide(board,'Tail');return;}
  board.snake.unshift(h);
  if(apple){
    board.apples.splice(board.apples.indexOf(apple),1);
    board.score+=apple.type==='gold'?5:1;board.eaten++;
    board.events.push(apple.type==='gold'?'gold':'eat');
    if(!spawnApple(board)){board.alive=false;board.deathReason='Board filled';board.events.push('win-full');}
  } else board.snake.pop();
  if(board.power&&equal(board.power,h)) { const t=board.power.type;board.power=null;applyPower(board,t); }
}
function advanceBoard(board,dtMs){
  if(!board.alive)return;
  board.elapsed+=dtMs;
  board.accum=Math.min(900,board.accum+dtMs);
  if(board.power && board.elapsed>=board.power.expires)board.power=null;
  if(board.elapsed>=board.powerAt){
    board.powerAt+=6800+Math.floor(board.rng()*4500);
    if(!board.power){
      const free=freeCells(board);
      if(free.length){const p=free[Math.floor(board.rng()*free.length)];
        board.power={...p,type:['freeze','shield','shrink'][Math.floor(board.rng()*3)],expires:board.elapsed+9500};
      }
    }
  }
  let steps=0;
  while(board.alive && board.accum>=speedMs(board) && steps++<7){const step=speedMs(board);board.accum-=step;nextStep(board);}
  if(steps>=7) board.accum=Math.min(board.accum,speedMs(board));
}
function boardState(b) {
  return {map:b.map,snake:b.snake,dir:b.dir,apples:b.apples,power:b.power&&{x:b.power.x,y:b.power.y,type:b.power.type},
    score:b.score,eaten:b.eaten,alive:b.alive,shield:b.shield,freezeRemaining:Math.max(0,Math.ceil((b.freezeUntil-b.elapsed)/1000)),
    speed:Math.round(speedMs(b)),progress:Math.max(0,Math.min(1,b.accum/speedMs(b))),deathReason:b.deathReason};
}
module.exports={SIZE,ROUND_MS,MAPS,SKINS,DIRECTIONS,makeBoard,queueTurn,advanceBoard,boardState,speedMs};
