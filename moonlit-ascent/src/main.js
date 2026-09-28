const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Moonlit Ascent 3D game');
document.getElementById('app').appendChild(canvas);

const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' }) ||
  canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
if (!gl) {
  document.body.innerHTML = '<div style="padding:2rem;color:white;background:#06102d;font-family:system-ui">WebGL is not available in this browser.</div>';
  throw new Error('WebGL unavailable');
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (current, target, speed, dt) => lerp(current, target, 1 - Math.exp(-speed * dt));
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);

const state = {
  mode: 'start',
  score: 0,
  best: Number(localStorage.getItem('moonlit-best') || 0),
  distance: 0,
  combo: 1,
  maxCombo: 1,
  speed: 7.2,
  elapsed: 0,
  active: false,
  music: true,
  beats: 0
};

const CFG = {
  lane: 2.35,
  platformW: 2.15,
  platformD: 3.0,
  gravity: 22.5,
  jump: 10.4,
  render: 180,
  playerZ: 7.4,
  maxSpeed: 13.2
};

// -----------------------------------------------------------------------------
// WebGL setup
// -----------------------------------------------------------------------------
const VERT = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
out vec3 vN;
out vec3 vW;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vW = w.xyz;
  vN = mat3(uModel) * aNormal;
  gl_Position = uMVP * vec4(aPos,1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vN;
in vec3 vW;
uniform vec3 uCam;
uniform float uFog;
uniform vec3 uLightDir;
uniform vec3 uColor;
uniform vec3 uEmissive;
uniform float uEm;
out vec4 outColor;
void main(){
  vec3 N = normalize(vN);
  float ndl = max(dot(N, normalize(uLightDir)), 0.0);
  vec3 lit = uColor * (0.12 + 0.78 * ndl) + uEmissive * uEm;
  float d = distance(vW, uCam);
  float fog = exp(-d * uFog);
  vec3 fogCol = vec3(0.018,0.06,0.18);
  vec3 c = mix(fogCol, lit, fog);
  outColor = vec4(c, 1.0);
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);

const aPos = gl.getAttribLocation(program, 'aPos');
const aNormal = gl.getAttribLocation(program, 'aNormal');
const u = {
  MVP: gl.getUniformLocation(program, 'uMVP'),
  Model: gl.getUniformLocation(program, 'uModel'),
  Cam: gl.getUniformLocation(program, 'uCam'),
  Fog: gl.getUniformLocation(program, 'uFog'),
  Light: gl.getUniformLocation(program, 'uLightDir'),
  Color: gl.getUniformLocation(program, 'uColor'),
  Emi: gl.getUniformLocation(program, 'uEmissive'),
  Em: gl.getUniformLocation(program, 'uEm')
};

function mat4(){ return new Float32Array(16); }
function ident(o){ o[0]=1; o[5]=1; o[10]=1; o[15]=1; return o; }
function mul(a,b){
  const o = mat4();
  for(let c=0;c<4;c++) for(let r=0;r<4;r++) {
    o[c*4+r] = a[r] * b[c*4] + a[4+r] * b[c*4+1] + a[8+r] * b[c*4+2] + a[12+r] * b[c*4+3];
  }
  return o;
}
function translate(x,y,z){ const o=ident(mat4()); o[12]=x;o[13]=y;o[14]=z;return o; }
function scale(x,y,z){ const o=ident(mat4()); o[0]=x;o[5]=y;o[10]=z;return o; }
function rotateY(a){ const o=ident(mat4()),c=Math.cos(a),s=Math.sin(a);o[0]=c;o[2]=s;o[8]=-s;o[10]=c;return o; }
function perspective(fovy,aspect,near,far){
  const f=1/Math.tan(fovy/2),o=mat4();
  o[0]=f/aspect;o[5]=f;o[10]=(far+near)/(near-far);o[11]=-1;o[14]=(2*far*near)/(near-far);
  return o;
}
function lookAt(ex,ey,ez,cx,cy,cz){
  let zx=ex-cx,zy=ey-cy,zz=ez-cz;let zl=Math.hypot(zx,zy,zz)||1;zx/=zl;zy/=zl;zz/=zl;
  let xx=zz,xy=0,xz=-zx;let xl=Math.hypot(xx,xy,xz)||1;xx/=xl;xy/=xl;xz/=xl;
  const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;
  const o=ident(mat4());
  o[0]=xx;o[1]=yx;o[2]=zx;o[4]=xy;o[5]=yy;o[6]=zy;o[8]=xz;o[9]=yz;o[10]=zz;
  o[12]=-(xx*ex+xy*ey+xz*ez);o[13]=-(yx*ex+yy*ey+yz*ez);o[14]=-(zx*ex+zy*ey+zz*ez);
  return o;
}

function bufferMesh(verts,norms,inds){
  const vao=gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aPos);gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
  const nb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,nb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(norms),gl.STATIC_DRAW);
  gl.enableVertexAttribArray(aNormal);gl.vertexAttribPointer(aNormal,3,gl.FLOAT,false,0,0);
  const ib=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(inds),gl.STATIC_DRAW);
  gl.bindVertexArray(null); return {vao,count:inds.length};
}

