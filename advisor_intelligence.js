'use strict';
/* Portfolio Advisor — explainable, private, zero trading endpoints.
   No generative-model claims: recommendations optimize an EXPLICIT objective
   under hypothetical assumptions, not projected market returns. */
(function(root){
 const finite=x=>typeof x==='number'&&Number.isFinite(x);
 const fmt=(v,dec=2)=>Number(v).toLocaleString('el-GR',{minimumFractionDigits:dec,maximumFractionDigits:dec});
 const cash=v=>'$'+fmt(v);
 function validate(positions){
  const seen=new Set();
  if(!Array.isArray(positions)||!positions.length)throw Error('Δεν υπάρχουν αξιόπιστες τιμές. Κάνε πρώτα ανανέωση.');
  return positions.map(p=>{
    const symbol=String(p.symbol||'').toUpperCase().trim(),qty=Number(p.qty),price=Number(p.price);
    if(!/^[A-Z0-9]{2,16}$/.test(symbol)||seen.has(symbol)||!finite(qty)||qty<0||!finite(price)||price<=0)throw Error('Ελλιπής τιμή ή διπλό νόμισμα. Χρειάζεται ανανέωση δεδομένων.');
    seen.add(symbol);return {symbol,qty,price,value:qty*price};
  });
 }
 function metrics(pos){
  const total=pos.reduce((sum,p)=>sum+p.value,0);
  if(!(total>0))throw Error('Δεν υπάρχει θετική αξία για ανάλυση.');
  const w=pos.map(p=>({symbol:p.symbol,share:p.value/total,usd:p.value})).sort((a,b)=>b.share-a.share);
  const hhi=w.reduce((s,p)=>s+p.share*p.share,0);
  return {total,w,hhi,largest:w[0].share,top3:w.slice(0,3).reduce((s,p)=>s+p.share,0),effective:hhi?1/hhi:0};
 }
 function simulate(positions,{action='hold',source='',target='',amount=0,fee=.2,slippage=.3}={}){
  const current=validate(positions); const before=metrics(current);const next=current.map(p=>({...p}));
  if(!['hold','swap','buy'].includes(action))throw Error('Άγνωστη ενέργεια.');
  if(![amount,fee,slippage].every(finite)||amount<0||fee<0||slippage<0||fee>20||slippage>20||fee+slippage>=100)throw Error('Άκυρο ποσό ή έξοδα συναλλαγής.');
  const cost=action==='hold'?0:amount*(fee+slippage)/100;
  if(action!=='hold'){
   const dst=next.find(p=>p.symbol===target);
   if(!dst||!(amount>0))throw Error('Διάλεξε νόμισμα με έγκυρη τιμή και θετικό ποσό.');
   if(action==='swap'){
     const src=next.find(p=>p.symbol===source);
     if(!src||source===target)throw Error('Επίλεξε διαφορετικά νομίσματα.');
     if(src.value+1e-8<amount)throw Error('Το ποσό υπερβαίνει την υπάρχουσα θέση.');
     src.value=Math.max(0,src.value-amount);src.qty=src.value/src.price;
   }
   dst.value+=amount-cost;dst.qty=dst.value/dst.price;
  }
  const after=metrics(next);
  const largestSymbol=before.w[0].symbol;
  const shock=(p,kind)=>{
   if(kind==='broad_down')return p.value*.75;
   if(kind==='broad_up')return p.value*1.15;
   if(kind==='single_down')return p.value*(p.symbol===largestSymbol?.55:1);
   return p.value;
  };
  const outcomes=Object.fromEntries(['broad_down','broad_up','single_down'].map(k=>[k,next.reduce((s,p)=>s+shock(p,k),0)]));
  const baseSingle=current.reduce((s,p)=>s+shock(p,'single_down'),0);
  return {action,source,target,amount,cost,received:Math.max(0,amount-cost),before,after,next,outcomes,
   riskExposureBefore:before.total-baseSingle,riskExposureAfter:after.total-outcomes.single_down,
   improvement:before.hhi-after.hhi};
 }
 function compare(positions,{goal='balanced',amount=50,fee=.2,slippage=.3}={}){
  const p=validate(positions),base=metrics(p);
  if(!finite(amount)||amount<=0)throw Error('Δώσε θετικό ποσό σύγκρισης.');
  const candidates=[simulate(p,{action:'hold'})];
  for(const source of p){if(source.value<Math.min(amount,0.01)||source.value<=0)continue;
    for(const target of p){if(target.symbol===source.symbol)continue;
      const size=Math.min(amount,source.value);
      if(size<=0)continue;
      candidates.push(simulate(p,{action:'swap',source:source.symbol,target:target.symbol,amount:size,fee,slippage}));
    }
  }
  // Cash-funded buys are displayed separately: comparing buys to swaps is
  // not a like-for-like decision, because buying adds external capital.
  for(const target of p)candidates.push(simulate(p,{action:'buy',target:target.symbol,amount,fee,slippage}));
  const reduced=candidates.filter(c=>c.action!=='buy');
  const buys=candidates.filter(c=>c.action==='buy');
  const scorer=s=>{
    if(goal==='fees')return s.action==='hold'?1:-(s.cost+.001); // hold minimizes churn
    if(goal==='resilience')return -s.riskExposureAfter/Math.max(1,s.after.total);
    if(goal==='diversify')return -s.after.hhi;
    if(goal==='balanced')return (base.hhi-s.after.hhi)*100-s.cost/Math.max(1,base.total)*4;
    return -s.after.hhi;
  };
  const rank=arr=>arr.sort((a,b)=>scorer(b)-scorer(a)).filter((s,i,ar)=>
   i===0||!(s.action==='swap'&&ar.slice(0,i).some(t=>t.action==='swap'&&t.source===s.source&&t.target===s.target)));
  return {baseline:base, goal, holdsAndSwaps:rank(reduced).slice(0,4),cashBuys:rank(buys).slice(0,3),candidates:candidates.length};
 }
 const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'');
 function understand(question,positions,prior={}){
  const q=normalize(question);const symbols=validate(positions).map(p=>p.symbol);
  const mentioned=symbols.filter(sym=>new RegExp('(^|[^a-z0-9])'+sym.toLowerCase()+'([^a-z0-9]|$)','i').test(q));
  const intent=/(swap|ανταλλ|metatro|allag|antall)/i.test(q)?'swap':/(αγορ|agor|buy|αγορασ|προσθε)/i.test(q)?'buy':/(hold|κρατ|diakrat|perimen|αναμον|περιμεν|wait|κανω τιποτα)/i.test(q)?'hold':/(compare|συγκριν|συγκρισ|σενάρι|senari|καλυτερ|best|προτείν|προτειν|βέλτιστ|veltist)/i.test(q)?'compare':/(risk|ρίσκ|ρισκ|στρες|stress|πτωση|εάν πέσ|anevei|ανεβ)/i.test(q)?'risk':/(κόστος|kost|fees|προμηθ)/i.test(q)?'fees':/(συγκεντρ|συμμετοχ|διασπορ|divers|allocation|katano)/i.test(q)?'diversify':'overview';
  let source='',target='';
  const expr=mentioned.join('|');if(expr){
    const mFrom=q.match(new RegExp('(?:απο|apo|from)\\s+(?:το\\s+)?('+expr+')','i'));
    const mTo=q.match(new RegExp('(?:σε|στο|προς|to|into)\\s+(?:το\\s+)?('+expr+')','i'));
    if(mFrom)source=mFrom[1].toUpperCase();if(mTo)target=mTo[1].toUpperCase();
  }
  if(intent==='swap'){
   if(!source&&mentioned.length>=2)source=mentioned[0];
   if(!target&&mentioned.length>=2)target=mentioned[1];
   if(!target&&mentioned.length===1&&source!==mentioned[0])target=mentioned[0];
  }else if(mentioned.length)target=mentioned[0];
  // Currency-prefixed or 'amount USD' numbers only. Percentages do not count.
  const amountMatch=q.match(/(?:\$|€|usd\s*)(\s*\d+(?:[.,]\d+)?)/i)||q.match(/(\d+(?:[.,]\d+)?)\s*(?:usd|δολαρ|dollar)/i);
  const amount=amountMatch?Number(amountMatch[1].replace(',','.')):null;
  const goal=/(fee|προμηθ|κοστ|kost|χωρις εξοδ)/i.test(q)?'fees':/(ris|ρίσκ|ρισκ|stress|πτωση|resilien)/i.test(q)?'resilience':/(συγκεντρ|διασπορ|divers|κατανομ|katano)/i.test(q)?'diversify':'balanced';
  return {intent,source,target,amount:amount&&finite(amount)?amount:null,goal,mentioned,normalized:q};
 }
 function explain(positions,query,options={}){
  const p=validate(positions),m=metrics(p),under=understand(query,p),defaultAmount=finite(options.amount)&&options.amount>0?options.amount:50;
  const fee=finite(options.fee)?options.fee:.2,slippage=finite(options.slippage)?options.slippage:.3;
  const amount=under.amount||defaultAmount;let result,short,detail=[],scenarioResult=null;
  const bullet='• ';
  const custom=(under.intent==='buy'||under.intent==='swap');
  if(custom){
   const source=under.source||options.source||'',target=under.target||options.target||'';
   if(under.mentioned.length===1&&under.intent==='swap'&&!under.source){
    result=`Για να συγκρίνω αξιόπιστα αυτή την ανταλλαγή, πες μου και το δεύτερο νόμισμα: ποιο δίνεις και ποιο αγοράζεις. Για παράδειγμα: «Αντάλλαξε 50 USD από HBAR σε AVAX».`;
    return {text:result,spoken:'Χρειάζομαι και το δεύτερο νόμισμα για να μη μαντέψω.',cards:[],intent:under.intent};
   }
   scenarioResult=simulate(p,{action:under.intent,source,target,amount,fee,slippage});
   const s=scenarioResult,act=under.intent==='buy'?`αγορά ${target} με νέο κεφάλαιο`:`ανταλλαγή ${source} σε ${target}`;
   short=`Για ${act} ύψους ${cash(s.amount)}, η επιβάρυνση υπολογίζεται σε ${cash(s.cost)}. Η συγκέντρωση ${s.after.hhi<s.before.hhi-.00001?'μειώνεται':s.after.hhi>s.before.hhi+.00001?'αυξάνεται':'ουσιαστικά δεν αλλάζει'}.`;
   result=`${short}\n\n${bullet}Μεγαλύτερη θέση: ${fmt(s.before.largest*100,1)}% πριν · ${fmt(s.after.largest*100,1)}% μετά.\n${bullet}Top 3: ${fmt(s.before.top3*100,1)}% → ${fmt(s.after.top3*100,1)}%.\n${bullet}Σενάριο γενικής πτώσης 25%: ${cash(s.outcomes.broad_down)}.\n${bullet}Σενάριο πτώσης 45% μόνο της σημερινής μεγαλύτερης θέσης: ${cash(s.outcomes.single_down)}.\n\nΗ αγορά προσθέτει νέα κεφάλαια· η ανταλλαγή όχι. Τα σενάρια είναι υποθέσεις και όχι εκτιμήσεις μελλοντικής τιμής. Δεν έγινε συναλλαγή.`;
  }else if(under.intent==='hold'){
   const s=simulate(p,{action:'hold'});short='Η διακράτηση δεν προσθέτει κόστη συναλλαγής ούτε αλλάζει τις θέσεις σου.';
   result=`${short}\n\nΗ μεγαλύτερη θέση είναι ${m.w[0].symbol} (${fmt(m.largest*100,1)}%). Σε υποθετική γενική πτώση 25%, η αποτίμηση θα ήταν ${cash(s.outcomes.broad_down)}. Η αναμονή αποφεύγει άσκοπες προμήθειες, δεν αφαιρεί τον κίνδυνο της αγοράς.`;
  }else if(under.intent==='fees'){
   short='Για ελάχιστα έξοδα συναλλαγών, η διακράτηση είναι η επιλογή αναφοράς.';
   result=`${short} Με προμήθεια ${fmt(fee)}% και ολίσθηση ${fmt(slippage)}%, μια κίνηση ${cash(amount)} επιβαρύνεται ενδεικτικά με ${cash(amount*(fee+slippage)/100)}. Αυτά δεν περιλαμβάνουν φόρους και τυχόν gas ή spread.`;
  }else{
   const goal=under.intent==='risk'?'resilience':under.intent==='diversify'?'diversify':under.goal;
   const ranked=compare(p,{goal,amount,fee,slippage});const best=ranked.holdsAndSwaps[0];
   const meaning=goal==='resilience'?'μικρότερη έκθεση στο υποθετικό σοκ της μεγαλύτερης θέσης':goal==='diversify'?'χαμηλότερη συγκέντρωση':'καλύτερη ισορροπία διασποράς και ενδεικτικών εξόδων';
   if(best.action==='hold'){
    short=`Με κριτήριο ${meaning}, η διακράτηση είναι ανταγωνιστική σε σχέση με τις μικρές ανταλλαγές που δοκιμάστηκαν.`;
   }else{
    short=`Με κριτήριο ${meaning}, αξίζει να εξετάσεις υποθετική ανταλλαγή ${cash(best.amount)} από ${best.source} προς ${best.target}. Δεν είναι πρόβλεψη ότι το ${best.target} θα ανέβει.`;
   }
   const alternatives=ranked.holdsAndSwaps.slice(1,4).map(s=>s.action==='hold'?'διακράτηση':`${s.source} → ${s.target} (${cash(s.amount)})`);
   result=`${short}\n\n${bullet}Αποτίμηση: ${cash(m.total)} · ${p.length} νομίσματα.\n${bullet}Μεγαλύτερη θέση: ${m.w[0].symbol} (${fmt(m.largest*100,1)}%).\n${bullet}Συμμετοχή των 3 μεγαλύτερων: ${fmt(m.top3*100,1)}%.\n${bullet}Συγκρίθηκαν ${ranked.candidates} υποθετικές επιλογές, μαζί με τη διακράτηση.\n${bullet}Εναλλακτικές: ${alternatives.join(' · ')||'καμία που να ταιριάζει'}.\n\nΟι αγορές με νέο κεφάλαιο εξετάζονται ξεχωριστά από τις ανταλλαγές. Δεν έχω πρόβλεψη τιμών, ρευστότητα ανταλλακτηρίου ή πραγματικά spreads. Πρόκειται για διαφανή αξιολόγηση κατανομής, όχι αυτοματοποιημένη επενδυτική απόφαση.`;
   detail=ranked.holdsAndSwaps.slice(0,3).map(s=>({title:s.action==='hold'?'Διακράτηση':`${s.source} → ${s.target}`,label:`Top 3: ${fmt(s.after.top3*100,1)}% · Εκτ. κόστος ${cash(s.cost)}`,note:s.action==='hold'?'Χωρίς συναλλαγή':`Υποθετική ανταλλαγή ${cash(s.amount)}`}));
  }
  return {text:result,spoken:short,cards:detail,intent:under.intent,scenarioResult};
 }
 root.CPMAdvisor=Object.freeze({validate,metrics,simulate,compare,understand,explain,normalize});
})(typeof window!=='undefined'?window:globalThis);
