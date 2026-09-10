import app from './worker-v2.js';

const COOKIE='disputr_session';
const TTL=2592000;
const ITERATIONS=100000;
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const J=(x,s=200,h={})=>new Response(JSON.stringify(x),{status:s,headers:{...JSON_HEADERS,...h}});
const T=x=>typeof x==='string'?x.trim():'';
const ID=()=>crypto.randomUUID();

function origin(r){const o=r.headers.get('origin');return !o||o===new URL(r.url).origin}
function cookie(v,n=TTL){return `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${n}`}
async function body(r){try{return await r.json()}catch{return {}}}
function b64(a){return btoa(String.fromCharCode(...a))}
function ub(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
function sessionToken(){return [...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function sha(s){const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function passwordHash(p,s){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(p),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:ub(s),iterations:ITERATIONS},k,256);return b64(new Uint8Array(bits))}

async function register(r,e){
 const b=await body(r),email=T(b.email).toLowerCase(),p=String(b.password||''),name=T(b.name).slice(0,100);
 if(!/^\S+@\S+\.\S+$/.test(email)||p.length<10)return J({error:'Enter a valid email and a password of at least 10 characters.'},400);
 if(await e.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return J({error:'An account already exists for this email.'},409);
 const salt=b64(crypto.getRandomValues(new Uint8Array(16))),uid=ID(),token=sessionToken();
 await e.DB.batch([
  e.DB.prepare('INSERT INTO users(id,email,name,password_hash,password_salt) VALUES(?,?,?,?,?)').bind(uid,email,name,await passwordHash(p,salt),salt),
  e.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,unixepoch()+?)').bind(ID(),uid,await sha(token),TTL)
 ]);
 return J({ok:true,user:{id:uid,email,name,premium:0}},201,{'set-cookie':cookie(token)});
}

async function login(r,e){
 const b=await body(r),email=T(b.email).toLowerCase(),p=String(b.password||''),u=await e.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
 if(!u||await passwordHash(p,u.password_salt)!==u.password_hash)return J({error:'Email or password is incorrect.'},401);
 const token=sessionToken();
 await e.DB.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(?,?,?,unixepoch()+?)').bind(ID(),u.id,await sha(token),TTL).run();
 return J({ok:true,user:{id:u.id,email:u.email,name:u.name,premium:u.premium}},200,{'set-cookie':cookie(token)});
}

export default {async fetch(r,e,ctx){
 const u=new URL(r.url);
 try{
  if((u.pathname==='/api/auth/register'||u.pathname==='/api/auth/login')&&r.method==='POST'){
   if(!origin(r))return J({error:'Invalid request origin.'},403);
   return u.pathname.endsWith('/register')?register(r,e):login(r,e);
  }
  return app.fetch(r,e,ctx);
 }catch(err){console.error(err);return J({error:'Server error.'},500)}
}};