function cube(){
  const p=[-1,-1,-1, 1,-1,-1, 1,1,-1,-1,1,-1, -1,-1,1, 1,-1,1, 1,1,1,-1,1,1];
  const n=[];const i=[0,1,2,0,2,3,1,5,6,1,6,2,5,4,7,5,7,6,4,0,3,4,3,7,3,2,6,3,6,7,4,5,1,4,1,0];
  for(let f=0;f<6;f++){const q=[[0,0,-1],[1,0,0],[0,0,1],[-1,0,0],[0,1,0],[0,-1,0]][f];for(let k=0;k<4;k++)n.push(...q)}
  return bufferMesh(p,n,i);
}
function sphere(seg=16){
  const p=[],n=[],i=[];
  for(let y=0;y<=seg;y++){const v=y/seg,phi=v*Math.PI;for(let x0=0;x0<=seg;x0++){const u0=x0/seg,th=u0*TAU,s=Math.sin(phi),c=Math.cos(phi),xx=Math.cos(th)*s,zz=Math.sin(th)*s;p.push(xx,c,zz);n.push(xx,c,zz)}}
  for(let y=0;y<seg;y++)for(let x0=0;x0<seg;x0++){const a=y*(seg+1)+x0,b=a+1,c=(y+1)*(seg+1)+x0,d=c+1;i.push(a,c,b,b,c,d)}
  return bufferMesh(p,n,i);
}
const CUBE=cube(),SPHERE=sphere();

let P=perspective(48*Math.PI/180,Math.max(1,innerWidth/innerHeight),.1,250),V=lookAt(0,7.2,22,0,2.8,-46),cam=[0,7.2,22];
function draw(mesh,pos,sc,color,emi=0,rot=0){
  const model=mul(translate(pos[0],pos[1],pos[2]),mul(rotateY(rot),scale(sc[0],sc[1],sc[2])));
  const mvp=mul(mul(P,V),model);
  gl.uniformMatrix4fv(u.MVP,false,mvp);gl.uniformMatrix4fv(u.Model,false,model);
  gl.uniform3fv(u.Color,new Float32Array(color));
  gl.uniform3fv(u.Emi,new Float32Array([color[0]*.8,color[1]*.8,color[2]*.8]));
  gl.uniform1f(u.Em,emi);gl.bindVertexArray(mesh.vao);gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
}

// -----------------------------------------------------------------------------
// World / level
// -----------------------------------------------------------------------------
const platforms=[];
const rings=[];
const bursts=[];
let nextZ=6.4;
let sequenceIndex=0;
const patterns=[
  [1,1,1,1,1,1],
  [1,2,1,0,1,2],
  [1,0,0,1,2,2],
  [1,2,2,1,0,0],
  [0,1,2,1,0,1],
  [2,1,0,1,2,1]
];

function spacing(){ return clamp(5.55 - state.distance * 0.004, 4.75, 5.55); }
function spawnPlatform(lane,z,index){
  const p={
    x:(lane-1)*CFG.lane,
    lane,
    z,
    alive:true,
    hit:false,
    passed:false,
    phase:Math.random()*TAU,
    width:rand(.92,1.04),
    pulse:0,
    index
  };
  platforms.push(p);
  return p;
}
function fillAhead(){
  while(nextZ>-CFG.render){
    const pat=patterns[sequenceIndex++%patterns.length];
    for(const lane of pat){
      spawnPlatform(lane,nextZ,sequenceIndex);
      nextZ-=spacing();
    }
  }
}
function seed(){
  platforms.length=0;rings.length=0;bursts.length=0;sequenceIndex=0;nextZ=2.0; fillAhead();
}

