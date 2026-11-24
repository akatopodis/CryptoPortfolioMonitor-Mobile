/* Optional on-device LLM. Explicit opt-in. Runs in a dedicated Worker without DOM/localStorage/sessionStorage
   so the model runtime cannot read parent GitHub token or storage. */
(function(){
 'use strict';
 const load=document.getElementById('local-llm-load'),stop=document.getElementById('local-llm-unload');
 const status=document.getElementById('local-llm-status'),output=document.getElementById('local-llm-output');
 const choose=document.getElementById('local-llm-model');
 const progress=document.getElementById('local-llm-progress'),auto=document.getElementById('local-llm-auto');
 const AUTOKEY='cpm_local_llm_autoload_142';
 if(!load||!stop||!status||!choose||!output)return;
 let worker=null,active=false,busy=false,lastRequest=0,lastQuestion='',spoken='',queued=null;
 if(auto){try{auto.checked=localStorage.getItem(AUTOKEY)==='yes';}catch(_){}}
 function say(message){status.textContent=message;}
 function enabled(){return active&&worker&&!busy;}
 function close(){if(progress){progress.hidden=true;progress.value=0;}active=false;busy=false;queued=null;spoken='';lastQuestion='';lastRequest++;if(worker){worker.terminate();worker=null;}load.disabled=false;stop.disabled=true;choose.disabled=false;say('Το τοπικό γλωσσικό μοντέλο είναι απενεργοποιημένο. Οι προσομοιώσεις συνεχίζουν κανονικά.');}
 function receive(event){
  if(!worker||!event.data||event.data.app!=='CPM_LOCAL_LLM')return;
  const m=event.data;
  if(m.type==='progress'){say('Λήψη/προετοιμασία AI: '+String(m.message||'').slice(0,140));if(progress){progress.hidden=false;const v=Number(m.progress);if(Number.isFinite(v))progress.value=Math.max(0,Math.min(100,Math.round(v*100)));}}
  if(m.type==='ready'){if(progress){progress.value=100;progress.hidden=true;}active=true;busy=false;load.disabled=true;stop.disabled=false;choose.disabled=true;say('Το γλωσσικό μοντέλο είναι έτοιμο στη συσκευή. Ρώτησε φυσικά τον Advisor.');}
  if(m.type==='failure'){say('Δεν ενεργοποιήθηκε το AI: '+String(m.message||'σφάλμα').slice(0,190));closeFrameOnly();}
  if(m.type==='answer'){
    busy=false;
    if(m.id!==lastRequest){
      if(queued){const item=queued;queued=null;sendAsk(item.question,item.verified);}
      return;
    }spoken=String(m.answer||'').slice(0,500);
    output.hidden=true;output.textContent='';
    const chat=document.getElementById('advisor-conversation');
    if(chat){const bubble=document.createElement('div');bubble.className='advisor-chat-message assistant local-ai-reply';
      const heading=document.createElement('strong');heading.textContent='Local AI · φυσική γλώσσα';
      const body=document.createElement('div');body.textContent=String(m.answer||'Δεν παρήχθη απάντηση.').slice(0,4000);
      bubble.append(heading,body);chat.append(bubble);
      while(chat.children.length>40)chat.firstElementChild.remove();chat.scrollTop=chat.scrollHeight;
    }
    say('Απάντηση από το τοπικό γλωσσικό μοντέλο. Τα αριθμητικά στοιχεία προέρχονται από τον Strategy Lab.');
    if(document.getElementById('advisor-auto-voice')?.checked && typeof window.CPMAdvisorSpeakText==='function' && spoken){window.CPMAdvisorSpeakText(spoken);}
  }
 }
 function closeFrameOnly(){if(progress)progress.hidden=true;active=false;busy=false;queued=null;lastRequest++;if(worker){worker.terminate();worker=null;}load.disabled=false;stop.disabled=true;choose.disabled=false;}
 function sendAsk(question,verified){
    if(!active||!worker||busy)return false;
    spoken='';busy=true;const id=++lastRequest;lastQuestion=String(question).slice(0,300);
    output.hidden=false;output.textContent='◆ Το τοπικό AI συνθέτει απάντηση…';
    say('Επεξεργασία στη συσκευή. Δεν αποστέλλεται ερώτηση σε cloud AI.');
    worker.postMessage({app:'CPM_LOCAL_LLM',type:'ask',id,question:lastQuestion,
      verified:String(verified||'').slice(0,2800)});return true;
 }
 function startModel(){
  if(worker)return;
  if(!window.isSecureContext||!navigator.gpu){say('Το Chrome αυτής της συσκευής δεν παρέχει WebGPU σε ασφαλές HTTPS. Το Strategy Lab λειτουργεί χωρίς LLM.');return;}
  try{worker=new Worker('./llm_worker.js',{type:'module'});}
  catch(e){say('Δεν ξεκίνησε η τοπική AI: '+String(e.message||e));return;}
  worker.onmessage=receive;
  worker.onerror=event=>{say('Η AI απέτυχε να ξεκινήσει (έλεγξε Chrome/WebGPU).');closeFrameOnly();};
  worker.postMessage({app:'CPM_LOCAL_LLM',type:'load',model:choose.value});load.disabled=true;stop.disabled=false;if(progress){progress.value=0;progress.hidden=false;}say('Ξεκινά η λήψη στον browser. Μην κλείσεις την εφαρμογή έως την ολοκλήρωση.');
 }
 load.addEventListener('click',startModel);
 if(auto)auto.addEventListener('change',()=>{try{localStorage.setItem(AUTOKEY,auto.checked?'yes':'no');}catch(_){}});
 // Autoload is opt-in, after a previous explicit user choice, and only if the browser supports WebGPU.
 if(auto?.checked && window.isSecureContext && navigator.gpu){window.addEventListener('load',()=>setTimeout(startModel,900),{once:true});}
 stop.addEventListener('click',close);
 window.CPMMobileLLM={
  isReady:()=>active,
  get spoken(){return spoken;},
  reset(){spoken='';},
  cancelPending(){lastRequest++;spoken='';queued=null;lastQuestion='';output.hidden=true;output.textContent='';},
  explain(question,verified){
   if(!active||!worker)return false;
   // Pass ONLY deterministic report, never token, storage, history or raw GitHub payload.
   if(busy){queued={question:String(question).slice(0,300),verified:String(verified||'').slice(0,2800)};
      say('Το προηγούμενο αίτημα ολοκληρώνεται· θα απαντήσω στη νεότερη ερώτηση.');return true;}
   return sendAsk(question,verified);
  }
 };
})();
