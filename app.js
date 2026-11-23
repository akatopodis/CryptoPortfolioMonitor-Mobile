'use strict';
const REPOSITORY = 'akatopodis/CryptoPortfolioMonitor';
const SNAPSHOT_URL = `https://api.github.com/repos/${REPOSITORY}/contents/cloud/snapshot.json`;
const VERIFY_URL = `https://api.github.com/repos/${REPOSITORY}/contents/portfolio.json`;
// This file is PRIVATE. Never put positions or prices paid into the public PWA repository.
const BASIS_URL = `https://api.github.com/repos/${REPOSITORY}/contents/cloud/cost_basis.json`;
const SESSION_KEY='cpm_pwa_session_token_v1';
const VAULT_KEY='cpm_pwa_encrypted_token_v1';
const dom = Object.fromEntries([
 'dashboard','login-screen','status','refresh','lock','last-updated','total','total-change','daily-change',
 'coin-count','source','small-count','coins-desktop','coins-mobile','search','sort','footer-update','usd-btn',
 'eur-btn','history-chart','chart-wrap','chart-tooltip','chart-placeholder','chart-range','chart-currency',
 'chart-reset','chart-zoom-in','chart-zoom-out','chart-detail','chart-stats','token','remember','remember-pass-wrap','remember-pass','connect','login-error','setup-section',
 'unlock-section','unlock-pass','unlock','use-new-token',
 'analysis-select','insight-usd','insight-eur','insight-share','insight-day','insight-caption-share','insight-focus-title','insight-note',
 'reference-note','result-usd','result-eur','result-coverage','cost-sync-notice',
 'insight-result-usd','insight-result-eur','insight-result-pct','insight-result-info',
 'brief-freshness','brief-breadth','brief-mover','brief-concentration','brief-allocation','mobile-dock'
].map(id=>[id,document.getElementById(id)]));
const state = {token:'', snapshot:null, costBasis:null, currency:'USD', busy:false, chartPoints:[], chartBounds:null, selectedPoint:-1,chartDays:7,chartZoom:1};
// Gesture state lives only in the browser; it never changes the portfolio or cloud records.
const chartPinch = {active:false, distance:0, zoomAtStart:1};
const fmtNum=(v,max=2)=>new Intl.NumberFormat('el-GR',{maximumFractionDigits:max,minimumFractionDigits:max}).format(Number(v));
function money(value){if(value==null||!Number.isFinite(+value))return '—';const n=+value;return (state.currency==='USD'?'$':'€')+fmtNum(n,2);}
function priceFmt(value){if(value==null||!Number.isFinite(+value))return '—';const n=+value;const decimals=n<.0001?8:n<.01?6:n<1?5:2;return (state.currency==='USD'?'$':'€')+new Intl.NumberFormat('el-GR',{maximumFractionDigits:decimals}).format(n);}
function percent(v){if(v==null||!Number.isFinite(+v))return '—';return (+v>=0?'+':'')+fmtNum(v,2)+'%';}
function signedMoney(v,currency='USD'){
  if(v==null||!Number.isFinite(v))return '—';
  return (v<0?'−':v>0?'+':'')+(currency==='USD'?'$':'€')+fmtNum(Math.abs(v),2);
}
function asPositiveNumber(v){return typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;}
function validateCostBasis(data){
  if(!data||data.schema!==1||typeof data.cost_usd!=='object'||data.cost_usd===null||Array.isArray(data.cost_usd))throw Error('Μη έγκυρα δεδομένα κόστους στο ιδιωτικό GitHub.');
  const safe={};
  for(const [sym,raw] of Object.entries(data.cost_usd)){
    if(!/^[A-Z0-9]{2,16}$/.test(sym))continue;
    const x=asPositiveNumber(raw);
    if(x!==null)safe[sym]=x;
  }
  return {schema:1,cost_usd:safe,updated_at:typeof data.updated_at==='string'?data.updated_at:null};
}
async function getOptionalCostBasis(token){
  try{return validateCostBasis(await getPrivateJson(token,BASIS_URL));}
  catch(error){if(error.code==='not_found')return null;throw error;}
}
// Uses the SAME full-position average purchase price as the Windows desktop.
// EUR is a current-FX translation (NOT historical EUR acquisition cost).
function coinCostResult(coin){
  const avg=state.costBasis?.cost_usd?.[coin.symbol];
  if(asPositiveNumber(avg)===null||!(Number(coin.amount)>0)||!(Number(coin.price_usd)>0)||!(Number(coin.price_eur)>0))return null;
  const qty=Number(coin.amount),usd=qty*(Number(coin.price_usd)-avg);
  return {usd,eur:usd*(Number(coin.price_eur)/Number(coin.price_usd)),
    invested:qty*avg,qty,avg};
}
function portfolioCostResult(){
  const coins=state.snapshot?.coins||[];let usd=0,eur=0,invested=0,covered=0,missing=[];
  for(const c of coins){
    if(!(Number(c.amount)>0))continue;
    const entry=coinCostResult(c);
    if(entry){usd+=entry.usd;eur+=entry.eur;invested+=entry.invested;covered++;}
    else missing.push(c.symbol);
  }
  return {usd,eur,invested,covered,missing,complete:covered>0&&!missing.length,
    percent:invested>0?usd/invested*100:null};
}