const mountains=[];
for(let layer=0;layer<4;layer++){
  for(let i=-7;i<=7;i++) mountains.push({
    x:i*15+rand(-4,4),z:-72-layer*18+rand(-5,5),w:rand(10,18),h:rand(8,17),
    c:layer===0?[.025,.10,.25]:layer===1?[.03,.15,.31]:layer===2?[.04,.19,.35]:[.05,.24,.40],
    phase:rand(0,TAU)
  });
  }
}
const lanterns=[[-10,1.1,-50,1.1], [12,1.1,-58,1], [-18,1.0,-67,.95], [28,1.2,-62,1], [-30,1.1,-57,1.05]];
const particles=Array.from({length:105},()=>({x:rand(-42,42),y:rand(1,28),z:rand(-165,12),s:rand(.035,.105),drift:rand(.12,.42),phase:rand(0,TAU)}));

// -----------------------------------------------------------------------------
// Player + input feel
// -----------------------------------------------------------------------------
let player={x:0,targetX:0,y:1.35,vy:0,onGround:true,scaleY:1,rot:0,tilt:0,landingFlash:0,coyote:0,jumpBuffer:0,support:null};
let laneIndex=1;
const input={jump:false};
let shake=0;
let hitStop=0;
let pointerDown={x:0,y:0,time:0};

function resetPlayer(){
  laneIndex=1;
  player={x:0,targetX:0,y:1.35,vy:0,onGround:true,scaleY:1,rot:0,tilt:0,landingFlash:0,coyote:0,jumpBuffer:0,support:{static:true,x:0,z:CFG.playerZ}};
}
function moveLane(dir){
  if(state.mode!=='playing') return;
  const next=clamp(laneIndex+dir,0,2);
  if(next!==laneIndex){
    laneIndex=next;
    player.targetX=(laneIndex-1)*CFG.lane;
    player.tilt=dir*0.16;
    playClick(dir>0 ? 390 : 330,0.055,0.025);
  }
}
function requestJump(){
  if(state.mode!=='playing') return;
  player.jumpBuffer=.14;
}

function landing(p,perfect){
  if(p.hit) return;
  p.hit=true;p.pulse=1.5;
  player.y=1.35;player.vy=0;player.onGround=true;player.coyote=.12;player.scaleY=.76;player.landingFlash=1;player.support=p;
  const gain=(perfect?165:100)*state.combo;
  state.score+=gain;state.combo=Math.min(16,state.combo+1);state.maxCombo=Math.max(state.maxCombo,state.combo);state.beats++;
  bursts.push({x:player.x,y:.75,z:playerYWorldZ(),life:1.0,perfect});
  shake=perfect?.22:.09;hitStop=perfect?.045:.025;
  if(perfect){showToast('PERFECT +'+Math.floor(gain));playPerfect();}
  else {playLand();}
}
function playerYWorldZ(){ return CFG.playerZ; }

