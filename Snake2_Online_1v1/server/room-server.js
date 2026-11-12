'use strict';
const {randomBytes,randomInt}=require('node:crypto');
const {MAPS,SKINS,ROUND_MS,makeBoard,queueTurn,advanceBoard,boardState}=require('./game-engine');
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DISCONNECT_GRACE_MS=30000;
const MAX_ROOMS=120;
function roomCode(){return Array.from({length:6},()=>CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');}
const cleanName=(n)=>typeof n==='string' ? n.replace(/[\x00-\x1f\x7f<>]/g,'').trim().slice(0,16)||'Player' : 'Player';
const safeSkin=(s)=>SKINS.includes(s)?s:'green';
class RoomServer {
  constructor({now=()=>Date.now()}={}) {this.now=now;this.rooms=new Map();this.clients=new Set();}
  attach(peer){
    if(this.clients.size>=260){peer.send({type:'error',code:'BUSY',message:'Server is full.'});peer.close(1008);return;}
    this.clients.add(peer);peer.lastTurnAt=0;peer.commands=[];peer.on('message',msg=>this.onMessage(peer,msg));
    peer.on('close',()=>this.onDisconnect(peer));
    peer.send({type:'hello',serverTime:this.now(),roundMs:ROUND_MS});
  }
  error(peer,code,message){peer.send({type:'error',code,message});}
  onMessage(peer,m){
    const now=this.now();peer.commands=peer.commands.filter(t=>now-t<1000);peer.commands.push(now);
    if(peer.commands.length>45){this.error(peer,'RATE_LIMIT','Too many requests.');return;}
    if(typeof m.type!=='string')return this.error(peer,'BAD_REQUEST','Missing message type.');
    switch(m.type){
      case 'create': return this.create(peer,m);
      case 'join': return this.join(peer,m);
      case 'ready': return this.ready(peer,m);
      case 'turn': return this.turn(peer,m);
      case 'rematch': return this.rematch(peer);
      case 'leave': return this.leave(peer);
      case 'ping': return peer.send({type:'pong',serverTime:now});
      default: return this.error(peer,'BAD_REQUEST','Unsupported command.');
    }
  }
  create(peer,m){
    if(peer.room)return this.error(peer,'ALREADY_JOINED','Leave your current room first.');
    if(this.rooms.size>=MAX_ROOMS)return this.error(peer,'BUSY','Too many active rooms.');
    let code;do{code=roomCode()}while(this.rooms.has(code));
    const player={name:cleanName(m.name),skin:safeSkin(m.skin),token:randomBytes(24).toString('hex'),peer,ready:false,rematch:false,disconnectAt:0};
    const room={code,map:MAPS[m.map]?m.map:'garden',players:[player,null],wins:[0,0],boards:null,
      phase:'lobby',round:0,gameElapsed:0,roundEnd:null,nextAt:0,lastTick:this.now(),lastBroadcast:0,
      interruptedPhase:'',pauseAt:0,lastActivity:this.now(),createdAt:this.now()};
    this.rooms.set(code,room);peer.room=room;peer.seat=0;
    peer.send({type:'joined',code,seat:0,token:player.token});this.broadcastRoom(room);
  }
  join(peer,m){
    if(peer.room)return this.error(peer,'ALREADY_JOINED','Leave your current room first.');
    const code=String(m.code||'').toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6),room=this.rooms.get(code);
    if(!room)return this.error(peer,'NOT_FOUND','Room not found. Check the code.');
    let seat=-1;
    if(typeof m.token==='string')seat=room.players.findIndex(p=>p&&p.token===m.token);
    if(seat<0){
      seat=room.players.findIndex(p=>!p);
      if(seat<0)return this.error(peer,'ROOM_FULL','This room already has two players.');
      if(room.phase!=='lobby')return this.error(peer,'MATCH_STARTED','This match has started; only the original players can reconnect.');
      room.players[seat]={name:cleanName(m.name),skin:safeSkin(m.skin),token:randomBytes(24).toString('hex'),peer,ready:false,rematch:false,disconnectAt:0};
    } else {
      const player=room.players[seat];if(player.peer&&player.peer!==peer){const old=player.peer;player.peer=null;old.close(1000);}
      player.peer=peer;player.disconnectAt=0;
    }
    peer.room=room;peer.seat=seat;room.lastActivity=this.now();
    peer.send({type:'joined',code,seat,token:room.players[seat].token});
    if(room.phase==='interrupted'&&room.players.every(p=>p&&p.peer)){
      const now=this.now(),delay=now-room.pauseAt;
      room.phase=room.interruptedPhase;room.nextAt+=delay;room.lastTick=now;room.interruptedPhase='';
    }
    this.broadcastRoom(room);
    if(room.boards)peer.send(this.snapshot(room));
  }
  ready(peer,m){
    const r=peer.room;if(!r||r.phase!=='lobby')return this.error(peer,'BAD_PHASE','You can only ready up in the lobby.');
    const p=r.players[peer.seat];if(!p)return;
    p.ready=!!m.ready;r.lastActivity=this.now();
    if(r.players.every(x=>x&&x.ready&&x.peer))this.startRound(r);
    else this.broadcastRoom(r);
  }
  startRound(room){
    const seed=randomInt(1,0x7fffffff);
    room.round=room.wins[0]+room.wins[1]+1;
    room.boards=[makeBoard(seed,room.map),makeBoard(seed,room.map)];
    room.gameElapsed=0;room.roundEnd=null;room.phase='countdown';
    room.nextAt=this.now()+3000;room.lastTick=this.now();room.lastBroadcast=0;
    room.players.forEach(p=>{if(p){p.ready=false;p.rematch=false;}});
    this.broadcastRoom(room);
    this.broadcastSnapshot(room);
  }
  turn(peer,m){
    const r=peer.room;if(!r||r.phase!=='playing'||!r.players[peer.seat]?.peer)return;
    const now=this.now();if(now-peer.lastTurnAt<22)return;
    peer.lastTurnAt=now;
    queueTurn(r.boards[peer.seat],m.direction);
  }
  rematch(peer){
    const r=peer.room;if(!r||r.phase!=='match-end')return this.error(peer,'BAD_PHASE','Rematch is only available after the match.');
    r.players[peer.seat].rematch=true;
    if(r.players.every(p=>p&&p.rematch&&p.peer)){
      r.wins=[0,0];this.startRound(r);
    } else this.broadcastRoom(r);
  }
  leave(peer){
    if(!peer.room)return;
    const r=peer.room,seat=peer.seat;
    peer.room=null;peer.seat=undefined;
    const p=r.players[seat];if(p&&p.peer===peer)r.players[seat]=null;
    if(!r.players.some(Boolean)){this.rooms.delete(r.code);return;}
    // After an intentional departure, reset the lobby so a new friend can join.
    r.phase='lobby';r.boards=null;r.wins=[0,0];r.round=0;
    r.players.forEach(x=>{if(x){x.ready=false;x.rematch=false;}});
    this.broadcastRoom(r);
  }
  onDisconnect(peer){
    this.clients.delete(peer);
    const room=peer.room;if(!room)return;
    const p=room.players[peer.seat];
    if(!p||p.peer!==peer)return;
    p.peer=null;p.disconnectAt=this.now();room.lastActivity=this.now();
    if(['countdown','playing','round-end'].includes(room.phase)){
      room.interruptedPhase=room.phase;room.phase='interrupted';room.pauseAt=this.now();
    }
    this.broadcastRoom(room);
  }
  result(room){
    const b0=room.boards[0],b1=room.boards[1];
    const winner=b0.score===b1.score?null:b0.score>b1.score?0:1;
    if(winner!==null)room.wins[winner]++;
    const matchOver=room.wins.some(w=>w>=3);
    room.roundEnd={round:room.round,winner,score:[b0.score,b1.score],wins:[...room.wins],matchOver};
    room.phase=matchOver?'match-end':'round-end';room.nextAt=this.now()+4600;
    room.players.forEach(p=>{if(p)p.rematch=false;});
    this.broadcast(room,{type:'round-result',...room.roundEnd});
    this.broadcastRoom(room);
  }
  snapshot(room){
    return {type:'state',code:room.code,phase:room.phase,round:room.round,remainingMs:Math.max(0,ROUND_MS-room.gameElapsed),
      serverTime:this.now(),boards:room.boards?.map(boardState)||null};
  }
  broadcastSnapshot(room){this.broadcast(room,this.snapshot(room));room.lastBroadcast=this.now();}
  meta(room){
    return {type:'room',code:room.code,map:room.map,phase:room.phase,round:room.round,
      wins:[...room.wins],remainingMs:Math.max(0,ROUND_MS-room.gameElapsed),
      nextInMs:Math.max(0,room.nextAt-this.now()),roundMs:ROUND_MS,
      players:room.players.map(p=>p?{name:p.name,skin:p.skin,connected:!!p.peer,ready:p.ready,rematch:p.rematch}:null),
      result:room.roundEnd};
  }
  broadcastRoom(room){this.broadcast(room,this.meta(room));}
  broadcast(room,msg){for(const p of room.players){if(p?.peer)p.peer.send(msg);}}
  tick(){
    const now=this.now();
    for(const room of this.rooms.values()){
      if(room.players.every(p=>!p||!p.peer) && now-room.lastActivity>600000){this.rooms.delete(room.code);continue;}
      if(room.phase==='lobby'){
        for(let i=0;i<2;i++){const p=room.players[i];if(p&&!p.peer&&now-p.disconnectAt>DISCONNECT_GRACE_MS){room.players[i]=null;this.broadcastRoom(room);}}
      }
      if(room.phase==='interrupted'){
        if(now-room.pauseAt>DISCONNECT_GRACE_MS){
          const connected=room.players.findIndex(p=>p&&p.peer);
          if(connected>=0){room.wins[connected]=3;
            room.roundEnd={round:room.round,winner:connected,score:room.boards?.map(x=>x.score)||[0,0],wins:[...room.wins],matchOver:true,forfeit:true};
            room.phase='match-end';this.broadcast(room,{type:'round-result',...room.roundEnd});
            this.broadcastRoom(room);
          }else{room.phase='lobby';room.boards=null;room.wins=[0,0];}
        }
        continue;
      }
      if(room.phase==='countdown'){
        if(now>=room.nextAt){room.phase='playing';room.lastTick=now;this.broadcastRoom(room);}
        continue;
      }
      if(room.phase==='round-end'){
        if(now>=room.nextAt) {if(room.players.every(p=>p&&p.peer))this.startRound(room);}
        continue;
      }
      if(room.phase!=='playing')continue;
      const dt=Math.max(0,Math.min(120,now-room.lastTick));
      room.lastTick=now;room.gameElapsed+=dt;
      room.boards.forEach(b=>advanceBoard(b,dt));
      if(room.gameElapsed>=ROUND_MS||room.boards.every(b=>!b.alive)){this.broadcastSnapshot(room);this.result(room);continue;}
      if(now-room.lastBroadcast>=50)this.broadcastSnapshot(room);
    }
  }
  heartbeat(){
    for(const peer of this.clients){if(!peer.isAlive){peer.close(1001);continue;}peer.ping();}
  }
}
module.exports={RoomServer};