function direction(v){return v==null||!Number.isFinite(+v)?'flat':+v>0?'up':+v<0?'down':'flat';}
function text(id,value){dom[id].textContent=value;}
function div(cls,value){const e=document.createElement('div');if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;}
function showError(message){dom['login-error'].textContent=message;dom['login-error'].hidden=false;}
function clearError(){dom['login-error'].hidden=true;dom['login-error'].textContent='';}
function setStatus(kind,message){dom.status.className='top-status '+kind;dom.status.replaceChildren();let dot=document.createElement('i');dom.status.append(dot,document.createTextNode(message));}
async function getPrivateJson(token,url){
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),18000);
  try{
    const response=await fetch(url,{headers:{'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28'},cache:'no-store',signal:controller.signal});
    if(response.status===401||response.status===403)throw Error('Το GitHub token δεν είναι έγκυρο ή δεν έχει Contents: Read-only.');
    if(response.status===404){const e=new Error('Το cloud snapshot δεν έχει δημιουργηθεί ακόμη. Περίμενε τον επόμενο έλεγχο GitHub Actions.');e.code='not_found';throw e;}
    if(response.status===429)throw Error('Προσωρινό όριο GitHub API. Δοκίμασε σε λίγο.');
    if(!response.ok)throw Error('GitHub HTTP '+response.status);
    const result=await response.json();
    if(typeof result.content!=='string'||result.encoding!=='base64')throw Error('Μη αναμενόμενη απάντηση GitHub.');
    const raw=atob(result.content.replace(/\s/g,''));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(e){if(e.name==='AbortError')throw Error('Η σύνδεση καθυστέρησε. Έλεγξε το Internet.');throw e;}
  finally{clearTimeout(timeout);}
}
function validateSnapshot(data){
  if(!data||data.schema!==1||typeof data.updated_at!=='string'||!Array.isArray(data.coins)||!data.total)throw Error('Μη συμβατό cloud snapshot.');
  if(!Number.isFinite(+data.total.usd)||!Number.isFinite(+data.total.eur)||!data.coins.every(c=>typeof c.symbol==='string'&&Number.isFinite(+c.value_usd)&&Number.isFinite(+c.value_eur)))throw Error('Μη έγκυρα δεδομένα αποτίμησης.');
  return data;
}
function bytesB64(bytes){return btoa(String.fromCharCode(...bytes));}
function b64Bytes(str){return Uint8Array.from(atob(str),c=>c.charCodeAt(0));}
async function deriveKey(password,salt,usage){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,usage);
}
async function storeEncryptedToken(token,password){
  const salt=crypto.getRandomValues(new Uint8Array(16));const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveKey(password,salt,['encrypt']);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(token));
  localStorage.setItem(VAULT_KEY,JSON.stringify({v:1,salt:bytesB64(salt),iv:bytesB64(iv),data:bytesB64(new Uint8Array(ciphertext))}));
}
async function unlockEncryptedToken(password){
  const record=JSON.parse(localStorage.getItem(VAULT_KEY)||'null');if(!record||record.v!==1)throw Error('Δεν βρέθηκε αποθηκευμένο κλειδί.');
  const key=await deriveKey(password,b64Bytes(record.salt),['decrypt']);
  try{const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64Bytes(record.iv)},key,b64Bytes(record.data));return new TextDecoder().decode(raw);}catch{throw Error('Λανθασμένος κωδικός ξεκλειδώματος.');}
}
async function beginSession(token,rememberPassword=''){
  if(state.busy)return;
  state.busy=true;dom.connect.disabled=true;dom.unlock.disabled=true;clearError();setStatus('warn','Σύνδεση…');
  try{
    let snapshot;
    try{snapshot=validateSnapshot(await getPrivateJson(token,SNAPSHOT_URL));}
    catch(e){
      if(e.code==='not_found'){
        await getPrivateJson(token,VERIFY_URL); // distinguish missing snapshot from bad token
      }
      throw e;
    }
    let costBasis=null, costBasisError='';
    try{costBasis=await getOptionalCostBasis(token);}catch(err){costBasisError=err.message||'Αδυναμία ανάγνωσης στοιχείων αγοράς';}
    if(rememberPassword){await storeEncryptedToken(token,rememberPassword);}
    state.token=token;
    sessionStorage.setItem(SESSION_KEY,token);
    state.snapshot=snapshot;
    state.costBasis=costBasis;
    state.costBasisError=costBasisError;
    dom['login-screen'].hidden=true;dom.dashboard.hidden=false;dom['mobile-dock'].hidden=false;
    render();
  }catch(e){setStatus('fail','Αποσυνδεδεμένο');showError(e.message||'Αποτυχία σύνδεσης.');}
  finally{state.busy=false;dom.connect.disabled=false;dom.unlock.disabled=false;}
}
function render(){
  const s=state.snapshot;if(!s)return;
  const isUSD=state.currency==='USD';
  dom['usd-btn'].classList.toggle('active',isUSD);dom['eur-btn'].classList.toggle('active',!isUSD);
  const ageMinutes=(Date.now()-Date.parse(s.updated_at))/60000;
  setStatus(ageMinutes>45?'warn':'online',ageMinutes>45?'Παλιές τιμές':'Cloud online');
  text('last-updated','Τελευταία cloud καταγραφή: '+new Date(s.updated_at).toLocaleString('el-GR',{dateStyle:'medium',timeStyle:'short'})+(ageMinutes>45?' · ΠΑΛΙΕΣ ΤΙΜΕΣ':''));
  text('total',money(s.total[isUSD?'usd':'eur']));
  const report=portfolioCostResult();
  // The reference baseline is NOT purchase cost, and must NEVER look like P/L.
  const delta=isUSD?s.total.change_from_baseline_usd:s.total.change_from_baseline_eur_est;
  text('reference-note','Μεταβολή από βάση αναφοράς (όχι από τιμές αγοράς): '+percent(s.total.change_from_baseline_pct)+' · '+signedMoney(delta,state.currency));
  dom['reference-note'].className='reference-note';
  dom['total-change'].className='movement '+(report.covered?direction(report.usd):'flat');
  text('total-change',report.covered?(signedMoney(isUSD?report.usd:report.eur,state.currency)+' · '+percent(report.percent)+(report.complete?'':' · ΜΕΡΙΚΟ')):'Δεν υπάρχουν στοιχεία κόστους');
  text('result-usd',report.covered?signedMoney(report.usd,'USD'):'—');
  text('result-eur',report.covered?signedMoney(report.eur,'EUR'):'—');
  dom['result-usd'].className=report.covered?direction(report.usd):'flat';
  dom['result-eur'].className=report.covered?direction(report.eur):'flat';
  text('result-coverage',report.covered+'/'+(report.covered+report.missing.length)+' θέσεις'+(report.complete?' · ΣΥΝΟΛΟ':' · ΜΕΡΙΚΟ'));
  text('cost-sync-notice',report.complete?'Υπολογισμός με μέση τιμή αγοράς ανά coin. EUR: μετατροπή με τρέχουσα ισοτιμία.':
    (report.covered?'Λείπουν τιμές αγοράς: '+report.missing.join(', ')+'. Εμφανίζεται μόνο το γνωστό μέρος.':
      'Δεν έχουν συγχρονιστεί τιμές αγοράς από τα Windows. Η μεταβολή από βάση αναφοράς δεν είναι οικονομικό αποτέλεσμα.')+
    (state.costBasisError?' · GitHub: '+state.costBasisError:''));
  text('daily-change',percent(s.total.day_pct_est));dom['daily-change'].className=direction(s.total.day_pct_est);
  text('coin-count',String(s.coins.length));text('small-count',String(s.coins.length));text('source','CoinGecko · GitHub Actions');
  text('footer-update','Cloud: '+new Date(s.updated_at).toLocaleString('el-GR'));
  text('chart-currency',state.currency);
  renderCoins();renderInsights();renderMarketBrief();drawChart();
}
// Per-coin insights are computed from the authenticated private snapshot only.
// The public PWA shell ships no holdings, tokens or fabricated coin history.
// Read-only analytics: computed from the currently authenticated snapshot.
function renderMarketBrief(){
  const snapshot=state.snapshot;if(!snapshot)return;
  const coins=snapshot.coins.filter(c=>Number.isFinite(+c.value_usd)&&+c.value_usd>=0);
  const sorted=[...coins].sort((a,b)=>+b.value_usd-+a.value_usd);
  const valid=coins.filter(c=>typeof c.day_pct==='number'&&Number.isFinite(c.day_pct));
  const rising=valid.filter(c=>c.day_pct>0).length, falling=valid.filter(c=>c.day_pct<0).length;
  text('brief-breadth',rising+' ↑ / '+falling+' ↓'+(valid.length<coins.length?' · '+(coins.length-valid.length)+' χωρίς στοιχεία':''));
  const mover=[...valid].sort((a,b)=>Math.abs(b.day_pct)-Math.abs(a.day_pct))[0];
  text('brief-mover',mover?mover.symbol+' '+percent(mover.day_pct):'Χωρίς διαθέσιμη μεταβολή');
  dom['brief-mover'].className=mover?direction(mover.day_pct):'flat';
  const total=sorted.reduce((sum,c)=>sum+Number(c.value_usd),0);
  const top=sorted.slice(0,3).reduce((sum,c)=>sum+Number(c.value_usd),0);
  text('brief-concentration',total>0?fmtNum(top/total*100,1)+'%':'—');
  const updated=Date.parse(snapshot.updated_at);
  const age=(Date.now()-updated)/60000,stale=!Number.isFinite(age)||age>45;
  text('brief-freshness',stale?'ΠΑΛΙΕΣ ΤΙΜΕΣ':'ΕΝΗΜΕΡΩΜΕΝΟ');
  dom['brief-freshness'].classList.toggle('stale',stale);
  const wrap=dom['brief-allocation'];wrap.replaceChildren();
  if(total<=0)return;
  const colors=['#669cf8','#34d5a2','#fac666','#ae91ff','#f78491','#49c7e0','#f0a178','#c0d477','#f27abf','#7a93a8'];
  const bar=div('brief-allocation-bar');const legend=div('brief-allocation-legend');
  sorted.forEach((c,i)=>{
    const pct=100*Number(c.value_usd)/total;
    const piece=div('brief-segment');piece.style.width=pct+'%';piece.style.background=colors[i%colors.length];
    piece.title=c.symbol+' '+fmtNum(pct,2)+'%';bar.append(piece);
    const item=div('brief-legend-item');const dot=div('brief-dot');dot.style.background=colors[i%colors.length];
    item.append(dot,div('',c.symbol+' '+fmtNum(pct,1)+'%'));legend.append(item);
  });
  wrap.append(bar,legend);
}
function renderInsights(){
  const s=state.snapshot;if(!s)return;
  const select=dom['analysis-select'];const requested=select.value||'portfolio';
  const names=s.coins.map(c=>c.symbol);
  if(select.options.length!==names.length+1||names.some((n,i)=>select.options[i+1]?.value!==n)){
    select.replaceChildren();
    const all=document.createElement('option');all.value='portfolio';all.textContent='Σύνολο χαρτοφυλακίου';select.append(all);
    for(const sym of names){const o=document.createElement('option');o.value=sym;o.textContent=sym+' · ανάλυση';select.append(o);}
    select.value=names.includes(requested)?requested:'portfolio';
  }
  const currency=state.currency,coin=s.coins.find(c=>c.symbol===select.value);
  if(!coin){
    text('insight-usd','$'+fmtNum(s.total.usd,2));text('insight-eur','€'+fmtNum(s.total.eur,2));
    const sorted=[...s.coins].sort((a,b)=>Number(b.value_usd)-Number(a.value_usd));
    const top3=sorted.slice(0,3).reduce((sum,c)=>sum+(+c.value_usd),0);
    const share=s.total.usd?top3/s.total.usd*100:0;
    text('insight-caption-share','ΣΥΓΚΕΝΤΡΩΣΗ TOP 3');text('insight-share',fmtNum(share,1)+'%');
    text('insight-day',percent(s.total.day_pct_est));dom['insight-day'].className=direction(s.total.day_pct_est);
    text('insight-focus-title','PORTFOLIO  /  OVERVIEW');
    text('insight-note',s.coins.length+' νομίσματα · Top 3: '+sorted.slice(0,3).map(c=>c.symbol).join(', ')+' · Επιλογή coin από το μενού.');
  }else{
    text('insight-usd','$'+fmtNum(coin.value_usd,2));text('insight-eur','€'+fmtNum(coin.value_eur,2));
    text('insight-caption-share','ΜΕΡΙΔΙΟ ΣΤΟ PORTFOLIO');
    text('insight-share',fmtNum(coin.weight_pct,2)+'%');
    text('insight-day',percent(coin.day_pct));dom['insight-day'].className=direction(coin.day_pct);
    text('insight-focus-title',coin.symbol+'  /  ASSET DETAIL');
    text('insight-note','Ποσότητα '+fmtNum(coin.amount,coin.amount<1?6:4)+' · Τιμή '+priceFmt(coin[currency==='USD'?'price_usd':'price_eur'])+' · Το παραπάνω γράφημα είναι του συνόλου.');
  }
  // Actual purchase-cost results for the selected scope; never infer from baseline.
  const report=coin?coinCostResult(coin):portfolioCostResult();
  const known=coin?!!report:report.covered>0;
  const result=coin?report:report;
  text('insight-result-usd',known?signedMoney(result.usd,'USD'):'—');
  text('insight-result-eur',known?signedMoney(result.eur,'EUR'):'—');
  text('insight-result-pct',known?percent(coin?result.usd/result.invested*100:result.percent):'—');
  for(const id of ['insight-result-usd','insight-result-eur','insight-result-pct'])dom[id].className=known?direction(result.usd):'flat';
  text('insight-result-info',known?(coin?'Από μέση τιμή αγοράς '+coin.symbol+' (USD) · EUR στην τρέχουσα ισοτιμία':
    (report.complete?'Αποτέλεσμα όλων των θέσεων':'ΜΕΡΙΚΟ '+report.covered+'/'+(report.covered+report.missing.length)+' · Λείπουν: '+report.missing.join(', '))):
    (coin?'Δεν υπάρχει τιμή αγοράς για το '+coin.symbol:'Δεν υπάρχουν διαθέσιμα στοιχεία κόστους.'));
}
function getSortedCoins(){
  const filtered=state.snapshot.coins.filter(c=>c.symbol.toLowerCase().includes(dom.search.value.trim().toLowerCase()));
  const key=dom.sort.value;
  filtered.sort((a,b)=>key==='name'?a.symbol.localeCompare(b.symbol):key==='dayup'?(b.day_pct??-1e10)-(a.day_pct??-1e10):key==='daydown'?(a.day_pct??1e10)-(b.day_pct??1e10):((state.currency==='USD'?b.value_usd:b.value_eur)-(state.currency==='USD'?a.value_usd:a.value_eur)));
  return filtered;
}
function renderCoins(){
  const coins=getSortedCoins();const desktop=document.createDocumentFragment();const mobile=document.createDocumentFragment();
  coins.forEach(c=>{
    const amount=fmtNum(c.amount,c.amount<1?6:4);const value=money(c[state.currency==='USD'?'value_usd':'value_eur']);const price=priceFmt(c[state.currency==='USD'?'price_usd':'price_eur']);
    const day=percent(c.day_pct);const dir=direction(c.day_pct);
    const row=div('coin-row');
    const sym=div('',c.symbol);sym.className='ticker';sym.append(div('coin-sub',c.id));
    row.append(sym,div('',amount),div('',price),div('coin-value',value));
    const dayCell=div();dayCell.append(div('day '+dir,day));row.append(dayCell);
    const allo=div('allocation');const bar=div('allocation-bar');const fill=document.createElement('i');fill.style.width=Math.max(0,Math.min(100,c.weight_pct))+'%';bar.append(fill);
    allo.append(bar,div('allocation-label',fmtNum(c.weight_pct,1)+'%'));row.append(allo);desktop.append(row);
    const card=div('mobile-coin');card.setAttribute('role','button');card.tabIndex=0;
    card.setAttribute('aria-label','Ανάλυση '+c.symbol);
    const showCoin=()=>{dom['analysis-select'].value=c.symbol;renderInsights();document.getElementById('asset-intelligence').scrollIntoView({behavior:'smooth',block:'start'});};
    card.addEventListener('click',showCoin);
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showCoin();}});
    const head=div('mobile-top');const left=div();left.append(div('ticker',c.symbol),div('mobile-amount',amount+' '+c.symbol));
    const right=div();right.style.textAlign='right';right.append(div('coin-value',value),div('coin-sub',fmtNum(c.weight_pct,1)+'% κατανομή'));
    head.append(left,right);
    const bottom=div('mobile-bottom');bottom.append(div('mobile-price','Τιμή: '+price),div('day '+dir,day));card.append(head,bottom);
    const cost=coinCostResult(c);
    const finance=div('mobile-finance');
    finance.append(div('mobile-finance-label','ΑΠΟΤΕΛΕΣΜΑ ΑΠΟ ΤΙΜΗ ΑΓΟΡΑΣ'),
      div('mobile-finance-value '+(cost?direction(cost.usd):'flat'),
        cost?signedMoney(cost.usd,'USD')+'  /  '+signedMoney(cost.eur,'EUR'):'— · Χωρίς τιμή αγοράς'));
    card.append(finance);mobile.append(card);
  });
  if(!coins.length){desktop.append(div('empty-list','Δεν βρέθηκαν νομίσματα.'));mobile.append(div('empty-list','Δεν βρέθηκαν νομίσματα.'));}
  dom['coins-desktop'].replaceChildren(desktop);dom['coins-mobile'].replaceChildren(mobile);
}
function chartDayName(){return ({1:'24 ώρες',7:'7 ημέρες',30:'30 ημέρες',0:'Όλο το ιστορικό'})[state.chartDays]||'Επιλεγμένο διάστημα';}
function selectChartHistory(){
  const all=(state.snapshot&&Array.isArray(state.snapshot.history)?state.snapshot.history:[])
   .filter(p=>Number.isFinite(Date.parse(p.at))&&Number.isFinite(+p.usd)&&Number.isFinite(+p.eur)&&+p.usd>0&&+p.eur>0)
   .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const end=Date.now(),start=state.chartDays?end-state.chartDays*86400000:0;
  return all.filter(p=>Date.parse(p.at)>=start&&Date.parse(p.at)<=end+120000);
}
function updateChartStats(data){
  const stats=dom['chart-stats'];stats.replaceChildren();
  const period=chartDayName();
  if(!data.length){stats.append(div('',period+' · 0 πραγματικές καταγραφές'));text('chart-range',period+' · Χωρίς δεδομένα');
    text('chart-detail','Δεν υπάρχουν πραγματικές καταγραφές στο επιλεγμένο διάστημα.');return;}
  const usd=state.currency==='USD';const vals=data.map(p=>+(usd?p.usd:p.eur));const first=vals[0],last=vals[vals.length-1];
  const ch=first?(last/first-1)*100:0;const moneySymbol=usd?'$':'€';
  for(const [label,value,cls] of [['Διάστημα',period,''],['Άνοιγμα',moneySymbol+fmtNum(first,2),''],
   ['Υψηλό',moneySymbol+fmtNum(Math.max(...vals),2),''],['Χαμηλό',moneySymbol+fmtNum(Math.min(...vals),2),''],
   ['Τελευταίο',moneySymbol+fmtNum(last,2),''],['Μεταβολή',percent(ch),direction(ch)],['Μετρήσεις',String(data.length),'']]){
     const e=div('',label+': ');const strong=document.createElement('strong');strong.textContent=value;if(cls==='up')strong.className='positive';if(cls==='down')strong.className='negative';e.append(strong);stats.append(e);
   }
  const coverage=(Date.parse(data.at(-1).at)-Date.parse(data[0].at))/3600000;
  text('chart-range',period+' · '+data.length+' μετρήσεις · κάλυψη '+fmtNum(coverage,1)+' ώρες');
  if(state.selectedPoint<0)text('chart-detail',new Date(data.at(-1).at).toLocaleString('el-GR')+' · USD $'+fmtNum(data.at(-1).usd,2)+' · EUR €'+fmtNum(data.at(-1).eur,2));
}
function drawChart(){
  const data=selectChartHistory();
  document.querySelectorAll('[data-chart-days]').forEach(b=>{const isActive=+b.dataset.chartDays===state.chartDays;b.classList.toggle('active',isActive);b.setAttribute('aria-pressed',String(isActive));});
  if(state.selectedPoint>=data.length)state.selectedPoint=-1;
  // With fewer than three history points, let Chrome handle page pinch normally.
  dom['chart-wrap'].classList.toggle('pinch-enabled',data.length>2);
  const canvas=dom['history-chart'];const rect=canvas.getBoundingClientRect();const width=rect.width,height=rect.height;
  updateChartStats(data);
  dom['chart-placeholder'].hidden=data.length>0;
  dom['chart-placeholder'].textContent=data.length?'':'Δεν υπάρχουν πραγματικές τιμές για '+chartDayName()+'.';
  if(width<50||height<50)return;
  const dpr=Math.min(3,window.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
  const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  const pad={l:8,r:78,t:18,b:30},usableW=Math.max(20,width-pad.l-pad.r),usableH=Math.max(20,height-pad.t-pad.b);
  ctx.font='11px system-ui';ctx.textBaseline='middle';state.chartPoints=[];state.chartBounds={width,height,pad};
  if(!data.length)return;
  const v=p=>+(state.currency==='USD'?p.usd:p.eur);
  const allMin=Math.min(...data.map(v)),allMax=Math.max(...data.map(v));
  const spread=Math.max((allMax-allMin)*.13,Math.abs(allMax)*.008,.000001);
  const min=allMin-spread,max=allMax+spread;
  const lastStamp=Date.now();
  const actualStart=Date.parse(data[0].at),actualEnd=Date.parse(data.at(-1).at);
  const coverage=Math.max(1,actualEnd-actualStart);
  // Do not compress 17 hours of real data into a week of blank pixels.
  const useFullPeriod=state.chartDays&&coverage>=state.chartDays*86400000*.80&&state.chartZoom<=1;
  const margin=Math.max(120000,coverage*.04);
  const timeFrom=useFullPeriod?lastStamp-state.chartDays*86400000:actualStart-margin;
  const timeTo=useFullPeriod?lastStamp:actualEnd+margin;
  const points=data.map((p)=>({at:p.at,value:v(p),usd:+p.usd,eur:+p.eur,
   x:pad.l+(Date.parse(p.at)-timeFrom)/Math.max(1,timeTo-timeFrom)*usableW,
   y:pad.t+(max-v(p))/(max-min)*usableH}));
  let displayed=points;
  if(state.chartZoom>1&&points.length>2){const take=Math.max(2,Math.ceil(points.length/state.chartZoom));displayed=points.slice(-take);}
  const xfrom=state.chartZoom>1&&displayed.length>1?Date.parse(displayed[0].at):timeFrom;
  const xto=state.chartZoom>1&&displayed.length>1?Date.parse(displayed.at(-1).at):timeTo;
  displayed=displayed.map(p=>({...p,x:pad.l+(Date.parse(p.at)-xfrom)/Math.max(1,xto-xfrom)*usableW}));
  state.chartPoints=displayed;
  for(let i=0;i<4;i++){let y=pad.t+i*usableH/3;ctx.strokeStyle='#26364b';ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(width-pad.r+8,y);ctx.stroke();ctx.fillStyle='#8ba2bd';ctx.setLineDash([]);ctx.fillText(fmtNum(max-i*(max-min)/3,Math.abs(max)<1?5:2),width-pad.r+14,y);}
  const gradient=ctx.createLinearGradient(0,pad.t,0,height-pad.b);gradient.addColorStop(0,'rgba(57,194,227,.29)');gradient.addColorStop(1,'rgba(57,194,227,.015)');
  if(displayed.length>=2){ctx.beginPath();ctx.moveTo(displayed[0].x,height-pad.b);for(const p of displayed)ctx.lineTo(p.x,p.y);ctx.lineTo(displayed.at(-1).x,height-pad.b);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
    ctx.beginPath();displayed.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.lineWidth=2.4;ctx.strokeStyle='#49c5ec';ctx.shadowColor='#49c5ec55';ctx.shadowBlur=9;ctx.stroke();ctx.shadowBlur=0;}
  else{const p=displayed[0];ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#49c5ec';ctx.fill();}
  ctx.fillStyle='#7892b0';ctx.textAlign='left';ctx.fillText(new Date(xfrom).toLocaleDateString('el-GR'),pad.l,height-11);ctx.textAlign='right';ctx.fillText(new Date(xto).toLocaleDateString('el-GR'),width-pad.r,height-11);
  if(state.selectedPoint>=0&&state.selectedPoint<displayed.length){const p=displayed[state.selectedPoint];ctx.strokeStyle='#7ccaf0';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(p.x,pad.t);ctx.lineTo(p.x,height-pad.b);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle='#c1f2ff';ctx.fill();}
  if(data.length===1)text('chart-range',chartDayName()+' · μία πραγματική μέτρηση ('+new Date(data[0].at).toLocaleString('el-GR')+')');
}
function chartInteract(event){
  if(chartPinch.active && event.pointerType === 'touch')return;
  const pts=state.chartPoints;if(!pts.length)return;
  const rect=dom['history-chart'].getBoundingClientRect();const x=event.clientX-rect.left;
  let best=0,dist=Infinity;pts.forEach((p,i)=>{const d=Math.abs(p.x-x);if(d<dist){best=i;dist=d;}});
  state.selectedPoint=best;const p=pts[best];
  const val=p.value,base=pts[0].value,prev=best?pts[best-1].value:val;const pct=base?(val/base-1)*100:0;
  const date=new Date(p.at).toLocaleString('el-GR',{dateStyle:'medium',timeStyle:'medium'});
  const details=date+' · USD $'+fmtNum(p.usd,2)+' · EUR €'+fmtNum(p.eur,2)+' · από αρχή '+percent(pct)+' · από προηγ. '+(state.currency==='USD'?'$':'€')+fmtNum(val-prev,2);
  text('chart-detail',details);
  const tooltip=dom['chart-tooltip'];tooltip.textContent=date+'\nUSD $'+fmtNum(p.usd,2)+' · EUR €'+fmtNum(p.eur,2)+'\nΑπό αρχή '+percent(pct)+' · Δ '+(state.currency==='USD'?'$':'€')+fmtNum(val-base,2);
  tooltip.hidden=false;tooltip.style.left=Math.max(5,Math.min(rect.width-205,p.x+12))+'px';tooltip.style.top=Math.max(4,p.y-80)+'px';drawChart();
}
async function refresh(){
  if(state.busy||!state.token)return;state.busy=true;dom.refresh.disabled=true;
  try{
    const latest=validateSnapshot(await getPrivateJson(state.token,SNAPSHOT_URL));
    let basis=null,error='';
    try{basis=await getOptionalCostBasis(state.token);}catch(e){error=e.message||'Σφάλμα λήψης τιμών αγοράς';}
    state.snapshot=latest;state.costBasis=basis;state.costBasisError=error;render();
  }
  catch(e){setStatus('fail','Σφάλμα Cloud');text('last-updated','Δεν ήταν δυνατή η νέα λήψη: '+e.message+' · Προβάλλονται οι τελευταίες τιμές');}
  finally{state.busy=false;dom.refresh.disabled=false;}
}
function logout(){sessionStorage.removeItem(SESSION_KEY);localStorage.removeItem(VAULT_KEY);state.token='';state.snapshot=null;state.costBasis=null;dom.dashboard.hidden=true;dom['mobile-dock'].hidden=true;dom['login-screen'].hidden=false;dom.token.value='';dom['unlock-pass'].value='';dom['remember-pass'].value='';dom.remember.checked=false;dom['remember-pass-wrap'].hidden=true;dom['setup-section'].hidden=false;dom['unlock-section'].hidden=true;clearError();setStatus('','Αποσυνδεδεμένο');}
dom.connect.addEventListener('click',()=>{const token=dom.token.value.trim();if(!token){showError('Συμπλήρωσε το GitHub token.');return;}const password=dom.remember.checked?dom['remember-pass'].value:'';if(dom.remember.checked&&password.length<8){showError('Ο κωδικός αποθήκευσης πρέπει να έχει τουλάχιστον 8 χαρακτήρες.');return;}beginSession(token,password);});
dom.token.addEventListener('keydown',e=>{if(e.key==='Enter')dom.connect.click()});
dom.remember.addEventListener('change',()=>dom['remember-pass-wrap'].hidden=!dom.remember.checked);
dom.unlock.addEventListener('click',async()=>{try{clearError();const token=await unlockEncryptedToken(dom['unlock-pass'].value);beginSession(token);}catch(e){showError(e.message);}});
dom['unlock-pass'].addEventListener('keydown',e=>{if(e.key==='Enter')dom.unlock.click()});
dom['use-new-token'].addEventListener('click',()=>{localStorage.removeItem(VAULT_KEY);dom['unlock-section'].hidden=true;dom['setup-section'].hidden=false;clearError();});
dom.refresh.addEventListener('click',refresh);dom.lock.addEventListener('click',logout);
dom['usd-btn'].addEventListener('click',()=>{state.currency='USD';state.selectedPoint=-1;render();});
dom['eur-btn'].addEventListener('click',()=>{state.currency='EUR';state.selectedPoint=-1;render();});
dom.search.addEventListener('input',renderCoins);dom.sort.addEventListener('change',renderCoins);
dom['analysis-select'].addEventListener('change',renderInsights);
document.querySelectorAll('[data-chart-days]').forEach(button=>button.addEventListener('click',()=>{
  state.chartDays=+button.dataset.chartDays;state.chartZoom=1;state.selectedPoint=-1;dom['chart-tooltip'].hidden=true;drawChart();
}));
dom['chart-zoom-in'].addEventListener('click',()=>{state.chartZoom=Math.min(16,state.chartZoom*1.5);state.selectedPoint=-1;drawChart();});
dom['chart-zoom-out'].addEventListener('click',()=>{state.chartZoom=Math.max(1,state.chartZoom/1.5);state.selectedPoint=-1;drawChart();});
dom['chart-reset'].addEventListener('click',()=>{state.chartZoom=1;state.selectedPoint=-1;dom['chart-tooltip'].hidden=true;drawChart();});
dom['history-chart'].addEventListener('wheel',e=>{if(!state.chartPoints.length)return;e.preventDefault();state.chartZoom=Math.max(1,Math.min(16,state.chartZoom*(e.deltaY<0?1.4:1/1.4)));state.selectedPoint=-1;drawChart();},{passive:false});
// Pinch with two fingers changes the chart time window. Single-finger vertical
// scrolling remains available; page zoom also remains enabled outside the chart.
function chartTouchDistance(touches){
  const dx=touches[0].clientX-touches[1].clientX;
  const dy=touches[0].clientY-touches[1].clientY;
  return Math.hypot(dx,dy);
}
function chartPinchStart(e){
  if(e.touches.length!==2 || state.chartPoints.length<3)return;
  chartPinch.active=true;
  chartPinch.distance=Math.max(1,chartTouchDistance(e.touches));
  chartPinch.zoomAtStart=state.chartZoom;
  state.selectedPoint=-1;
  dom['chart-tooltip'].hidden=true;
}
function chartPinchMove(e){
  if(!chartPinch.active || e.touches.length!==2)return;
  // Prevent the browser's gesture only over this graph. The remaining page
  // supports native two-finger pinch zoom through the viewport setting.
  if(e.cancelable)e.preventDefault();
  const factor=chartTouchDistance(e.touches)/chartPinch.distance;
  const zoom=Math.max(1,Math.min(16,chartPinch.zoomAtStart*factor));
  if(Math.abs(zoom-state.chartZoom)>0.015){
    state.chartZoom=zoom;
    state.selectedPoint=-1;
    drawChart();
  }
}
function chartPinchEnd(e){
  if(e.touches.length<2)chartPinch.active=false;
}
dom['chart-wrap'].addEventListener('touchstart',chartPinchStart,{passive:true});
dom['chart-wrap'].addEventListener('touchmove',chartPinchMove,{passive:false});
dom['chart-wrap'].addEventListener('touchend',chartPinchEnd,{passive:true});
dom['chart-wrap'].addEventListener('touchcancel',()=>{chartPinch.active=false;},{passive:true});
dom['history-chart'].addEventListener('pointermove',chartInteract);
dom['history-chart'].addEventListener('pointerdown',chartInteract);
dom['history-chart'].addEventListener('pointerleave',e=>{if(e.pointerType==='touch')return;state.selectedPoint=-1;dom['chart-tooltip'].hidden=true;drawChart();});
window.addEventListener('resize',()=>{if(state.snapshot)drawChart();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.token)refresh();});
setInterval(()=>{if(state.token&&!document.hidden)refresh()},60000);
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
const session=sessionStorage.getItem(SESSION_KEY);const saved=localStorage.getItem(VAULT_KEY);
if(session){beginSession(session);}else if(saved){dom['setup-section'].hidden=true;dom['unlock-section'].hidden=false;}
