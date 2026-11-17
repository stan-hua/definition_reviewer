(function(){
"use strict";
/* ============================================================
   Findings definition review — Supabase edition
   Data: findings.json (built from your YAML by build_findings.py)
   Storage and sign-in: Supabase (settings in config.js)
   ============================================================ */
const CFG = window.REVIEW_CONFIG || {};
const TYPES = CFG.ISSUE_TYPES || ["Imprecise","Unclear or ambiguous","Overlaps another finding","Missing inclusion or exclusion","Contradiction","Clinically inaccurate","Wording or typo","Other"];
let DATA, CATS, QMAP = {}, TOTAL = 0, HASH2Q = {}, CATHASH = [];

const S = {sb:null, me:null, isReviewer:false, isAdmin:false, profile:null, ready:false,
  notesRaw:[], reviews:[], pocus:[], pocusOK:false, profiles:{}, reviewersList:[], cache:null,
  view:'browse', cat:0, q:'', onlyNotes:false, onlyUnreviewed:false, forms:{},
  fNotes:{status:'open',type:'',who:'',cat:''}, busy:false};

const $ = s=>document.querySelector(s);
const esc = s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const qHash = id=>'f-'+id.replace(/_/g,'-');
const ago = t=>{ if(!t) return ''; const s=(Date.now()-t)/1000;
  if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+' min ago'; if(s<86400) return Math.floor(s/3600)+' h ago';
  return new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); };
const FLAG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 14V2.5M3 2.5h8.5l-1.8 3 1.8 3H3"/></svg>';
const GOOGLE = '<svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

/* ---------- derived data ---------- */
function allNotes(){
  if(S.cache) return S.cache;
  S.cache = S.notesRaw.filter(r=>QMAP[r.qid]).map(r=>({key:r.id, uid:r.author_id, qid:r.qid, target:r.target, targetText:r.target_text,
    type:r.issue_type, text:r.body, parent:r.parent_id, status:r.status, created:Date.parse(r.created_at), edited:r.edited_at}))
    .sort((a,b)=>a.created-b.created);
  return S.cache;
}
function notesFor(qid){ return allNotes().filter(n=>n.qid===qid); }
function reviewers(qid){ return S.reviews.filter(r=>r.qid===qid).map(r=>r.user_id); }
function iReviewed(qid){ return !!S.me && S.reviews.some(r=>r.qid===qid&&r.user_id===S.me.id); }
function canSave(){ return !!(S.sb && S.me && S.isReviewer && S.profile); }
function name(uid){ if(S.me&&uid===S.me.id) return 'You'; return S.profiles[uid]||'Former reviewer'; }
function targetsOf(q){
  const t=[{k:'question',l:'Question',x:q.question}];
  q.variants.forEach((v,i)=>t.push({k:'var'+i,l:'Question variant '+(i+1),x:v}));
  q.defs.forEach((d,i)=>t.push({k:'def'+i,l:d.label+' (sentence '+(i+1)+')',x:d.text}));
  if(q.include_terms.length) t.push({k:'include_terms',l:'Include terms (whole list)',x:q.include_terms.join('; ')});
  q.include_terms.forEach((x,i)=>t.push({k:'inc'+i,l:'Include term',x}));
  if(q.exclude_terms.length) t.push({k:'exclude_terms',l:'Exclude terms (whole list)',x:q.exclude_terms.join('; ')});
  q.exclude_terms.forEach((x,i)=>t.push({k:'exc'+i,l:'Exclude term',x}));
  if(q.severity_scale) t.push({k:'severity',l:'Severity scale',x:q.severity_scale});
  if(q.answer_rule) t.push({k:'answer_rule',l:'Answer rule',x:q.answer_rule});
  t.push({k:'overall',l:'The finding as a whole',x:''});
  return t;
}
// Notes point at parts by position (e.g. "def1"). After the definitions are rebuilt, the part at that
// position may be gone or reworded; the note's own target_text keeps the wording it was written about.
function stale(n,t){ return !!(t&&n.target!=='overall'&&n.targetText&&t.x&&n.targetText!==t.x); }
function targetLabel(n){ const q=QMAP[n.qid]&&QMAP[n.qid].q; if(!q) return n.target;
  const t=targetsOf(q).find(t=>t.k===n.target);
  if(!t) return /^var\d/.test(n.target)?'Question variant (since removed)':/^def\d/.test(n.target)?'Definition sentence (since removed)':/^(inc|exc)\d/.test(n.target)?'Term (since removed)':(n.target||'');
  return stale(n,t)?t.l+' · wording since changed':t.l; }

/* ---------- nav ---------- */
function renderNav(){
  let h='<input class="search" id="search" type="search" placeholder="Search findings, definitions, terms" value="'+esc(S.q)+'">';
  h+='<div class="navfilters"><label><input type="checkbox" id="onlyNotes"'+(S.onlyNotes?' checked':'')+'> Has notes</label>'+
     '<label><input type="checkbox" id="onlyUnrev"'+(S.onlyUnreviewed?' checked':'')+'> Not reviewed by me</label></div><div id="cats"></div>';
  $('#nav').innerHTML=h;
  $('#nav').classList.toggle('searching',filtering());
  updateNav();
}
function filtering(){ return !!S.q.trim()||S.onlyNotes||S.onlyUnreviewed; }
function matches(q){
  const ql=S.q.trim().toLowerCase();
  if(ql){ const hay=(q.id+' '+q.question+' '+q.variants.join(' ')+' '+q.definition+' '+q.include_terms.join(' ')+' '+q.exclude_terms.join(' ')+' '+(q.severity_scale||'')+' '+(q.answer_rule||'')).toLowerCase();
    if(!ql.split(/\s+/).every(w=>hay.includes(w))) return false; }
  if(S.onlyNotes && !notesFor(q.id).length) return false;
  if(S.onlyUnreviewed && iReviewed(q.id)) return false;
  return true;
}
function updateNav(){
  const box=$('#cats'); if(!box) return;
  const open={}; allNotes().forEach(n=>{ if(n.status!=='resolved'&&!n.parent) open[n.qid]=(open[n.qid]||0)+1; });
  let h='';
  CATS.forEach((c,ci)=>{
    const qs=c.questions.filter(matches);
    if(filtering()&&!qs.length) return;
    const oc=c.questions.reduce((a,q)=>a+(open[q.id]||0),0);
    h+='<div class="cat'+(S.view==='browse'&&S.cat===ci&&!filtering()?' on':'')+'"><button data-cat="'+ci+'"><span class="nm">'+esc(c.name)+'</span>'+
       (oc?'<span class="badge" title="Open notes">'+oc+'</span>':'')+'<span class="cnt">'+c.questions.length+'</span></button><div class="qlist">';
    (filtering()?qs:c.questions).forEach(q=>{
      h+='<a href="#'+qHash(q.id)+'" data-q="'+esc(q.id)+'"><span class="ck">'+(iReviewed(q.id)?'✓':'')+'</span><span class="t" title="'+esc(q.question)+'">'+esc(q.question.replace(/^(Is|Are) there (any )?/i,'').replace(/\?$/,''))+'</span>'+
         (open[q.id]?'<span class="badge">'+open[q.id]+'</span>':'')+'</a>';
    });
    h+='</div></div>';
  });
  box.innerHTML=h||'<div class="hint" style="padding:8px">No findings match.</div>';
  const c=allNotes().filter(n=>!n.parent&&n.status!=='resolved').length;
  $('#notecount').textContent=c?c:'';
}

/* ---------- browse ---------- */
function flagBtn(qid,k,title){ return '<button class="flag" title="'+esc(title)+'" data-act="add" data-q="'+esc(qid)+'" data-t="'+k+'">'+FLAG+'</button>'; }
function cardHTML(q){
  const id=esc(q.id);
  let h='<section class="card" id="'+qHash(q.id)+'" data-q="'+id+'">';
  h+='<div class="chead"><div class="qq"><div class="sent title" data-t="question"><h3>'+esc(q.question)+'</h3>'+flagBtn(q.id,'question','Flag the question')+'</div>'+
     '<div class="qid"><a href="#'+qHash(q.id)+'">'+id+'</a></div></div><button class="addbtn" data-act="add" data-q="'+id+'" data-t="overall">+ Note on whole finding</button></div>';
  h+='<div class="defs">';
  q.variants.forEach((v,i)=>{ h+='<div class="sent" data-t="var'+i+'"><div class="lab Variant">'+(i===0?'Question variants':'')+'</div><div class="stext var">'+esc(v)+'</div>'+flagBtn(q.id,'var'+i,'Flag this question variant')+'</div>'; });
  q.defs.forEach((d,i)=>{ const cls=d.label.indexOf('·')>-1?'mixed':d.label.split(' ')[0];
    h+='<div class="sent" data-t="def'+i+'"><div class="lab '+esc(cls)+'">'+esc(d.label)+'</div><div class="stext">'+esc(d.text)+'</div>'+flagBtn(q.id,'def'+i,'Flag this sentence')+'</div>'; });
  if(q.include_terms.length) h+='<div class="sent" data-t="include_terms"><div class="lab Includes">Include terms</div><div class="chips">'+q.include_terms.map((x,i)=>'<button class="chip" data-act="add" data-q="'+id+'" data-t="inc'+i+'" title="Flag this term">'+esc(x)+'</button>').join('')+'</div>'+flagBtn(q.id,'include_terms','Flag the include-term list')+'</div>';
  if(q.exclude_terms.length) h+='<div class="sent" data-t="exclude_terms"><div class="lab Excludes">Exclude terms</div><div class="chips">'+q.exclude_terms.map((x,i)=>'<button class="chip x" data-act="add" data-q="'+id+'" data-t="exc'+i+'" title="Flag this term">'+esc(x)+'</button>').join('')+'</div>'+flagBtn(q.id,'exclude_terms','Flag the exclude-term list')+'</div>';
  if(q.severity_scale) h+='<div class="sent" data-t="severity"><div class="lab">Severity scale</div><div class="stext">'+esc(q.severity_scale)+'</div>'+flagBtn(q.id,'severity','Flag the severity scale')+'</div>';
  if(q.answer_rule) h+='<div class="sent" data-t="answer_rule"><div class="lab">Answer rule</div><div class="stext">'+esc(q.answer_rule)+'</div>'+flagBtn(q.id,'answer_rule','Flag the answer rule')+'</div>';
  h+='</div><div class="formslot" data-q="'+id+'"></div><div class="notes" data-q="'+id+'"></div><div class="foot" data-q="'+id+'"></div></section>';
  return h;
}
function renderBrowse(){
  const w=$('#wrap'); let h='';
  if(filtering()){
    const groups=CATS.map((c,ci)=>({c,ci,qs:c.questions.filter(matches)})).filter(g=>g.qs.length);
    const n=groups.reduce((a,g)=>a+g.qs.length,0);
    h+='<div class="cathead"><h2>'+n+' matching finding'+(n===1?'':'s')+'</h2><p>Clear the search and filters in the sidebar to browse by category.</p></div>';
    groups.forEach(g=>{ h+='<p class="hint" style="margin:22px 0 8px;font-weight:600;color:var(--ink2)">'+esc(g.c.name)+'</p>'; g.qs.forEach(q=>h+=cardHTML(q)); });
    if(!n) h+='<div class="empty">Nothing matches.</div>';
  } else {
    const c=CATS[S.cat];
    h+='<div class="cathead"><h2>'+esc(c.name)+'</h2><p>'+esc(c.description)+' · '+c.questions.length+' finding'+(c.questions.length===1?'':'s')+
       (c.cross_cutting?' &nbsp;<span class="tag">cross-cutting</span>':'')+'</p></div>';
    c.questions.forEach(q=>h+=cardHTML(q));
  }
  w.innerHTML=h;
  w.querySelectorAll('.card').forEach(el=>fillForm(el.dataset.q));
}
function fillDynamic(qid){
  const card=document.querySelector('.card[data-q="'+CSS.escape(qid)+'"]'); if(!card) return;
  const ns=notesFor(qid);
  const tops=ns.filter(n=>!n.parent||!ns.some(p=>p.key===n.parent));
  const tg={}; targetsOf(QMAP[qid].q).forEach(t=>{ tg[t.k]=t; });
  const flagged={}; ns.forEach(n=>{ if(!n.parent&&n.status!=='resolved'&&tg[n.target]&&!stale(n,tg[n.target])) flagged[n.target]=1; });
  card.querySelectorAll('.sent,.chip').forEach(s=>{ s.classList.toggle('has',!!flagged[s.dataset.t]); s.classList.remove('active'); });
  const fo=S.forms[qid]; if(fo&&!fo.parent){ const el=card.querySelector('[data-t="'+fo.target+'"]:not(.flag)'); if(el) el.classList.add('active'); }
  card.querySelector('.notes').innerHTML=tops.map(n=>noteHTML(n,ns)).join('');
  const rv=reviewers(qid), mine=iReviewed(qid), openN=tops.filter(n=>n.status!=='resolved').length;
  let f='';
  if(canSave()){ const ready=mine||pocusDone(qid);
    f+='<button class="revbtn'+(mine?' on':'')+'" data-act="review" data-q="'+esc(qid)+'"'+(ready?'':' disabled title="Answer both POCUS questions above first"')+'>'+(mine?'Reviewed by you':'Mark as reviewed')+'</button>';
    if(!ready) f+='<span class="hint">Answer both POCUS questions to mark as reviewed</span>'; }
  if(S.isReviewer){
    f+='<span>'+(rv.length?'Reviewed by '+rv.map(u=>esc(name(u))).join(', '):'Not yet reviewed')+'</span>';
    f+='<span>·</span><span>'+(tops.length?openN+' open, '+(tops.length-openN)+' resolved':'No notes')+'</span>';
  }
  const foot=card.querySelector('.foot'), ae=document.activeElement;
  if(ae&&ae.classList.contains('pnote')&&foot.contains(ae)) return; // don't wipe a reason being typed
  foot.innerHTML=pocusHTML(qid)+f;
}
/* ---------- blinded POCUS ratings (reviewers see only their own; admins see all) ---------- */
const POCUS=[[1,'Very unlikely'],[2,'Unlikely'],[3,'Unsure'],[4,'Likely'],[5,'Very likely']];
const pocusLabel=v=>{ const p=POCUS.find(x=>x[0]===v); return p?p[1]:''; };
const PQS=[
  {k:'visible',    short:'Visible on abdominal POCUS (from FAST exam)?',
   full:'How likely is it that this finding is visible on abdominal point-of-care ultrasound (POCUS) from a FAST exam?'},
  {k:'inferrable', short:'Inferrable from abdominal POCUS (from FAST exam)?',
   full:'How likely is it that this finding can be inferred from abdominal point-of-care ultrasound (POCUS) from a FAST exam?'}];
const pqOf=x=>x.question||'visible';
function pocusRows(qid,k){ return S.pocus.filter(x=>x.qid===qid&&pqOf(x)===k); }
function myPocusRow(qid,k){ return S.me&&S.pocus.find(x=>x.qid===qid&&pqOf(x)===k&&x.user_id===S.me.id)||null; }
function pocusHTML(qid){
  if(!canSave()||!S.pocusOK) return '';
  let h='<div class="pocusbox">';
  PQS.forEach(pq=>{
    const row=myPocusRow(qid,pq.k), mine=row?row.rating:0, a='data-q="'+esc(qid)+'" data-k="'+pq.k+'"';
    h+='<div class="pocus"><span class="pq" title="'+esc(pq.full)+'">'+esc(pq.short)+'</span><span class="seg" role="group" aria-label="'+esc(pq.full)+'">'+
      POCUS.map(([v,l])=>'<button data-act="pocus" '+a+' data-v="'+v+'"'+(mine===v?' class="on"':'')+' aria-pressed="'+(mine===v)+'">'+l+'</button>').join('')+'</span>';
    h+='<div class="pnoterow"><input class="pnote" '+a+' maxlength="1000" aria-label="Reason for your answer: '+esc(pq.short)+'" placeholder="Optional reason (e.g., only if it is severe)"'+
       (row?' value="'+esc(row.comment||'')+'"':' disabled title="Choose a rating first"')+'><span class="hint pstat" '+a+'></span></div>';
    if(S.isAdmin){
      const why=pocusRows(qid,pq.k).filter(x=>x.comment).sort((p,q)=>p.rating-q.rating);
      if(why.length) h+='<ul class="preasons">'+why.map(x=>'<li><b>'+esc(realName(x.user_id))+'</b> · '+x.rating+' '+esc(pocusLabel(x.rating).toLowerCase())+': '+esc(x.comment)+'</li>').join('')+'</ul>';
    }
    h+='</div>';
  });
  h+='<div class="hint">'+(S.isAdmin?'<span class="tag">admin only</span> You see every reviewer’s answers; reviewers see only their own.':'Blinded: other reviewers can’t see your answers.')+'</div>';
  return h+'</div>';
}
function pocusDone(qid){ return S.pocusOK&&PQS.every(pq=>myPocusRow(qid,pq.k)); }
function pstatEl(qid,k){ return document.querySelector('.pstat[data-q="'+CSS.escape(qid)+'"][data-k="'+k+'"]'); }
function putPocus(row){ const i=S.pocus.findIndex(x=>x.qid===row.qid&&pqOf(x)===pqOf(row)&&x.user_id===row.user_id); if(i>-1) S.pocus[i]=row; else S.pocus.push(row); }
async function setPocus(qid,k,v){
  if(!canSave()||!PQS.some(p=>p.k===k)) return;
  const r0=myPocusRow(qid,k); if(r0&&r0.rating===v) return;
  const res=await S.sb.from('pocus_ratings').upsert({user_id:S.me.id,qid,question:k,rating:v,updated_at:new Date().toISOString()},{onConflict:'user_id,qid,question'}).select().single();
  if(res.error) return showBanner('Could not save your POCUS rating: '+res.error.message,'warn');
  putPocus(res.data); refreshAll();
}
async function savePocusNote(qid,k,text){
  const row=myPocusRow(qid,k); if(!row||(row.comment||'')===text) return;
  const st=pstatEl(qid,k); if(st) st.textContent='Saving…';
  const res=await S.sb.from('pocus_ratings').update({comment:text||null,updated_at:new Date().toISOString()}).eq('user_id',S.me.id).eq('qid',qid).eq('question',k).select().single();
  if(res.error){ if(st) st.textContent=''; return showBanner('Could not save your reason: '+res.error.message,'warn'); }
  putPocus(res.data); refreshAll();
  const st2=pstatEl(qid,k); if(st2){ st2.textContent='Saved'; setTimeout(()=>{ if(st2.isConnected) st2.textContent=''; },2000); }
}
function noteHTML(n,all){
  const replies=all.filter(r=>r.parent===n.key);
  const mine=S.me&&n.uid===S.me.id, st=n.status==='resolved'?'resolved':'open';
  let h='<div class="note '+(n.parent?'':st)+'" data-key="'+esc(n.key)+'"><div class="nmeta">';
  if(!n.parent) h+='<span class="ty">'+esc(n.type||'Note')+'</span><span class="st '+st+'">'+st+'</span>';
  h+='<span class="auth">'+esc(name(n.uid))+'</span><span>'+esc(ago(n.created))+(n.edited?' · edited':'')+'</span></div>';
  if(!n.parent) h+='<div class="tgt">'+esc(targetLabel(n))+(n.targetText?': “'+esc(n.targetText.length>160?n.targetText.slice(0,160)+'…':n.targetText)+'”':'')+'</div>';
  h+='<div class="ntext">'+esc(n.text)+'</div>';
  if(canSave()){
    h+='<div class="nact">';
    if(!n.parent) h+='<button data-act="reply" data-key="'+esc(n.key)+'">Reply</button>';
    if(!n.parent&&(mine||S.isAdmin)) h+='<button data-act="status" data-key="'+esc(n.key)+'">'+(st==='open'?'Mark resolved':'Reopen')+'</button>';
    if(mine) h+='<button data-act="edit" data-key="'+esc(n.key)+'">Edit</button>';
    if(mine||S.isAdmin) h+='<button class="danger" data-act="del" data-key="'+esc(n.key)+'">Delete</button>';
    h+='</div>';
  }
  if(replies.length) h+='<div class="replies">'+replies.map(r=>noteHTML(r,all)).join('')+'</div>';
  return h+'</div>';
}

/* ---------- note form ---------- */
function openForm(qid,opts){
  if(!canSave()){
    if(!S.me) return showSignIn();
    if(!S.isReviewer) return showBanner('Your email isn’t on the reviewer list yet. Ask the project owner to add '+S.me.email+'.','warn');
    if(!S.profile) return showNamePrompt();
    return;
  }
  S.forms[qid]=Object.assign({target:'overall',type:'',text:'',editKey:null,parent:null},opts||{});
  fillForm(qid);
  const slot=document.querySelector('.formslot[data-q="'+CSS.escape(qid)+'"]');
  const el=slot&&(slot.querySelector('select')||slot.querySelector('textarea')); if(el) el.focus();
}
function fillForm(qid){
  const slot=document.querySelector('.formslot[data-q="'+CSS.escape(qid)+'"]'); if(!slot) return;
  const f=S.forms[qid]; if(!f){ slot.innerHTML=''; fillDynamic(qid); return; }
  const q=QMAP[qid].q; let h='<div class="form" data-q="'+esc(qid)+'">';
  if(f.parent){
    h+='<h4>'+(f.editKey?'Edit reply':'Reply')+'</h4><textarea data-f="text" placeholder="Your reply">'+esc(f.text)+'</textarea>';
  } else {
    const tg=targetsOf(q).find(x=>x.k===f.target)||{l:'The finding as a whole',x:''};
    h+='<div class="ctx"><span class="ctxl">'+(f.editKey?'Editing note on':'Flagging')+' · '+esc(tg.l)+'</span>'+(tg.x?'<span class="ctxq">“'+esc(tg.x)+'”</span>':'')+'</div>';
    h+='<label>Issue</label><select data-f="type"><option value="">Choose an issue…</option>'+TYPES.map(x=>'<option'+(x===f.type?' selected':'')+'>'+esc(x)+'</option>').join('')+'</select>';
    h+='<label style="margin-top:10px">Note</label><textarea data-f="text" placeholder="What is imprecise or unclear here?">'+esc(f.text)+'</textarea>';
  }
  const ok=f.text.trim()&&(f.parent||f.type)&&!f.saving;
  h+='<div class="btns"><span class="hint" style="flex:1;align-self:center">'+(f.error?'<span style="color:var(--exc)">'+esc(f.error)+'</span>':'⌘/Ctrl + Enter to save')+'</span><button class="btn" data-act="cancel" data-q="'+esc(qid)+'">Cancel</button><button class="btn pri" data-act="save" data-q="'+esc(qid)+'"'+(ok?'':' disabled')+'>'+(f.saving?'Saving…':'Save')+'</button></div></div>';
  slot.innerHTML=h;
  fillDynamic(qid);
}
function refreshSaveBtn(qid){ const f=S.forms[qid]; const b=document.querySelector('.form[data-q="'+CSS.escape(qid)+'"] [data-act="save"]'); if(b) b.disabled=!(f.text.trim()&&(f.parent||f.type)&&!f.saving); }

/* ---------- writes (the server enforces who may do what) ---------- */
function upsertLocal(row){ const i=S.notesRaw.findIndex(r=>r.id===row.id); if(i>-1) S.notesRaw[i]=row; else S.notesRaw.push(row); S.cache=null; }
async function submitForm(qid){
  const f=S.forms[qid]; if(!f||!f.text.trim()||f.saving) return;
  if(!f.parent&&!f.type) return;
  const q=QMAP[qid].q; f.saving=true; f.error=''; fillForm(qid);
  let res;
  if(f.editKey){
    const patch={body:f.text.trim(), edited_at:new Date().toISOString()};
    if(!f.parent){ patch.issue_type=f.type; }
    res=await S.sb.from('notes').update(patch).eq('id',f.editKey).select().single();
  } else if(f.parent){
    res=await S.sb.from('notes').insert({qid, parent_id:f.parent, body:f.text.trim()}).select().single();
  } else {
    const t=targetsOf(q).find(t=>t.k===f.target);
    res=await S.sb.from('notes').insert({qid, target:f.target, target_text:t?t.x:'', issue_type:f.type, body:f.text.trim()}).select().single();
  }
  if(res.error){ f.saving=false; f.error='Not saved: '+res.error.message; fillForm(qid); return; }
  upsertLocal(res.data); delete S.forms[qid]; fillForm(qid); refreshAll();
}
async function setStatus(key){
  const n=allNotes().find(x=>x.key===key); if(!n) return;
  const res=await S.sb.from('notes').update({status:n.status==='resolved'?'open':'resolved'}).eq('id',key).select().single();
  if(res.error) return showBanner('Could not change the status: '+res.error.message,'warn');
  upsertLocal(res.data); refreshAll();
}
async function deleteNote(key){
  const res=await S.sb.from('notes').delete().eq('id',key);
  if(res.error) return showBanner('Could not delete the note: '+res.error.message,'warn');
  S.notesRaw=S.notesRaw.filter(r=>r.id!==key&&r.parent_id!==key); S.cache=null; refreshAll();
}
async function toggleReview(qid){
  const mine=iReviewed(qid);
  if(!mine&&!pocusDone(qid)) return showBanner('Answer both POCUS questions for this finding before marking it as reviewed.','warn');
  const res = mine ? await S.sb.from('reviews').delete().eq('user_id',S.me.id).eq('qid',qid)
                   : await S.sb.from('reviews').upsert({user_id:S.me.id,qid},{onConflict:'user_id,qid',ignoreDuplicates:true});
  if(res.error) return showBanner('Could not save your review mark: '+res.error.message,'warn');
  if(mine) S.reviews=S.reviews.filter(r=>!(r.qid===qid&&r.user_id===S.me.id)); else S.reviews.push({user_id:S.me.id,qid,reviewed_at:new Date().toISOString()});
  refreshAll();
}

/* ---------- all notes view ---------- */
function filteredNotes(){
  const f=S.fNotes, all=allNotes();
  return all.filter(n=>!n.parent).filter(n=>{
    if(f.status&&((n.status==='resolved'?'resolved':'open')!==f.status)) return false;
    if(f.type&&n.type!==f.type) return false;
    if(f.who&&n.uid!==f.who) return false;
    if(f.cat!==''&&String(QMAP[n.qid].ci)!==f.cat) return false;
    return true;
  }).sort((a,b)=>QMAP[a.qid].ci-QMAP[b.qid].ci||a.created-b.created).map(n=>({n,replies:all.filter(r=>r.parent===n.key)}));
}
function renderNotes(){
  let h='<div class="cathead"><h2>All notes</h2><p>Every reviewer’s notes, updated live.</p></div>';
  if(!S.isReviewer){ h+='<div class="empty">'+(S.me?'Your email isn’t on the reviewer list yet.':'Sign in to see everyone’s notes.')+'</div>'; $('#wrap').innerHTML=h; return; }
  const tops=allNotes().filter(n=>!n.parent), open=tops.filter(n=>n.status!=='resolved').length;
  const reviewedAny=new Set(S.reviews.map(r=>r.qid).filter(k=>QMAP[k]));
  const flaggedQ=new Set(tops.filter(n=>n.status!=='resolved').map(n=>n.qid));
  const uids=Object.keys(S.profiles);
  h+='<div class="stats"><div class="stat"><b>'+open+'</b><span>open notes</span></div><div class="stat"><b>'+(tops.length-open)+'</b><span>resolved</span></div>'+
     '<div class="stat"><b>'+flaggedQ.size+'</b><span>findings with open notes</span></div><div class="stat"><b>'+reviewedAny.size+' / '+TOTAL+'</b><span>findings reviewed by someone</span></div>'+
     '<div class="stat"><b>'+uids.length+'</b><span>reviewers signed in so far</span></div>'+
     (S.pocusOK?'<div class="stat"><b>'+new Set(S.pocus.filter(x=>QMAP[x.qid]&&(S.isAdmin||x.user_id===S.me.id)).map(x=>x.qid)).size+' / '+TOTAL+'</b><span>'+(S.isAdmin?'findings with a POCUS rating':'findings you rated for POCUS')+'</span></div>':'')+'</div>';
  const f=S.fNotes;
  h+='<div class="tools"><select data-nf="status"><option value="">Any status</option><option value="open"'+(f.status==='open'?' selected':'')+'>Open</option><option value="resolved"'+(f.status==='resolved'?' selected':'')+'>Resolved</option></select>'+
     '<select data-nf="type"><option value="">Any issue type</option>'+TYPES.map(t=>'<option'+(f.type===t?' selected':'')+'>'+esc(t)+'</option>').join('')+'</select>'+
     '<select data-nf="cat"><option value="">Any category</option>'+CATS.map((c,i)=>'<option value="'+i+'"'+(f.cat===String(i)?' selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select>'+
     '<select data-nf="who"><option value="">Any reviewer</option>'+uids.map(u=>'<option value="'+esc(u)+'"'+(f.who===u?' selected':'')+'>'+esc(name(u))+'</option>').join('')+'</select>'+
     '<span style="flex:1"></span><button class="btn" data-act="csv" title="Notes and replies matching the filters">Download notes CSV</button><button class="btn" data-act="csvprog" title="One row per finding: who reviewed it and its note counts">Download review progress</button></div>';
  const rows=filteredNotes();
  if(!rows.length) h+='<div class="empty">'+(tops.length?'No notes match these filters.':'No notes yet. In Browse, hover over any part of a finding and click its flag, or click a term.')+'</div>';
  else {
    h+='<table class="table"><thead><tr><th>Finding</th><th>Refers to</th><th>Issue</th><th>Note</th><th>Reviewer</th><th>Status</th></tr></thead><tbody>';
    rows.forEach(({n,replies})=>{ const q=QMAP[n.qid], st=n.status==='resolved'?'resolved':'open';
      h+='<tr><td><a href="#'+qHash(n.qid)+'">'+esc(q.q.question)+'</a><div class="hint">'+esc(CATS[q.ci].name)+'</div></td><td class="hint">'+esc(targetLabel(n))+(n.targetText&&n.target!=='overall'?'<div>“'+esc(n.targetText.slice(0,90))+(n.targetText.length>90?'…':'')+'”</div>':'')+'</td>'+
         '<td><span class="ty">'+esc(n.type||'')+'</span></td><td class="n">'+esc(n.text)+'</td><td>'+esc(name(n.uid))+'<div class="hint">'+esc(ago(n.created))+'</div></td><td><span class="st '+st+'">'+st+'</span></td></tr>';
      replies.forEach(r=>{ h+='<tr class="reply"><td class="hint">↳ reply</td><td></td><td></td><td class="n">'+esc(r.text)+'</td><td>'+esc(name(r.uid))+'<div class="hint">'+esc(ago(r.created))+'</div></td><td></td></tr>'; });
    });
    h+='</tbody></table>';
  }
  if(S.isAdmin) h+=adminHTML();
  $('#wrap').innerHTML=h;
}
function realName(uid){ return S.profiles[uid]||'Former reviewer'; }
function download(lines,base){
  const blob=new Blob(['﻿'+lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=base+'-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}
const cell=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
function csv(){
  const lines=[['category','finding_id','question','refers_to','referenced_text','issue_type','note','reviewer','status','created','kind'].join(',')];
  filteredNotes().forEach(({n,replies})=>{ const q=QMAP[n.qid];
    lines.push([CATS[q.ci].name,n.qid,q.q.question,targetLabel(n),n.targetText,n.type,n.text,realName(n.uid),n.status||'open',new Date(n.created).toISOString(),'note'].map(cell).join(','));
    replies.forEach(r=>lines.push([CATS[q.ci].name,n.qid,q.q.question,'','','',r.text,realName(r.uid),'',new Date(r.created).toISOString(),'reply'].map(cell).join(',')));
  });
  download(lines,'definition-review-notes');
}
/* One row per finding: who marked it reviewed and how many notes it has, flagged or not. */
function csvProgress(){
  const lines=[['category','finding_id','question','reviewed_by','times_reviewed','last_reviewed','open_notes','resolved_notes'].concat(...PQS.map(pq=>['n','mean','1_very_unlikely','2_unlikely','3_unsure','4_likely','5_very_likely','ratings','reasons'].map(c=>pq.k+'_'+c))).join(',')];
  const tops=allNotes().filter(n=>!n.parent);
  CATS.forEach(c=>c.questions.forEach(q=>{
    const rv=S.reviews.filter(r=>r.qid===q.id).sort((a,b)=>String(a.reviewed_at).localeCompare(String(b.reviewed_at)));
    const ns=tops.filter(n=>n.qid===q.id), open=ns.filter(n=>n.status!=='resolved').length;
    const last=rv.length?rv[rv.length-1].reviewed_at:'';
    const pcols=[].concat(...PQS.map(pq=>{ const pr=pocusRows(q.id,pq.k), pc=v=>pr.filter(x=>x.rating===v).length;
      return [pr.length,pr.length?(pr.reduce((t,x)=>t+x.rating,0)/pr.length).toFixed(2):'',pc(1),pc(2),pc(3),pc(4),pc(5),
        pr.map(x=>realName(x.user_id)+': '+x.rating+' ('+pocusLabel(x.rating).toLowerCase()+')').join('; '),
        pr.filter(x=>x.comment).map(x=>realName(x.user_id)+': '+x.comment).join(' | ')]; }));
    lines.push([c.name,q.id,q.question,rv.map(r=>realName(r.user_id)).join('; '),rv.length,last,open,ns.length-open].concat(pcols).map(cell).join(','));
  }));
  download(lines,'definition-review-progress');
}

/* ---------- admin: reviewer list ---------- */
function adminHTML(){
  let h='<section class="admin"><h3>Reviewers</h3><p class="hint">Only these emails can see and add notes. People sign in with the same address.</p>'+
        '<form id="addrev"><input type="email" id="newrev" placeholder="name@berkeley.edu" required><label class="hint" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="newadmin"> Admin</label><button class="btn pri" type="submit">Add</button></form><ul>';
  S.reviewersList.forEach(r=>{ h+='<li><span class="e">'+esc(r.email)+'</span>'+(r.is_admin?'<span class="tag">admin</span>':'')+
    (S.me&&r.email===S.me.email.toLowerCase()?'<span class="hint">you</span>':'<button class="linkbtn" data-act="rmrev" data-email="'+esc(r.email)+'">Remove</button>')+'</li>'; });
  return h+'</ul></section>';
}
async function loadReviewerList(){
  if(!S.isAdmin) return;
  const r=await S.sb.from('reviewers').select('email,is_admin').order('email');
  if(!r.error){ S.reviewersList=r.data||[]; if(S.view==='notes') renderNotes(); }
}

/* ---------- auth UI ---------- */
function methods(){ return CFG.SIGN_IN_METHODS||['google']; }
function showSignIn(msg){
  const m=methods(); let h='<div class="modal-bg" data-act="closemodal"><div class="modal" role="dialog" aria-modal="true"><img src="logo.png" alt="" width="56" height="56" style="display:block;margin-bottom:10px"><h2>Sign in to review</h2><p>Use the email address the project owner added to the reviewer list.</p>';
  if(m.includes('google')) h+='<button class="btn wide" data-act="google">'+GOOGLE+' Continue with Google</button>';
  if(m.includes('google')&&m.includes('email')) h+='<div class="or">or</div>';
  if(m.includes('email')) h+='<form id="emailform"><input type="email" id="email" placeholder="name@berkeley.edu" required autocomplete="email"><button class="btn pri wide" type="submit">Email me a sign-in link</button></form>';
  h+='<div class="msg" id="authmsg">'+(msg?esc(msg):'')+'</div></div></div>';
  $('#modal').innerHTML=h;
  const e=$('#email'); if(e) e.focus();
}
function showNamePrompt(){
  const guess=(S.me&&S.me.fullName)||'';
  $('#modal').innerHTML='<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true"><h2>What name should others see?</h2><p>Your name appears beside your notes.</p>'+
    '<form id="nameform"><input type="text" id="dname" maxlength="80" required value="'+esc(guess)+'"><button class="btn pri wide" type="submit">Continue</button></form><div class="msg" id="namemsg"></div></div></div>';
  const i=$('#dname'); if(i){ i.focus(); i.select(); }
}
function closeModal(){ $('#modal').innerHTML=''; }
function redirectUrl(){ return location.origin+location.pathname; }

/* ---------- light / dark theme ---------- */
const SUN='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.85.85M11.75 11.75l.85.85M3.4 12.6l.85-.85M11.75 4.25l.85-.85"/></svg>';
const MOON='<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1z"/></svg>';
const darkMQ=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)'):null;
function theme(){ return document.documentElement.getAttribute('data-theme')||(darkMQ&&darkMQ.matches?'dark':'light'); }
function paintThemeBtn(){ const b=$('#themebtn'); if(!b) return; const d=theme()==='dark';
  b.innerHTML=d?SUN:MOON; const l=d?'Switch to light mode':'Switch to dark mode'; b.title=l; b.setAttribute('aria-label',l); }
function toggleTheme(){ const t=theme()==='dark'?'light':'dark'; document.documentElement.setAttribute('data-theme',t);
  try{ localStorage.setItem('theme',t); }catch(e){} paintThemeBtn(); }
if(darkMQ&&darkMQ.addEventListener) darkMQ.addEventListener('change',paintThemeBtn);
paintThemeBtn();

/* ---------- view plumbing ---------- */
function showBanner(msg,kind,action){ const b=$('#banner'); if(!msg){ b.className='banner'; b.innerHTML=''; return; }
  b.className='banner show '+(kind||'info'); b.innerHTML=esc(msg)+(action?' <button class="btn" data-act="'+action.act+'">'+esc(action.label)+'</button>':''); }
function refreshAll(){
  if(!DATA) return;
  updateNav();
  if(S.view==='notes') renderNotes(); else document.querySelectorAll('.card').forEach(el=>fillDynamic(el.dataset.q));
  updateWho();
}
function updateWho(){
  const w=$('#who');
  if(!S.sb){ w.innerHTML=''; return; }
  if(!S.me){ w.innerHTML='<button class="btn" data-act="signin">Sign in</button>'; return; }
  const done=S.reviews.filter(r=>r.user_id===S.me.id&&QMAP[r.qid]).length;
  w.innerHTML='<b>'+esc((S.profile&&S.profile.display_name)||S.me.email)+'</b> <button class="linkbtn" data-act="signout">Sign out</button><br>'+
    (S.isReviewer?'You have reviewed '+done+' of '+TOTAL:'Not on the reviewer list');
}
function setView(v){ S.view=v; $('#tab-browse').classList.toggle('on',v==='browse'); $('#tab-notes').classList.toggle('on',v==='notes');
  if(v==='notes'){ renderNotes(); loadReviewerList(); } else renderBrowse(); updateNav(); $('#main').scrollTop=0; }
function goQuestion(id){
  const m=QMAP[id]; if(!m) return;
  if(filtering()&&!matches(m.q)){ S.q=''; S.onlyNotes=false; S.onlyUnreviewed=false; renderNav(); }
  if(S.view!=='browse'||(!filtering()&&S.cat!==m.ci)||!document.getElementById(qHash(id))){ if(!filtering()) S.cat=m.ci; setView('browse'); }
  requestAnimationFrame(()=>{ const el=document.getElementById(qHash(id)); if(el){ el.scrollIntoView({block:'start'}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } });
  $('#body').classList.remove('navopen');
}
function route(){
  const h=location.hash.slice(1);
  if(h==='notes') return setView('notes');
  if(HASH2Q[h]) return goQuestion(HASH2Q[h]);
  const ci=CATHASH.indexOf(h); if(ci>-1){ S.cat=ci; if(filtering()){ S.q=''; S.onlyNotes=false; S.onlyUnreviewed=false; renderNav(); } return setView('browse'); }
  setView('browse');
}

/* ---------- events ---------- */
document.addEventListener('click',async e=>{
  const t=e.target.closest('[data-act],[data-cat],#tab-browse,#tab-notes,#navtoggle,.qlist a'); if(!t) return;
  if(t.dataset.act==='closemodal'){ if(e.target===t) closeModal(); return; }
  if(t.id==='tab-browse'){ history.replaceState(null,'',location.pathname+location.search+'#'+CATHASH[S.cat]); return setView('browse'); }
  if(t.id==='tab-notes'){ location.hash='notes'; return; }
  if(t.id==='navtoggle'){ $('#body').classList.toggle('navopen'); return; }
  if(t.dataset.cat!=null){ const ci=+t.dataset.cat; S.cat=ci; if(filtering()){ S.q=''; S.onlyNotes=false; S.onlyUnreviewed=false; renderNav(); }
    if(location.hash.slice(1)===CATHASH[ci]) setView('browse'); else location.hash=CATHASH[ci]; $('#body').classList.remove('navopen'); return; }
  if(t.matches('.qlist a')){ e.preventDefault(); const id=t.dataset.q; if(location.hash.slice(1)===qHash(id)) goQuestion(id); else location.hash=qHash(id); return; }
  const a=t.dataset.act;
  if(a==='theme') return toggleTheme();
  if(a==='signin') return showSignIn();
  if(a==='signout'){ await S.sb.auth.signOut(); return; }
  if(a==='google'){ const r=await S.sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirectUrl()}}); if(r.error) $('#authmsg').textContent=r.error.message; return; }
  if(a==='add') return openForm(t.dataset.q,{target:t.dataset.t||'overall'});
  if(a==='cancel'){ delete S.forms[t.dataset.q]; return fillForm(t.dataset.q); }
  if(a==='save') return submitForm(t.dataset.q);
  if(a==='review') return toggleReview(t.dataset.q);
  if(a==='pocus') return setPocus(t.dataset.q,t.dataset.k,+t.dataset.v);
  if(a==='reply'){ const n=allNotes().find(x=>x.key===t.dataset.key); if(n) openForm(n.qid,{parent:n.key}); return; }
  if(a==='edit'){ const n=allNotes().find(x=>x.key===t.dataset.key); if(n) openForm(n.qid,{editKey:n.key,parent:n.parent||null,target:n.target||'overall',type:n.type||'',text:n.text||''}); return; }
  if(a==='status') return setStatus(t.dataset.key);
  if(a==='del'){
    if(!t.classList.contains('arm')){ t.classList.add('arm'); t.textContent='Click again to delete'; setTimeout(()=>{ if(t.isConnected){ t.classList.remove('arm'); t.textContent='Delete'; } },3500); return; }
    return deleteNote(t.dataset.key);
  }
  if(a==='csv') return csv();
  if(a==='csvprog') return csvProgress();
  if(a==='rmrev'){
    if(!t.classList.contains('arm')){ t.classList.add('arm'); t.textContent='Click again to remove'; setTimeout(()=>{ if(t.isConnected){ t.classList.remove('arm'); t.textContent='Remove'; } },3500); return; }
    const r=await S.sb.from('reviewers').delete().eq('email',t.dataset.email); if(r.error) showBanner(r.error.message,'warn'); return loadReviewerList();
  }
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  const id=e.target.id;
  if(id==='emailform'){
    const email=$('#email').value.trim(); const msg=$('#authmsg'); msg.className='msg'; msg.textContent='Sending…';
    const r=await S.sb.auth.signInWithOtp({email,options:{emailRedirectTo:redirectUrl()}});
    if(r.error){ msg.className='msg err'; msg.textContent=r.error.message; }
    else msg.textContent='Check your inbox for a sign-in link from '+(CFG.EMAIL_SENDER_HINT||'this site')+'. Open it in this same browser.';
  }
  if(id==='nameform'){
    const dn=$('#dname').value.trim(); if(!dn) return;
    const r=await S.sb.from('profiles').upsert({id:S.me.id,display_name:dn,updated_at:new Date().toISOString()}).select().single();
    if(r.error){ $('#namemsg').className='msg err'; $('#namemsg').textContent=r.error.message; return; }
    S.profile=r.data; S.profiles[S.me.id]=dn; closeModal(); refreshAll();
  }
  if(id==='addrev'){
    const email=$('#newrev').value.trim().toLowerCase(); if(!email) return;
    const r=await S.sb.from('reviewers').insert({email,is_admin:$('#newadmin').checked});
    if(r.error) showBanner('Could not add '+email+': '+r.error.message,'warn'); else showBanner('');
    loadReviewerList();
  }
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.id==='search'){ S.q=t.value; $('#nav').classList.toggle('searching',filtering()); updateNav(); if(S.view!=='browse') setView('browse'); else renderBrowse(); return; }
  const form=t.closest&&t.closest('.form'); if(form&&t.dataset.f){ const f=S.forms[form.dataset.q]; if(f){ f[t.dataset.f]=t.value; refreshSaveBtn(form.dataset.q); } }
});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.id==='onlyNotes'||t.id==='onlyUnrev'){ if(t.id==='onlyNotes') S.onlyNotes=t.checked; else S.onlyUnreviewed=t.checked; $('#nav').classList.toggle('searching',filtering()); updateNav(); if(S.view!=='browse') setView('browse'); else renderBrowse(); return; }
  if(t.classList&&t.classList.contains('pnote')) return savePocusNote(t.dataset.q,t.dataset.k,t.value.trim());
  if(t.dataset.nf){ S.fNotes[t.dataset.nf]=t.value; renderNotes(); return; }
  const form=t.closest&&t.closest('.form'); if(form&&t.dataset.f){ const f=S.forms[form.dataset.q]; if(f){ f[t.dataset.f]=t.value; refreshSaveBtn(form.dataset.q); } }
});
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){ const form=e.target.closest&&e.target.closest('.form'); if(form) submitForm(form.dataset.q); }
  if(e.key==='Enter'&&e.target.classList&&e.target.classList.contains('pnote')){ e.preventDefault(); e.target.blur(); }
  if(e.key==='Escape'&&$('#modal').innerHTML&&!$('#nameform')) closeModal();
});
window.addEventListener('hashchange',route);

