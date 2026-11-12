'use strict';
// Small RFC 6455 WebSocket implementation for the game's JSON-only protocol.
// Zero npm dependencies, server-side mask/size checks, control frames and ping/pong.
const {EventEmitter}=require('node:events');
const {createHash}=require('node:crypto');
const GUID='258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME=16*1024, MAX_PENDING=80*1024;
class Peer extends EventEmitter {
  constructor(socket,head){super();this.socket=socket;this.buf=Buffer.alloc(0);this.closed=false;
    this.fragment=null;this.isAlive=true;
    socket.on('data',chunk=>this.receive(chunk));socket.on('error',()=>this.destroy());
    socket.on('end',()=>this.destroy());socket.on('close',()=>this.destroy());
    if(head&&head.length)process.nextTick(()=>this.receive(head));
  }
  send(data){ if(this.closed)return;const json=JSON.stringify(data);this.frame(1,Buffer.from(json));}
  frame(opcode,payload=Buffer.alloc(0)){
    if(this.closed||this.socket.destroyed)return;
    if(this.socket.writableLength>MAX_PENDING){this.close(1008);return;}
    const n=payload.length;
    let header;if(n<126){header=Buffer.from([0x80|opcode,n]);}
    else if(n<65536){header=Buffer.alloc(4);header[0]=0x80|opcode;header[1]=126;header.writeUInt16BE(n,2);}
    else{header=Buffer.alloc(10);header[0]=0x80|opcode;header[1]=127;header.writeBigUInt64BE(BigInt(n),2);}
    this.socket.write(Buffer.concat([header,payload]));
  }
  ping(){this.isAlive=false;this.frame(9);}
  close(code=1000){if(this.closed)return;this.frame(8,Buffer.from([code>>8,code&255]));this.closed=true;this.socket.end();this.emit('close');}
  destroy(){if(this.closed)return;this.closed=true;this.socket.destroy();this.emit('close');}
  receive(chunk){
    if(this.closed)return;
    if(this.buf.length+chunk.length>MAX_FRAME*3){this.close(1009);return;}
    this.buf=Buffer.concat([this.buf,chunk]);
    while(!this.closed&&this.buf.length>=2){
      const one=this.buf[0],two=this.buf[1],fin=!!(one&128),opcode=one&15,masked=!!(two&128);
      let len=two&127,off=2;
      if((one&0x70)!==0||!masked){this.close(1002);return;}
      if(len===126){if(this.buf.length<4)return;len=this.buf.readUInt16BE(2);off=4;}
      else if(len===127){if(this.buf.length<10)return;const big=this.buf.readBigUInt64BE(2);if(big>BigInt(MAX_FRAME)){this.close(1009);return;}len=Number(big);off=10;}
      if(len>MAX_FRAME){this.close(1009);return;}
      if(this.buf.length<off+4+len)return;
      const mask=this.buf.subarray(off,off+4);off+=4;
      const payload=Buffer.from(this.buf.subarray(off,off+len));
      this.buf=this.buf.subarray(off+len);
      for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      if(opcode>=8){
        if(!fin||len>125){this.close(1002);return;}
        if(opcode===8){this.close();return;}
        if(opcode===9){this.frame(10,payload);continue;}
        if(opcode===10){this.isAlive=true;continue;}
        this.close(1002);return;
      }
      if(opcode===1){
        if(this.fragment){this.close(1002);return;}
        if(fin){this.text(payload);continue;}
        this.fragment=payload;
      } else if(opcode===0){
        if(!this.fragment){this.close(1002);return;}
        this.fragment=Buffer.concat([this.fragment,payload]);
        if(this.fragment.length>MAX_FRAME){this.close(1009);return;}
        if(fin){this.text(this.fragment);this.fragment=null;}
      } else {this.close(1003);return;}
    }
  }
  text(buf){
    try {const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf));
      if(!data||typeof data!=='object'||Array.isArray(data))throw Error('not object');
      this.emit('message',data);
    } catch(e){this.send({type:'error',code:'BAD_MESSAGE',message:'Invalid JSON message.'});}
  }
}
function upgrade(req,socket,head){
  const key=req.headers['sec-websocket-key'],ver=req.headers['sec-websocket-version'];
  if(req.method!=='GET'||req.headers.upgrade?.toLowerCase()!=='websocket'||ver!=='13'||typeof key!=='string'||
    !/^[A-Za-z0-9+/]{22}==$/.test(key)) {socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');socket.destroy();return null;}
  const origin=req.headers.origin;
  if(origin){try{const u=new URL(origin);if(u.host!==req.headers.host){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return null;}}catch{socket.destroy();return null;}}
  const accept=createHash('sha1').update(key+GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  socket.setNoDelay(true);
  return new Peer(socket,head);
}
module.exports={upgrade,Peer};