function tryJump(){
  if((player.onGround||player.coyote>0)&&player.jumpBuffer>0){
    player.jumpBuffer=0;player.onGround=false;player.coyote=0;player.vy=CFG.jump;player.scaleY=1.18;player.support=null;playJump();return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Audio: original viral short-form/electronic loop (no external copyrighted file)
// -----------------------------------------------------------------------------
let audioCtx=null, master=null, musicTimer=null, musicRunning=false;
let musicStep=0, nextNoteTime=0;
const BPM=108, STEP=60/BPM/4;
const melody=[440,523.25,659.25,523.25,392,493.88,587.33,493.88];
const bass=[55,55,65.41,55,49,49,58.27,49];

function ensureAudio(){
  if(audioCtx) return;
  audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  master=audioCtx.createGain();master.gain.value=.34;
  const comp=audioCtx.createDynamicsCompressor();comp.threshold.value=-20;comp.knee.value=10;comp.ratio.value=5;comp.attack.value=.004;comp.release.value=.16;
  master.connect(comp);comp.connect(audioCtx.destination);
}
function synthTone(time,freq,duration,type='sine',gainValue=.05,detune=0){
  if(!audioCtx||!state.music)return;
  const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,time);osc.detune.value=detune;
  gain.gain.setValueAtTime(0.0001,time);gain.gain.exponentialRampToValueAtTime(gainValue,time+.012);gain.gain.exponentialRampToValueAtTime(0.0001,time+duration);
  osc.connect(gain);gain.connect(master);osc.start(time);osc.stop(time+duration+.02);
}
function kick(time){
  if(!audioCtx||!state.music)return;
  const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.type='sine';osc.frequency.setValueAtTime(130,time);osc.frequency.exponentialRampToValueAtTime(46,time+.18);
  gain.gain.setValueAtTime(.38,time);gain.gain.exponentialRampToValueAtTime(.001,time+.25);osc.connect(gain);gain.connect(master);osc.start(time);osc.stop(time+.28);
}
function clap(time){
  if(!audioCtx||!state.music)return;
  const buffer=audioCtx.createBuffer(1,audioCtx.sampleRate*.12,audioCtx.sampleRate);const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2.2);
  const src=audioCtx.createBufferSource(),gain=audioCtx.createGain(),filter=audioCtx.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1700;filter.Q.value=.8;gain.gain.value=.22;
  src.buffer=buffer;src.connect(filter);filter.connect(gain);gain.connect(master);src.start(time);
}
function hat(time,open=false){
  if(!audioCtx||!state.music)return;
  const buffer=audioCtx.createBuffer(1,audioCtx.sampleRate*(open?.18:.055),audioCtx.sampleRate);const data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,open?1.8:3.8);
  const src=audioCtx.createBufferSource(),gain=audioCtx.createGain(),filter=audioCtx.createBiquadFilter();filter.type='highpass';filter.frequency.value=6500;gain.gain.value=open?.055:.035;
  src.buffer=buffer;src.connect(filter);filter.connect(gain);gain.connect(master);src.start(time);
}
function playClick(freq=400,d=.05,g=.025){ensureAudio();if(audioCtx.state==='suspended')audioCtx.resume();synthTone(audioCtx.currentTime,freq,d,'triangle',g);}
function playJump(){ensureAudio();const t=audioCtx.currentTime;synthTone(t,330,.11,'triangle',.065);synthTone(t+.05,520,.12,'triangle',.045);}
function playLand(){ensureAudio();const t=audioCtx.currentTime;synthTone(t,180,.14,'sine',.08);synthTone(t+.015,360,.08,'triangle',.035);}
function playPerfect(){ensureAudio();const t=audioCtx.currentTime;[520,659,784,988].forEach((f,i)=>synthTone(t+i*.055,f,.16,'sine',.052));}
function playFail(){ensureAudio();const t=audioCtx.currentTime;[220,175,130].forEach((f,i)=>synthTone(t+i*.09,f,.24,'sine',.075));}
function scheduleMusic(){
  if(!musicRunning||!audioCtx||!state.music||state.mode!=='playing') return;
  while(nextNoteTime<audioCtx.currentTime+.12){
    const s=musicStep%64;const beat=s%16;const bar=Math.floor(s/16);
    if(beat===0||beat===6||beat===8||beat===14)kick(nextNoteTime);
    if(beat===4||beat===12)clap(nextNoteTime);
    if(s%2===0)hat(nextNoteTime,false); if(s%8===7)hat(nextNoteTime,true);
    if(s%4===0)synthTone(nextNoteTime,bass[(bar%2)*4+Math.floor(beat/4)],.26,'sawtooth',.045);
    if(s%2===0)synthTone(nextNoteTime,melody[(s/2)%melody.length],.13,'triangle',.035,Math.sin(s*.8)*6);
    nextNoteTime+=STEP;musicStep=(musicStep+1)%64;
  }
}
function startMusic(){
  ensureAudio();
  if(audioCtx.state==='suspended')audioCtx.resume();
  if(musicRunning) return;
  musicRunning=true;musicStep=0;nextNoteTime=audioCtx.currentTime+.06;
  musicTimer=setInterval(scheduleMusic,24);
}
function stopMusic(){musicRunning=false;if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}
function toggleMusic(){
  state.music=!state.music;$('musicBtn').textContent=state.music?'♫':'×';$('musicBtn').classList.toggle('muted',!state.music);
  if(state.music&&state.mode==='playing')startMusic(); else if(!state.music)stopMusic();
}

