const CACHE='personal-organizer-v082-push-test';const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png','./budget-xlsx.js','./firebase-config.js','./cloud-sync.js','./sw.js'];self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(cache=>cache.put(e.request,c))}return r}).catch(()=>caches.match(e.request)))})
// Firebase Messaging receives background messages in this existing same-origin service worker.
// Server will send data-only payloads to avoid duplicate notifications.
try {
 importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
 firebase.initializeApp({apiKey:'AIzaSyDsyyBVVZSbxubuIp1hjs3mMYLqWyhziLo',authDomain:'personal-organizer-7d310.firebaseapp.com',projectId:'personal-organizer-7d310',messagingSenderId:'79815785822',appId:'1:79815785822:web:a8e420873fd030990623cf'});
 const messaging=firebase.messaging();
 messaging.onBackgroundMessage(payload=>{
  // FCM automatically displays notification payloads; show only data-only messages.
  if(payload.notification)return;
  const d=payload.data||{};
  const title=String(d.title||'Personal Organizer — напоминание');
  const options={body:String(d.body||'Завтра запланировано событие.'),icon:'./icon-192.png',badge:'./icon-192.png',tag:String(d.reminderId||'personal-organizer-reminder'),data:{url:'./'}};
  return self.registration.showNotification(title,options);
 });
} catch(err) {console.error('Firebase messaging worker initialization failed:',err)}