/* ---------- data loading and live updates ---------- */
let reloadTimer=null, channel=null;
function scheduleReload(){ clearTimeout(reloadTimer); reloadTimer=setTimeout(loadAll,250); }
// Supabase returns at most 1000 rows per request, so read each table in pages.
async function fetchAll(table,cols,order){
  const out=[], step=1000;
  for(let from=0;;from+=step){
    let q=S.sb.from(table).select(cols); order.forEach(c=>{ q=q.order(c); });
    const r=await q.range(from,from+step-1);
    if(r.error) return {error:r.error, data:[]};
    out.push(...r.data); if(r.data.length<step) return {data:out};
  }
}
async function loadAll(){
  if(!S.isReviewer) return;
  const [n,r,p,pc]=await Promise.all([
    fetchAll('notes','*',['created_at','id']),
    fetchAll('reviews','user_id,qid,reviewed_at',['qid','user_id']),
    fetchAll('profiles','id,display_name',['id']),
    fetchAll('pocus_ratings','user_id,qid,question,rating,comment,updated_at',['qid','question','user_id'])]);
  const err=n.error||r.error||p.error;
  if(err){ showBanner('Notes could not be loaded: '+err.message,'warn'); return; }
  S.notesRaw=n.data||[]; S.reviews=r.data||[]; S.profiles={}; (p.data||[]).forEach(x=>S.profiles[x.id]=x.display_name); S.cache=null;
  S.pocusOK=!pc.error; S.pocus=pc.data||[];
  if(pc.error&&S.isAdmin) showBanner('POCUS ratings are off until you run the files in upgrades/ (001, then 002) in the Supabase SQL Editor ('+pc.error.message+').','warn');
  refreshAll();
}
function subscribe(){
  if(channel) return;
  channel=S.sb.channel('review-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'notes'},scheduleReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'reviews'},scheduleReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'profiles'},scheduleReload)
    .on('postgres_changes',{event:'*',schema:'public',table:'pocus_ratings'},scheduleReload)
    .subscribe(status=>{ if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') showBanner('Live updates paused. New notes from others will appear when you return to this tab.','warn'); });
}
document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&S.isReviewer) scheduleReload(); });

