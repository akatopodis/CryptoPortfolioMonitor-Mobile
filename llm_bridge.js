/* Optional on-device LLM. Explicit opt-in. Runs in a dedicated Worker without DOM/localStorage/sessionStorage
   so the model runtime cannot read parent GitHub token or storage. */
(function(){
 'use strict';
 const load=document.getElementById('local-llm-load'),stop=document.getElementById('local-llm-unload');
 const status=document.getElementById('local-llm-status'),output=document.getElementById('local-llm-output');
 const choose=document.getElementById('local-llm-model');
 if(!load||!stop||!status||!choose||!output)return;
 let worker=null,active=false,busy=false,lastRequest=0,lastQuestion='',spoken='';
 function say(message){status.textContent=message;}
 function enabled(){return active&&worker&&!busy;}
 function close(){active=false;busy=false;spoken='';lastQuestion='';lastRequest++;if(worker){worker.terminate();worker=null;}load.disabled=false;stop.disabled=true;choose.disabled=false;say('Το τοπικό γλωσσικό μοντέλο είναι απενεργοποιημένο. Οι προσομοιώσεις συνεχίζουν κανονικά.');}
 function receive(event){
  if(!worker||!event.data||event.data.app!=='CPM_LOCAL_LLM')return;
  const m=event.data;
  if(m.type==='progress'){say('Φόρτωση: '+String(m.message||'').slice(0,140));}
  if(m.type==='ready'){active=true;busy=false;load.disabled=true;stop.disabled=false;choose.disabled=true;say('Το γλωσσικό μοντέλο είναι έτοιμο στη συσκευή. Ρώτησε φυσικά τον Advisor.');}
  if(m.type==='failure'){say('Δεν ενεργοποιήθηκε το AI: '+String(m.message||'σφάλμα').slice(0,190));closeFrameOnly();}
  if(m.type==='answer'&&m.id===lastRequest){
    busy=false;spoken=String(m.answer||'').slice(0,500);
    output.hidden=false;output.textContent='◆ Απάντηση τοπικού AI — ερμηνεία, όχι επαληθευμένοι υπολογισμοί\n\n'+String(m.answer||'Δεν παρήχθη απάντηση.').slice(0,4000);
    say('Απάντηση από το τοπικό γλωσσικό μοντέλο. Τα αριθμητικά στοιχεία προέρχονται από τον Strategy Lab.');
    if(document.getElementById('advisor-auto-voice')?.checked && window.speechSynthesis && spoken){
      window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(spoken.slice(0,370));u.lang='el-GR';window.speechSynthesis.speak(u);
    }
  }
 }
 function closeFrameOnly(){active=false;busy=false;if(worker){worker.terminate();worker=null;}load.disabled=false;stop.disabled=true;choose.disabled=false;}
 load.addEventListener('click',()=>{
  if(worker)return;
  if(!window.isSecureContext||!navigator.gpu){say('Το Chrome αυτής της συσκευής δεν παρέχει WebGPU σε ασφαλές HTTPS. Το Strategy Lab λειτουργεί χωρίς LLM.');return;}
  try{worker=new Worker('./llm_worker.js',{type:'module'});}
  catch(e){say('Δεν ξεκίνησε η τοπική AI: '+String(e.message||e));return;}
  worker.onmessage=receive;
  worker.onerror=event=>{say('Η AI απέτυχε να ξεκινήσει (έλεγξε Chrome/WebGPU).');closeFrameOnly();};
  worker.postMessage({app:'CPM_LOCAL_LLM',type:'load',model:choose.value});load.disabled=true;stop.disabled=false;say('Εκκίνηση λήψης μοντέλου. Η πρώτη χρήση απαιτεί αρκετά δεδομένα και χρόνο.');
 });
 stop.addEventListener('click',close);
 window.CPMMobileLLM={
  isReady:()=>active,
  get spoken(){return spoken;},
  reset(){spoken='';},
  explain(question,verified){
   if(!enabled())return false;
   spoken='';busy=true;const id=++lastRequest;lastQuestion=String(question).slice(0,300);
   output.hidden=false;output.textContent='◆ Το τοπικό AI συνθέτει απάντηση…';
   say('Επεξεργασία στον επεξεργαστή της συσκευής. Δεν αποστέλλεται ερώτηση σε cloud AI.');
   // Pass ONLY deterministic report, never token, storage, history or raw GitHub payload.
   worker.postMessage({app:'CPM_LOCAL_LLM',type:'ask',id,question:lastQuestion,
     verified:String(verified||'').slice(0,2800)});return true;
  }
 };
})();
