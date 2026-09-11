const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
async function api(path,opts={}){const r=await fetch(path,{...opts,credentials:'same-origin',headers:{...(opts.body instanceof FormData?{}:{'content-type':'application/json'}),...(opts.headers||{})}});const p=await r.json().catch(()=>({}));if(!r.ok){const err=new Error(p.error||'Something went wrong.');err.status=r.status;throw err}return p}
function msg(t,bad=false){const e=$('#msg');if(e)e.innerHTML=`<div class="notice ${bad?'error':''}">${esc(t)}</div>`}
function formJSON(f){return Object.fromEntries(new FormData(f))}
function safeNext(fallback='/dashboard.html'){const n=new URLSearchParams(location.search).get('next');if(!n)return fallback;try{const u=new URL(n,location.origin);return u.origin===location.origin&&n.startsWith('/')&&!n.startsWith('//')&&!u.pathname.startsWith('/login.html')?u.pathname+u.search+u.hash:fallback}catch{return fallback}}
function loginUrl(next='/dashboard.html'){return `/login.html?next=${encodeURIComponent(next)}`}
let sessionCache;
async function session(force=false){if(!force&&sessionCache!==undefined)return sessionCache;try{const me=await api('/api/me');sessionCache=me.authenticated?me:false}catch{sessionCache=false}return sessionCache}

$('#register')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/auth/register',{method:'POST',body:JSON.stringify(formJSON(e.target))});sessionCache=undefined;location.replace(safeNext())}catch(x){msg(x.message,true)}});
$('#login')?.addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(formJSON(e.target))});sessionCache=undefined;location.replace(safeNext())}catch(x){msg(x.message,true)}});
$('#logout')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'})}finally{sessionCache=false;location.replace('/')}});

const showLogin=$('#showLogin'),showRegister=$('#showRegister'),loginPane=$('#loginPane'),registerPane=$('#registerPane');
showLogin?.addEventListener('click',()=>{loginPane.hidden=false;registerPane.hidden=true;showLogin.classList.add('active');showRegister.classList.remove('active')});
showRegister?.addEventListener('click',()=>{loginPane.hidden=true;registerPane.hidden=false;showRegister.classList.add('active');showLogin.classList.remove('active')});

async function applyAuthUI(){const me=await session();$$('[data-account-link]').forEach(a=>{a.textContent=me?'My Disputr':'Sign in';a.href=me?'/dashboard.html':loginUrl('/dashboard.html')});$$('[data-start-complaint]').forEach(a=>{const category=a.dataset.category||'';const dest=`/dashboard.html?new=1${category?'&category='+encodeURIComponent(category):''}`;a.href=me?dest:loginUrl(dest)});if($('#mainCta'))$('#mainCta').textContent=me?'Start complaint':'Get started';if($('#billing')&&me?.subscription&&['active','trialing'].includes(me.subscription.status))$('#billing').textContent='Manage Premium';if($('#supportForm')&&me?.user?.email&&!$('#supportForm').email.value)$('#supportForm').email.value=me.user.email;if(document.body.dataset.page==='login'&&me)location.replace(safeNext())}
applyAuthUI();
window.addEventListener('pageshow',e=>{if(e.persisted){sessionCache=undefined;applyAuthUI();dashboard()}});

$('#billing')?.addEventListener('click',async()=>{try{const me=await session(true);if(!me){location.replace(loginUrl('/pricing.html'));return}if(me.subscription&&['active','trialing'].includes(me.subscription.status)){const p=await api('/api/billing/create-portal-session',{method:'POST',body:'{}'});location=p.url;return}const p=await api('/api/billing/create-checkout-session',{method:'POST',body:'{}'});location=p.url}catch(x){msg(x.message,true)}});

$('#supportForm')?.addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;try{const p=await api('/api/support',{method:'POST',body:JSON.stringify(formJSON(e.target))});msg(`Support request sent. Your reference is ${p.ticket_ref}.`);e.target.reset()}catch(x){msg(x.message,true)}finally{button.disabled=false}});

function toggleCase(show=true){const p=$('#newCasePanel');if(!p)return;p.hidden=!show;if(show)p.scrollIntoView({behavior:'smooth',block:'start'})}
$('#startCase')?.addEventListener('click',()=>toggleCase(true));$('#startCase2')?.addEventListener('click',()=>toggleCase(true));$('#closeCase')?.addEventListener('click',()=>toggleCase(false));

let dashboardRunning=false;
async function dashboard(){if(!$('#cases')||dashboardRunning)return;dashboardRunning=true;try{const me=await session();if(!me){location.replace(loginUrl(location.pathname+location.search));return}const [c,r]=await Promise.all([api('/api/complaints'),api('/api/reminders')]);const cases=c.complaints||[],rems=r.reminders||[];$('#caseCount').textContent=cases.length;$('#openCount').textContent=cases.filter(x=>!['closed','resolved'].includes(String(x.status).toLowerCase())).length;$('#reminderCount').textContent=rems.filter(x=>!x.completed).length;$('#cases').innerHTML=cases.length?cases.map(x=>`<a class="card case" href="/case.html?id=${encodeURIComponent(x.id)}"><strong>${esc(x.company)}</strong><span>${esc(x.case_ref)} · ${esc(x.status)}</span></a>`).join(''):'<div class="notice"><strong>No cases yet.</strong><br><span class="muted">Start a complaint when you are ready.</span></div>';$('#reminders').innerHTML=rems.length?rems.slice(0,6).map(x=>`<p><strong>${esc(x.title)}</strong><br><span class="muted">${esc(x.company||'Case reminder')} · ${new Date(x.due_at*1000).toLocaleDateString()}</span></p>`).join(''):'<p class="muted">Nothing due right now.</p>';const q=new URLSearchParams(location.search);if(q.get('new')==='1'){toggleCase(true);const sel=$('#caseForm select[name="category"]');if(sel&&q.get('category'))sel.value=q.get('category')}}catch(x){if(x.status===401)location.replace(loginUrl(location.pathname+location.search));else msg(x.message,true)}finally{dashboardRunning=false}}
$('#caseForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const b=formJSON(e.target);const p=await api('/api/complaints',{method:'POST',body:JSON.stringify(b)});location=`/case.html?id=${encodeURIComponent(p.id)}`}catch(x){msg(x.message,true)}});
dashboard();