let currentUid;
async function handleSession(session){
  const uid=session?session.user.id:null;
  if(uid===currentUid) return; currentUid=uid;
  if(!session){
    S.me=null; S.isReviewer=false; S.isAdmin=false; S.profile=null; S.notesRaw=[]; S.reviews=[]; S.pocus=[]; S.pocusOK=false; S.profiles={}; S.cache=null;
    if(channel){ S.sb.removeChannel(channel); channel=null; }
    showBanner('You can browse the definitions. Sign in to see and add notes.','info',{act:'signin',label:'Sign in'});
    refreshAll(); return;
  }
  const u=session.user; const md=u.user_metadata||{};
  S.me={id:u.id,email:u.email||'',fullName:md.full_name||md.name||''};
  closeModal(); showBanner('');
  if(location.search.includes('code=')) history.replaceState(null,'',location.pathname+location.hash);
  const [rv,ad]=await Promise.all([S.sb.rpc('is_reviewer'),S.sb.rpc('is_admin')]);
  S.isReviewer=!!rv.data; S.isAdmin=!!ad.data;
  if(!S.isReviewer){ showBanner('You’re signed in as '+S.me.email+', but that address isn’t on the reviewer list. Ask the project owner to add it.','warn'); refreshAll(); return; }
  const pr=await S.sb.from('profiles').select('id,display_name').eq('id',u.id).maybeSingle();
  S.profile=pr.data||null;
  if(!S.profile) showNamePrompt();
  await loadAll(); subscribe();
  if(S.view==='notes') loadReviewerList();
}

