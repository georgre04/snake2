'use strict';
(() => {
  const $=id=>document.getElementById(id);
  const bridge=window.Snake2Bridge;
  if(!bridge){console.error('Snake 2 game bridge was not loaded.');return;}
  const boardSize=14,cell=40;
  const STORAGE='snake2-online-connection-v1';
  const nameStorage='snake2-online-playername-v1';
  let ws=null,pending=null,shouldReconnect=false,retryTimer=null,attempt=0;
  let code='',seat=-1,token='',room=null,frameState=null,previousBoards=null,stateArrivedAt=0;
  let oldServerRound=0,toastTimeout=null,lastDirection='',lastDirectionAt=0;
  const contexts=[$('mpLocalCanvas').getContext('2d'),$('mpRivalCanvas').getContext('2d')];
  const cachedBg=new Map();
  function toast(s){const el=$('mpToast');el.textContent=s;el.classList.remove('hidden');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.add('hidden'),4000);}
  function persistSession(){try{sessionStorage.setItem(STORAGE,JSON.stringify({code,token}));}catch(_){}}
  function clearSession(){try{sessionStorage.removeItem(STORAGE);}catch(_){}code='';token='';seat=-1;room=null;frameState=null;previousBoards=null;}
  function getSession(){try{const r=JSON.parse(sessionStorage.getItem(STORAGE)||'null');return r&&typeof r.code==='string'&&typeof r.token==='string'?r:null;}catch(_){return null;}}
  function selectedName(){const name=$('mpName').value.trim().slice(0,16)||'Player';try{localStorage.setItem(nameStorage,name);}catch(_){}return name;}
  function selectedSkin(){return bridge.getSkin().id;}
  function sockUrl(){return (location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws';}
  function transmit(m){if(ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify(m));return true;}return false;}
  function request(m){pending=m;shouldReconnect=true;if(ws?.readyState===WebSocket.OPEN){transmit(pending);pending=null;}else connect();}
  function connect(){
    if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;
    clearTimeout(retryTimer);
    try{ws=new WebSocket(sockUrl());}catch(err){toast('Could not connect to the online server.');return;}
    const socket=ws;
    $('mpLobbyInfo').textContent='Connecting to the online server…';
    socket.addEventListener('open',()=>{
      if(ws!==socket)return;
      attempt=0;
      if(pending){transmit(pending);pending=null;}
      else {const saved=getSession();if(saved)transmit({type:'join',code:saved.code,token:saved.token,name:selectedName(),skin:selectedSkin()});}
    });
    socket.addEventListener('message',event=>{if(ws!==socket)return;try{onMessage(JSON.parse(event.data));}catch(e){console.error('Invalid server response',e);}});
    socket.addEventListener('close',()=>{
      if(ws!==socket)return;ws=null;
      if(shouldReconnect&&getSession()){
        toast('Connection lost. Trying to reconnect…');
        retryTimer=setTimeout(connect,Math.min(5000,700+attempt++*500));
      }else if(shouldReconnect){toast('Could not connect. Try again.');}
    });
    socket.addEventListener('error',()=>{if(ws===socket)toast('Network connection failed.');});
  }
  function open(){
    bridge.setView('multi');
    $('mpMap').value=bridge.getMap().id;
    const stored=getSession();
    if(stored){code=stored.code;token=stored.token;shouldReconnect=true;$('mpLanding').classList.add('hidden');$('mpLobby').classList.remove('hidden');$('mpLobbyInfo').textContent='Rejoining your room…';connect();}
    else landing();
  }
  function landing(){
    $('mpLanding').classList.remove('hidden');$('mpLobby').classList.add('hidden');$('mpArenaPanel').classList.add('hidden');
    $('mpLobbyTitle').textContent='YOUR PRIVATE ROOM';
  }
  function leave(){
    shouldReconnect=false;clearTimeout(retryTimer);pending=null;
    transmit({type:'leave'});
    const old=ws;ws=null;if(old)old.close();
    clearSession();landing();
  }
  function onMessage(msg){
    if(!msg||typeof msg.type!=='string')return;
    switch(msg.type){
      case 'joined':
        code=msg.code;seat=msg.seat;token=msg.token;persistSession();
        $('mpCodeInput').value=code;
        $('mpLanding').classList.add('hidden');$('mpLobby').classList.remove('hidden');
        $('mpLobbyInfo').textContent='Share this code with your friend!';
        toast('Joined room '+code);break;
      case 'room': updateRoom(msg);break;
      case 'state':
        previousBoards=frameState?.boards||null;
        frameState=msg;stateArrivedAt=performance.now();
        if(msg.round!==oldServerRound){previousBoards=null;oldServerRound=msg.round;}
        updateBoardText();break;
      case 'round-result':
        let result=msg.winner===null?'🤝 TIE ROUND — REPLAY!':msg.winner===seat?'🏆 YOU WIN THE ROUND!':'💥 OPPONENT WINS THIS ROUND';
        if(msg.forfeit)result='Opponent disconnected — match forfeited';
        $('mpBanner').textContent=msg.matchOver ? (msg.winner===seat?'🏆 YOU WIN THE MATCH!':'🏁 MATCH FINISHED') : result;
        if(navigator.vibrate)navigator.vibrate(msg.winner===seat?[70,30,70]:[100]);
        break;
      case 'error':
        toast(msg.message||msg.code||'An error occurred.');
        if(['NOT_FOUND','ROOM_FULL','MATCH_STARTED'].includes(msg.code)){
          if(getSession()){clearSession();landing();}
          shouldReconnect=false;
        }
        break;
    }
  }
  function updateRoom(r){
    room=r;code=r.code;
    $('mpRoomCode').textContent=code;
    const p=r.players||[];
    for(let i=0;i<2;i++){
      $(i===0?'mpP0':'mpP1').textContent=p[i]?.name||(i===1?'Waiting for friend…':'Empty');
      $(i===0?'mpR0':'mpR1').textContent=p[i]?(!p[i].connected?'Disconnected':p[i].rematch?'Wants rematch':p[i].ready?'READY ✓':'Not ready'):'—';
    }
    const own=p[seat];
    $('mpReady').disabled=!p[0]?.connected||!p[1]?.connected;
    $('mpReady').textContent=own?.ready?'✓ READY — TAP TO CANCEL':'✓ I’M READY';
    const play=r.phase==='playing'||r.phase==='countdown'||r.phase==='round-end';
    const finished=r.phase==='match-end';
    const interrupted=r.phase==='interrupted';
    $('mpLanding').classList.add('hidden');
    $('mpLobby').classList.toggle('hidden',play);
    $('mpArenaPanel').classList.toggle('hidden',!play);
    $('mpReady').classList.toggle('hidden',r.phase!=='lobby');
    $('mpRematch').classList.toggle('hidden',!finished);
    $('mpRematch').textContent=own?.rematch?'✓ WAITING FOR FRIEND…':'↻ PLAY AGAIN (REMATCH)';
    $('mpRematch').disabled=!!own?.rematch||!p[0]?.connected||!p[1]?.connected;
    if(finished){
      $('mpLobbyTitle').textContent=r.wins[seat]>=3?'🏆 YOU WON!':'🎮 MATCH COMPLETE';
      $('mpLobbyInfo').textContent=`Best of 5: ${p[0]?.name||'P1'} ${r.wins[0]} – ${r.wins[1]} ${p[1]?.name||'P2'}. Both players can request a rematch.`;
    }else if(interrupted){
      $('mpLobbyTitle').textContent='⚡ CONNECTION PAUSED';
      $('mpLobbyInfo').textContent='Waiting for the disconnected player to reconnect. The match will be forfeited after 30 seconds.';
    }else if(r.phase==='lobby'){
      $('mpLobbyTitle').textContent='⚔️ ONLINE 1v1 LOBBY';
      $('mpLobbyInfo').textContent=p[0]?.connected&&p[1]?.connected?'Both players connected. Press READY to begin!':`Share room code ${code}. Waiting for your friend…`;
    }
    if(play){
      $('mpRound').textContent=r.round+' / 5';
      $('mpSetScore').textContent=r.wins[0]+' — '+r.wins[1];
      $('mpMyName').textContent=(p[seat]?.name||'YOU')+' (YOU)';
      $('mpTheirName').textContent=p[1-seat]?.name||'OPPONENT';
      $('mpBanner').textContent=r.phase==='countdown'?'⚡ GET READY… '+Math.max(1,Math.ceil(r.nextInMs/1000)):
        r.phase==='playing'?'🍎 EAT APPLES · HIGHEST SCORE WINS':
        r.result?.winner===null?'🤝 TIE! REPLAYING ROUND…':r.result?.winner===seat?'🏆 YOU WON THIS ROUND!':'💥 OPPONENT WON THE ROUND';
      updateBoardText();
    }
  }
  function updateBoardText(){
    if(!frameState?.boards||seat<0)return;
    const own=frameState.boards[seat],other=frameState.boards[1-seat];
    $('mpMyScore').textContent=own.score;
    $('mpTheirScore').textContent=other.score;
    const info=b=>b.alive ? ((b.shield?'🛡️ SHIELD · ':'')+(b.freezeRemaining?'❄️ SLOWED '+b.freezeRemaining+'s · ':'')+'🚀 '+(194/b.speed).toFixed(1)+'× speed') : '💀 CRASHED · '+b.deathReason;
    $('mpMyStatus').textContent=info(own);
    $('mpTheirStatus').textContent=info(other);
  }
  function bg(map){
    if(cachedBg.has(map))return cachedBg.get(map);
    const m=bridge.maps.find(x=>x.id===map)||bridge.maps[0];
    const c=document.createElement('canvas');c.width=560;c.height=560;const g=c.getContext('2d');
    for(let y=0;y<boardSize;y++)for(let x=0;x<boardSize;x++){
      g.fillStyle=(x+y)%2?m.a:m.b;g.fillRect(x*cell,y*cell,cell,cell);
      if(map==='neon'){g.strokeStyle='#786dce24';g.lineWidth=1;g.strokeRect(x*cell+1,y*cell+1,cell-2,cell-2);}
    }
    g.lineWidth=8;g.strokeStyle=m.edge;g.strokeRect(4,4,552,552);
    for(const [x,y] of m.rocks){
      const px=x*cell,py=y*cell;
      g.fillStyle=map==='volcano'?'#f76b38':map==='ice'?'#9bebff':map==='neon'?'#cf71fa':'#6c8a6d';
      g.beginPath();g.roundRect(px+6,py+6,28,28,7);g.fill();
      g.fillStyle='#ffffff50';g.fillRect(px+12,py+10,13,4);
    }
    if(map==='neon')for(const p of [{x:1,y:2},{x:12,y:11}]){
      g.strokeStyle='#5ff2ff';g.lineWidth=4;g.beginPath();g.arc((p.x+.5)*cell,(p.y+.5)*cell,15,0,Math.PI*2);g.stroke();
    }
    cachedBg.set(map,c);return c;
  }
  function paintRoundRect(g,x,y,w,h,r,color){g.fillStyle=color;g.beginPath();g.roundRect(x,y,w,h,r);g.fill();}
  function drawBoard(g,board,prev,skin,t){
    g.drawImage(bg(board.map),0,0,560,560);
    const pulse=1+.035*Math.sin(t/190);
    for(const apple of board.apples){
      const x=(apple.x+.5)*cell,y=(apple.y+.5)*cell,size=(apple.type==='gold'?62:59)*pulse;
      const sprite=bridge.appleSprite();
      if(sprite){g.save();if(apple.type==='gold'){g.shadowColor='#ffe15d';g.shadowBlur=20;}
        g.drawImage(sprite,x-size/2,y-size/2,size,size);g.restore();}
      else{g.fillStyle=apple.type==='gold'?'#ffe25d':'#f6484e';g.beginPath();g.arc(x,y,17,0,Math.PI*2);g.fill();}
      if(apple.type==='gold'){g.font='bold 21px system-ui';g.textAlign='center';g.fillText('★',x+21,y-20);}
    }
    if(board.power){const p=board.power,x=(p.x+.5)*cell,y=(p.y+.5)*cell;
      g.fillStyle=p.type==='shield'?'#61ff9670':p.type==='freeze'?'#49cfff70':'#bd76ff80';
      g.beginPath();g.arc(x,y,19,0,Math.PI*2);g.fill();
      g.textAlign='center';g.textBaseline='middle';g.font='28px system-ui';
      g.fillText(p.type==='shield'?'🛡️':p.type==='freeze'?'❄️':'✂️',x,y);
    }
    const s=bridge.skins.find(x=>x.id===skin)||bridge.skins[0];
    const a=Math.max(0,Math.min(1,(t-stateArrivedAt)/108));
    for(let i=board.snake.length-1;i>=0;i--){
      const p=board.snake[i],old=prev?.snake?.[i]||p;
      const valid=Math.abs(p.x-old.x)<=1&&Math.abs(p.y-old.y)<=1;
      const x=(valid?old.x+(p.x-old.x)*a:p.x)*cell,y=(valid?old.y+(p.y-old.y)*a:p.y)*cell;
      paintRoundRect(g,x+2,y+2,36,36,10,i===0?s.head:i%2?s.body:s.body2);
      g.strokeStyle='#ffffff55';g.lineWidth=2;g.beginPath();g.roundRect(x+4,y+4,32,32,8);g.stroke();
      if(i===0){const d=board.dir==='right'?[1,0]:board.dir==='left'?[-1,0]:board.dir==='up'?[0,-1]:[0,1];
        g.fillStyle='#0e2335';
        for(const v of [-8,8]){g.beginPath();g.arc(x+20+d[0]*8+(d[1]!==0?v:0),y+20+d[1]*8+(d[0]!==0?v:0),4,0,Math.PI*2);g.fill();}
      }
    }
    if(board.shield&&board.snake.length){const h=board.snake[0];g.strokeStyle='#a9fff8';g.lineWidth=3;g.beginPath();g.arc((h.x+.5)*cell,(h.y+.5)*cell,23,0,Math.PI*2);g.stroke();}
    if(!board.alive){g.fillStyle='#07091870';g.fillRect(0,0,560,560);g.fillStyle='#ffe89a';g.font='bold 43px system-ui';g.textAlign='center';g.fillText('CRASHED',280,280);}
  }
  function animation(now){
    requestAnimationFrame(animation);
    if($('multiView').classList.contains('hidden')||!frameState?.boards||seat<0)return;
    const players=room?.players||[];
    const s0=players[seat]?.skin||'green',s1=players[1-seat]?.skin||'green';
    drawBoard(contexts[0],frameState.boards[seat],previousBoards?.[seat],s0,now);
    drawBoard(contexts[1],frameState.boards[1-seat],previousBoards?.[1-seat],s1,now);
    if(room?.phase==='playing'){
      const rem=Math.max(0,frameState.remainingMs-(now-stateArrivedAt));
      $('mpTimer').textContent=Math.floor(rem/60000)+':'+String(Math.ceil(rem/1000)%60).padStart(2,'0');
    }else if(room?.phase==='countdown'){
      const rem=Math.max(0,room.nextInMs-(now-stateArrivedAt));
      $('mpBanner').textContent='⚡ ROUND STARTS IN '+Math.max(1,Math.ceil(rem/1000));
      $('mpTimer').textContent='1:00';
    }else if(room?.phase==='round-end')$('mpTimer').textContent='0:00';
  }
  function turn(dir){
    if(room?.phase!=='playing')return;
    const now=performance.now();if(lastDirection===dir&&now-lastDirectionAt<70)return;
    lastDirection=dir;lastDirectionAt=now;
    transmit({type:'turn',direction:dir});
  }
  function keydown(event){
    if($('multiView').classList.contains('hidden')||room?.phase!=='playing')return;
    if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
    const d={ArrowUp:'up',ArrowRight:'right',ArrowDown:'down',ArrowLeft:'left',w:'up',d:'right',s:'down',a:'left',W:'up',D:'right',S:'down',A:'left'}[event.key];
    if(d){event.preventDefault();turn(d);}
  }
  async function copyInvite(){
    const link=location.origin+'/?room='+encodeURIComponent(code);
    try{await navigator.clipboard.writeText(link);toast('Invite copied! Send it to your friend.');}
    catch(_){try{await navigator.clipboard.writeText(code);toast('Room code copied: '+code);}catch(_){toast('Share room code '+code+' with your friend.');}}
  }
  function setup(){
    try{$('mpName').value=localStorage.getItem(nameStorage)||'Player';}catch(_){}
    $('mpMap').innerHTML=bridge.maps.map(x=>`<option value="${x.id}">${x.ico} ${x.name}</option>`).join('');
    $('mpMap').value=bridge.getMap().id;
    try{const roomCode=new URLSearchParams(location.search).get('room');if(roomCode)$('mpCodeInput').value=roomCode.toUpperCase().slice(0,6);}catch(_){}
    const setMascot=()=>{const sprite=bridge.appleSprite();if(sprite){const clone=document.createElement('canvas');clone.width=sprite.width;clone.height=sprite.height;clone.getContext('2d').drawImage(sprite,0,0);$('mpMascot').replaceChildren(clone);}};
    setMascot();bridge.appleImage.addEventListener('load',setMascot,{once:true});
    $('multiOpen').addEventListener('click',open);
    $('mpHome').addEventListener('click',()=>{if(room||token)leave();bridge.setView('menu');});
    $('mpCreate').addEventListener('click',()=>request({type:'create',name:selectedName(),skin:selectedSkin(),map:$('mpMap').value}));
    $('mpJoin').addEventListener('click',()=>{
      const c=$('mpCodeInput').value.toUpperCase().replace(/[^A-Z2-9]/g,'').slice(0,6);
      if(c.length!==6){toast('Enter a 6-character room code.');return;}
      request({type:'join',code:c,name:selectedName(),skin:selectedSkin()});
    });
    $('mpCodeInput').addEventListener('keydown',e=>{if(e.key==='Enter'){$('mpJoin').click();}});
    $('mpCopy').addEventListener('click',copyInvite);
    $('mpReady').addEventListener('click',()=>{if(room){const ready=!room.players[seat]?.ready;transmit({type:'ready',ready});}});
    $('mpRematch').addEventListener('click',()=>transmit({type:'rematch'}));
    $('mpLeave').addEventListener('click',leave);
    $('mpQuitMatch').addEventListener('click',leave);
    $('mpBackLobby').addEventListener('click',copyInvite);
    window.addEventListener('keydown',keydown);
    document.querySelectorAll('[data-mp-dir]').forEach(b=>b.addEventListener('pointerdown',e=>{e.preventDefault();turn(b.dataset.mpDir);}));
    const canvas=$('mpLocalCanvas');let sx=0,sy=0;
    canvas.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
    canvas.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
      if(Math.max(Math.abs(dx),Math.abs(dy))>16)turn(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));
      e.preventDefault();},{passive:false});
    requestAnimationFrame(animation);
    // Opening a shared invite remains explicit; never auto-join a stranger's room.
  }
  setup();
})();