// -----------------------------------------------------------------------------
// Game state
// -----------------------------------------------------------------------------
function reset(){
  stopMusic();
  Object.assign(state,{mode:'playing',score:0,distance:0,combo:1,maxCombo:1,speed:7.2,elapsed:0,active:true,beats:0});
  seed();resetPlayer();show(null);updateUI();ensureAudio();startMusic();
}
function end(){
  if(state.mode==='gameover')return;
  stopMusic();state.mode='gameover';state.active=false;
  state.best=Math.max(state.best,Math.floor(state.score));
  localStorage.setItem('moonlit-best',String(state.best));
  $('finalScore').textContent=String(Math.floor(state.score)).padStart(6,'0');
  $('finalBest').textContent=String(state.best).padStart(6,'0');
  $('finalDistance').textContent=Math.floor(state.distance)+' m';
  $('finalCombo').textContent='×'+state.maxCombo;
  $('startBest').textContent=String(state.best).padStart(6,'0');
  show('gameOverScreen');
  ensureAudio();playFail();
}
function pause(){
  if(state.mode==='playing'){state.mode='paused';stopMusic();show('pauseScreen');}
  else if(state.mode==='paused'){state.mode='playing';if(state.music)startMusic();show(null);}
}

function update(dt){
  if(hitStop>0){hitStop-=dt;return;}
  state.elapsed+=dt;
  state.speed=Math.min(CFG.maxSpeed,7.2+state.distance*.017);

  // Input is lane-snap + spring, which feels instantly responsive but stays smooth.
  player.x=smooth(player.x,player.targetX,18,dt);
  player.tilt=smooth(player.tilt,0,8,dt);
  player.jumpBuffer=Math.max(0,player.jumpBuffer-dt);
  player.coyote=Math.max(0,player.coyote-dt);
  tryJump();

  if(player.onGround){
    player.coyote=.1;
    player.y=smooth(player.y,1.35,18,dt);
    if(player.support){
      const stillOnTile=Math.abs(player.x-player.support.x)<CFG.platformW*.60 && (player.support.static || Math.abs(playerYWorldZ()-player.support.z)<CFG.platformD*.70);
      if(!stillOnTile){
        player.onGround=false;player.vy=-1.5;player.support=null;
      } else if(!player.support.static && player.support.z>CFG.playerZ+1.7){
        // The moving tile has passed the camera plane. A jump is required to continue.
        player.onGround=false;player.vy=-2.0;player.support=null;
      }
    }
  }else{
    player.vy-=CFG.gravity*dt;
    player.y+=player.vy*dt;
  }
  player.scaleY=smooth(player.scaleY,1,10,dt);
  player.rot+=dt*(2.6+state.speed*.18);
  if(player.y<-5){end();return;}

  const scroll=state.speed*dt;
  nextZ+=scroll;
  for(const p of platforms) if(p.alive){p.z+=scroll;p.pulse=Math.max(0,p.pulse-dt*2.4);}
  for(const r of rings) r.life-=dt;
  for(const b of bursts) b.life-=dt;
  while(nextZ>-CFG.render) fillAhead();

  // Descending collision: the player can land on the next reachable platform.
  if(!player.onGround&&player.vy<=0){
    for(const p of platforms){
      if(!p.alive||p.hit)continue;
      const xHit=Math.abs(player.x-p.x)<CFG.platformW*.55;
      const zHit=Math.abs(playerYWorldZ()-p.z)<CFG.platformD*.48;
      const yHit=player.y<=1.85&&player.y>=.45;
      if(xHit&&zHit&&yHit){
        landing(p,Math.abs(player.x-p.x)<.28);break;
      }
    }
  }

  // A tile that has crossed the player without a landing is missed.
  for(const p of platforms){
    if(!p.alive||p.hit||p.passed)continue;
    if(p.z>CFG.playerZ+2.0){
      p.passed=true;
      if(!player.onGround && player.y>0.8) state.combo=1;
    }
  }

  state.distance+=state.speed*dt*.98;
  state.score+=dt*(13+state.speed*1.8);
  if(state.elapsed>0 && Math.floor(state.elapsed*10)%11===0) state.combo=Math.max(1,state.combo);

  // Trim old tiles without splicing during iteration.
  let write=0;
  for(const p of platforms){
    if(p.z<18) platforms[write++]=p;
  }
  platforms.length=write;
  updateUI();
}