/* ---------- start ---------- */
async function start(){
  try{
    const r=await fetch(CFG.FINDINGS_URL||'findings.json',{cache:'no-cache'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    DATA=await r.json();
  }catch(err){
    $('#wrap').innerHTML='<div class="empty">Could not load findings.json ('+esc(err.message)+'). If you opened this file directly from your disk, serve the folder instead, for example with <code>python3 -m http.server</code>.</div>';
    return;
  }
  CATS=DATA.categories;
  CATS.forEach((c,ci)=>c.questions.forEach(q=>{ QMAP[q.id]={q,ci}; HASH2Q[qHash(q.id)]=q.id; }));
  TOTAL=Object.keys(QMAP).length; CATHASH=CATS.map(c=>'c-'+slug(c.name));
  const title=CFG.TITLE||'Findings definition review';
  document.title=title; $('#title').textContent=title;
  renderNav(); route();

  const configured=CFG.SUPABASE_URL&&CFG.SUPABASE_ANON_KEY&&!/YOUR-PROJECT|YOUR_ANON/.test(CFG.SUPABASE_URL+CFG.SUPABASE_ANON_KEY);
  if(!configured||!window.supabase){
    showBanner(!configured?'Notes are off: add your Supabase URL and anon key to config.js.':'Notes are off: the Supabase library failed to load. Check your internet connection.','warn');
    return;
  }
  S.sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_ANON_KEY,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
  S.sb.auth.onAuthStateChange((_ev,session)=>{ setTimeout(()=>handleSession(session),0); });
  const {data}=await S.sb.auth.getSession();
  handleSession(data.session);
}
start();
})();
