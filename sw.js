const CACHE='personal-organizer-v083-push-diagnostic';const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png','./budget-xlsx.js','./firebase-config.js','./cloud-sync.js','./sw.js'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k!==DIAG_CACHE).map(k=>caches.delete(k))))));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c))}return r}).catch(()=>caches.match(e.request)))})
// Diagnostic only: records event *types* and timestamps, never message text or tokens.
// Stored locally on this device. It does not send logs to a server.
const DIAG_CACHE='po-push-diagnostic-v1';
const DIAG_URL=new URL('./__po_push_diagnostic__.json',self.registration.scope).href;
async function writePushDiagnostic(kind,extra={}){
 try{
  const cache=await caches.open(DIAG_CACHE);
  const previous=await cache.match(DIAG_URL);
  const saved=previous?await previous.json():{events:[]};
  const events=Array.isArray(saved.events)?saved.events:[];
  events.push({at:new Date().toISOString(),kind,...extra});
  await cache.put(DIAG_URL,new Response(JSON.stringify({version:'v0.8.3',events:events.slice(-25)}),{headers:{'Content-Type':'application/json'}}));
 }catch(e){console.warn('Push diagnostic logging failed',e)}
}
// Capture the push event before the Firebase SDK handles it. Do not intercept it.
self.addEventListener('push',event=>{
 let format='unknown';
 try{
  if(!event.data)format='empty';
  else{
   const obj=event.data.json();
   format=obj&&typeof obj==='object'?'json:'+Object.keys(obj).slice(0,6).join(','):'json-value';
  }
 }catch(_){format='non-json'}
 event.waitUntil(writePushDiagnostic('push-received',{format}));
});

// Firebase Messaging receives background messages in this existing same-origin service worker.
// Server will send data-only payloads to avoid duplicate notifications.
try {
 importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
 firebase.initializeApp({apiKey:'AIzaSyDsyyBVVZSbxubuIp1hjs3mMYLqWyhziLo',authDomain:'personal-organizer-7d310.firebaseapp.com',projectId:'personal-organizer-7d310',messagingSenderId:'79815785822',appId:'1:79815785822:web:a8e420873fd030990623cf'});
 const messaging=firebase.messaging();
 messaging.onBackgroundMessage(payload=>{
  // The Firebase callback ran; log metadata only, not message contents.
  const record=writePushDiagnostic('fcm-background-callback',{notification:!!payload.notification,data:!!payload.data});
  // FCM automatically displays notification payloads; show only data-only messages.
  if(payload.notification)return record;
  const d=payload.data||{};
  const title=String(d.title||'Personal Organizer — напоминание');
  const options={body:String(d.body||'Завтра запланировано событие.'),icon:'./icon-192.png',badge:'./icon-192.png',tag:String(d.reminderId||'personal-organizer-reminder'),data:{url:'./'}};
  return Promise.all([record,self.registration.showNotification(title,options)]);
 });
} catch(err) {console.error('Firebase messaging worker initialization failed:',err);writePushDiagnostic('firebase-worker-init-error',{error:String(err?.message||err).slice(0,180)})}