function showToast(text){const el=$('statusToast');el.textContent=text;el.classList.remove('show');void el.offsetWidth;el.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.classList.remove('show'),650);}
function updateUI(){
  $('score').textContent=String(Math.floor(state.score)).padStart(6,'0');
  $('distance').textContent=Math.floor(state.distance)+' m';
  $('combo').textContent='COMBO ×'+state.combo;
}
function show(id){
  for(const e of ['startScreen','pauseScreen','gameOverScreen'])$(e).classList.add('hidden');
  if(id)$(id).classList.remove('hidden');
  $('hud').classList.toggle('hidden',state.mode!=='playing');
  $('mobileControls').classList.toggle('hidden',state.mode!=='playing');
}

// -----------------------------------------------------------------------------
// Rendering / atmosphere
// -----------------------------------------------------------------------------
function render(t){
  gl.enable(gl.DEPTH_TEST);gl.clearColor(.015,.042,.12,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
  gl.uniform3fv(u.Cam,new Float32Array(cam));gl.uniform1f(u.Fog,.0092);gl.uniform3fv(u.Light,new Float32Array([.45,.88,.62]));

  const pulse=Math.sin(t*.0011)*.5+.5;
  // Deep sky / horizon volume.
  draw(CUBE,[0,8,-98],[105,30,1],[.025,.10,.28],.28);
  draw(CUBE,[0,2.3,-78],[58,.28,1.15],[.045,.42,.62],.95+.25*pulse);

  // Moon with layered bloom shells.
  const moonPulse=1+Math.sin(t*.0007)*.035;
  draw(SPHERE,[36,31,-104],[7.0*moonPulse,7.0*moonPulse,7.0*moonPulse],[1.0,.97,.86],.45);
  draw(SPHERE,[36,31,-103.2],[10.8,10.8,.55],[.07,.33,.58],.10+.03*pulse);
  draw(SPHERE,[36,31,-102.4],[14.2,14.2,.22],[.03,.16,.32],.05);

  // Water-like reflective field.
  const ripple=Math.sin(t*.0008)*.06;
  draw(CUBE,[0,-.6,-75],[46,.36,82],[.018,.15,.32],.16+ripple);
  for(let i=-3;i<=3;i++) draw(CUBE,[i*10,0.02,-34-i*8],[7.0,.016,.08],[.08,.44,.64],.26);

  // Distant mountain layers / misty silhouettes.
  for(const m of mountains){
    const sway=Math.sin(t*.0003+m.phase)*.15;
    draw(CUBE,[m.x+sway,m.h*.42,m.z],[m.w,m.h*.42,m.w*.34],m.c,.05);
  }

  // Fortress on left + tiered pagoda on right.
  const architecturePulse=.08+0.04*Math.sin(t*.0008);
  draw(CUBE,[-31,4.0,-78],[15,4,4],[.018,.075,.20],architecturePulse);
  draw(CUBE,[-37,6.6,-77],[3,6.6,4],[.023,.10,.24],architecturePulse+.03);
  for(let i=0;i<4;i++) draw(CUBE,[-37,2.4+i*2.7,-77],[4.4-i*.45,.10,4.8-i*.5],[.025,.11,.24],.07);
  draw(CUBE,[27,4,-72],[7,4,4],[.018,.075,.19],.08);
  for(let i=0;i<4;i++){
    const yy=6+i*2.15;const s=5.5-i*.95;
    draw(CUBE,[27,yy,-72],[s,.18,3.8-i*.45],[.018,.08,.20],.10+i*.02);
  }

  // Bamboo silhouettes on upper left, moving very slightly.
  for(let i=0;i<7;i++){
    const bx=-48+i*3.25;const lean=Math.sin(t*.00055+i)*.025;
    draw(CUBE,[bx+lean,9,-58+i*.55],[.17,9,.17],[.018,.055,.13],.02,lean);
    draw(CUBE,[bx+1.2+lean,12,-58+i*.55],[1.5,.13,.22],[.018,.065,.14],.02,-.13+i*.02);
  }

  // Glowing guide rails and path accents.
  draw(CUBE,[-5.7,-.05,-68],[.055,.08,84],[.08,.65,.98],1.35);
  draw(CUBE,[5.7,-.05,-68],[.055,.08,84],[.08,.65,.98],1.35);
  for(let i=0;i<12;i++){
    const z=-15-i*11+(state.distance*.36%11);const y=.07+Math.sin(t*.0015+i)*.02;
    draw(CUBE,[-4.95,y,z],[.06,.05,.45],[.08,.58,.72],.75);
    draw(CUBE,[4.95,y,z],[.06,.05,.45],[.08,.58,.72],.75);
  }

  // Foreground launch pad stays locked to the camera, matching the reference composition.
  const starterGlow=.95+Math.sin(t*.0022)*.08;
  draw(CUBE,[0,.02,CFG.playerZ],[1.45,.20,1.75],[.025,.25,.43],1.05);
  draw(CUBE,[0,.245,CFG.playerZ],[1.55,.065,1.84],[.10,.90,1],starterGlow*1.22);
  draw(CUBE,[0,.35,CFG.playerZ],[1.27,.018,1.52],[.32,.98,1],starterGlow*.35);

  // Platforms: layered base + pulsing top + shadow/halo.
  for(const p of platforms){
    if(!p.alive)continue;
    const bob=Math.sin(t*.0017+p.phase)*.035;
    const glow=.95+p.pulse*1.25+Math.sin(t*.002+p.phase)*.08;
    const sx=CFG.platformW*.5*p.width;
    draw(CUBE,[p.x,.02+bob,p.z],[sx,.2,CFG.platformD*.5],[.025,.25,.43],1.05);
    draw(CUBE,[p.x,.245+bob,p.z],[sx+.08,.065,CFG.platformD*.5+.08],[.10,.90,1],glow*1.28);
    draw(CUBE,[p.x,.35+bob,p.z],[sx*.83,.018,CFG.platformD*.42],[.32,.98,1],glow*.35);
  }

  // Floating lanterns.
  for(const l of lanterns){
    const [x,y,z,s]=l;const yy=y+Math.sin(t*.0012+z)*.25;
    draw(CUBE,[x,yy,z],[.5*s,.5*s,.5*s],[.02,.20,.48],1.6);
    draw(SPHERE,[x,yy,z],[.82*s,.36*s,.82*s],[.08,.68,1],2.4);
  }

  // Floating motes.
  for(const q of particles){
    const x=q.x+Math.sin(t*.0004+q.phase)*q.drift;
    const y=q.y+Math.sin(t*.00065+q.phase)*.45;
    draw(CUBE,[x,y,q.z],[q.s,q.s,q.s],[.24,.8,1],2.25);
  }

  // Hit bursts / landing rings.
  for(const r of rings){
    const s=1+(1-r.life)*3.8;draw(CUBE,[r.x,.24,r.z],[s,.03,.08],[.16,.85,1],2.0);draw(CUBE,[r.x,.24,r.z],[.08,s*.55,.08],[.32,.95,1],2.0);}
  for(const b of bursts){
    const k=1-b.life;const size=b.perfect?(.35+k*2.2):(.3+k*1.6);
    draw(SPHERE,[b.x,.55,b.z],[size,size*.25,size],[.12,.75,1],2.0);
  }

  // Player: squash/stretch + halo.
  const lift=Math.sin(t*.006)*.025;
  const glow=3.3+player.landingFlash*2.5;
  draw(SPHERE,[player.x,player.y+lift,playerYWorldZ],[.68,.68*player.scaleY,.68],[.96,1,1],glow,player.rot);
  draw(SPHERE,[player.x,player.y-.12,playerYWorldZ],[1.28,1.28,.36],[.10,.62,1],1.15,player.tilt);
  player.landingFlash=Math.max(0,player.landingFlash-.045);

  // Camera: responsive follow, subtle forward cinematic sway and landing shake.
  const forwardSway=Math.sin(t*.0007)*.24;
  const targetX=player.x*.28;
  let ex=smooth(cam[0],targetX,8,0.016), ey=smooth(cam[1],7.25+(player.y-1.35)*.18,7,0.016), ez=smooth(cam[2],playerYWorldZ()+15.3,7,0.016);
  if(shake>0){ex+=(Math.random()-.5)*shake;ey+=(Math.random()-.5)*shake*.45;shake*=.86;}else shake*=.9;
  if(state.mode!=='playing'){ex=smooth(ex,0,2,.016);ey=smooth(ey,7.8,2,.016);ez=smooth(ez,22,2,.016);}
  ex+=forwardSway;cam=[ex,ey,ez];
  P=perspective((innerWidth<700?52:48)*Math.PI/180,canvas.width/canvas.height,.1,250);
  V=lookAt(ex,ey,ez,player.x*.08,2.8,playerYWorldZ()-46);
}

// -----------------------------------------------------------------------------
// Effects + input
// -----------------------------------------------------------------------------
function resize(){
  const maxDpr=innerWidth<700?1.35:1.7;const d=Math.min(devicePixelRatio||1,maxDpr);
  canvas.width=Math.floor(innerWidth*d);canvas.height=Math.floor(innerHeight*d);canvas.style.width='100%';canvas.style.height='100%';
  gl.viewport(0,0,canvas.width,canvas.height);
}
addEventListener('resize',resize);resize();

addEventListener('keydown',(e)=>{
  if(['ArrowLeft','ArrowRight','a','d','A','D',' ','w','W','Escape'].includes(e.key))e.preventDefault();
  if(e.repeat && ['ArrowLeft','ArrowRight','a','d','A','D'].includes(e.key))return;
  if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A')moveLane(-1);
  if(e.key==='ArrowRight'||e.key==='d'||e.key==='D')moveLane(1);
  if(e.key===' '||e.key==='w'||e.key==='W')requestJump();
  if(e.key==='Escape')pause();
});

canvas.addEventListener('pointerdown',(e)=>{pointerDown={x:e.clientX,y:e.clientY,time:performance.now()};});
canvas.addEventListener('pointerup',(e)=>{
  if(state.mode!=='playing')return;
  const dx=e.clientX-pointerDown.x,dy=e.clientY-pointerDown.y,dur=performance.now()-pointerDown.time;
  if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)){moveLane(dx>0?1:-1);return;}
  if(Math.abs(dy)>52&&dy<0){requestJump();return;}
  if(dur<260)requestJump();
});

$('leftTouch').addEventListener('pointerdown',e=>{e.preventDefault();moveLane(-1);});
$('rightTouch').addEventListener('pointerdown',e=>{e.preventDefault();moveLane(1);});
$('jumpTouch').addEventListener('pointerdown',e=>{e.preventDefault();requestJump();});
$('playBtn').onclick=()=>reset();$('retryBtn').onclick=()=>reset();$('resumeBtn').onclick=()=>pause();$('pauseRestartBtn').onclick=()=>reset();$('pauseBtn').onclick=()=>pause();$('musicBtn').onclick=()=>toggleMusic();$('startMusicBtn').onclick=()=>toggleMusic();

window.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')pause();});

$('startBest').textContent=String(state.best).padStart(6,'0');
$('musicBtn').textContent='♫';
$('startMusicBtn').textContent='♫ SOUND ON';
show('startScreen');

let last=performance.now();
function loop(t){
  const dt=Math.min(.033,Math.max(.001,(t-last)/1000));last=t;
  if(state.mode==='playing')update(dt);
  // Ring objects decay from landing effects.
  while(rings.length&&rings[0].life<=0)rings.shift();
  while(bursts.length&&bursts[0].life<=0)bursts.shift();
  render(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Add a ring immediately for each landing / perfect hit.
const originalLanding=landing;
landing=function(p,perfect){
  originalLanding(p,perfect);
  rings.push({x:player.x,z:playerYWorldZ(),life:1});
  if(rings.length>10)rings.shift();
};
