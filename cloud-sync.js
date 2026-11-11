/* Personal Organizer v0.8 — Google sign-in + opt-in Firebase synchronization.
   Local storage remains available when Firebase is not configured or offline. */
const $=s=>document.querySelector(s), bridge=window.PersonalOrganizerBridge;
const config=window.PERSONAL_ORGANIZER_FIREBASE_CONFIG||{};
const ownerKey='po-v08-owner',guestKey='po-v08-guest';
const cacheKey=u=>'po-v08-cache-'+u,revKey=u=>'po-v08-rev-'+u,dirtyKey=u=>'po-v08-dirty-'+u,filesKey=u=>'po-v08-files-'+u;
const empty=()=>({tasks:[],events:[],notes:[],finance:[],projects:[]});
const parse=v=>{try{return JSON.parse(v)}catch{return null}};
const valid=d=>d&&['tasks','events','notes','finance','projects'].every(k=>Array.isArray(d[k]));
const nonempty=d=>valid(d)&&Object.values(d).some(a=>a.length);
const status=(t,k='')=>{const e=$('#cloudStatus');e.textContent=t;e.className='account-status '+k};
const show=(s,v)=>$(s).classList.toggle('hide',!v);
let auth,db,storage,api,firebaseApp,user=null,remote=null,rev=0,dirty=false,active=false,busy=false,muted=false,timer,changes=0,uploaded=new Set();
function cache(){const owner=localStorage.getItem(ownerKey)||'guest';try{localStorage.setItem(owner==='guest'?guestKey:cacheKey(owner),JSON.stringify(bridge.getData()))}catch(e){console.warn(e)}}
function replace(d){muted=true;try{bridge.replaceData(d)}finally{muted=false}cache()}
function switchOwner(next){const current=localStorage.getItem(ownerKey)||'guest';if(current===next)return;cache();localStorage.setItem(ownerKey,next);const d=parse(localStorage.getItem(next==='guest'?guestKey:cacheKey(next)));replace(valid(d)?d:empty())}
function pending(msg){active=false;show('#cloudDecision',true);show('#cloudSyncNow',false);$('#cloudDecisionText').textContent=msg;status('Выбери, какие записи использовать. Ничего не заменено автоматически.','warn')}
function ready(msg){active=true;show('#cloudDecision',false);show('#cloudSyncNow',true);status(msg,'good')}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>sync(),1200)}
window.PersonalCloud={
 localChanged(){if(muted)return;changes++;cache();if(user){dirty=true;localStorage.setItem(dirtyKey(user.uid),'1');if(active){status('Сохранено на устройстве. Синхронизирую…','warn');schedule()}}},
 async downloadAttachment(id){if(!user||!storage)throw Error('Firebase Storage не подключён');const meta=['tasks','events','notes'].flatMap(k=>bridge.getData()[k]).flatMap(x=>x.attachments||[]).find(x=>x.id===id);if(!meta)throw Error('Вложение не найдено');const blob=await api.getBlob(api.ref(storage,`users/${user.uid}/attachments/${id}`));return bridge.putCloudFile(id,meta,blob)}
};
async function uploadFiles(snapshot){const attachments=new Map();for(const k of ['tasks','events','notes'])for(const item of snapshot[k])for(const f of item.attachments||[])attachments.set(f.id,f);
 if(!attachments.size)return;
 if(!storage)throw Error('Есть вложения, но Firebase Storage не настроен. Облачная запись отложена.');
 for(const [id,meta] of attachments){if(uploaded.has(id))continue;const local=await bridge.getLocalFile(id);const r=api.ref(storage,`users/${user.uid}/attachments/${id}`);
  if(local)await api.uploadBytes(r,local.blob,{contentType:local.type||'application/octet-stream'});
  else {try{await api.getMetadata(r)}catch{throw Error('Нет вложения: '+meta.name)}}
  uploaded.add(id);localStorage.setItem(filesKey(user.uid),JSON.stringify([...uploaded]));
 }
}
async function sync(force=false){if(!user||!active||busy||!navigator.onLine)return;if(!dirty&&!force){status('Все записи синхронизированы ✓','good');return}
 busy=true;const startChanges=changes,uid=user.uid,snapshot=bridge.getData();
 try{status('Сохраняю в облако…');const payload=JSON.stringify(snapshot);if(new TextEncoder().encode(payload).length>850000)throw Error('Объём записей превышает лимит облачного документа. Нужна расширенная база; сохрани JSON-копию.');
  await uploadFiles(snapshot);
  const ref=api.doc(db,'users',uid,'private','organizer');
  const next=await api.runTransaction(db,async tx=>{const doc=await tx.get(ref);const previous=doc.exists()?Number(doc.data().revision)||0:0;if(!force&&previous!==rev)throw Error('CLOUD_CONFLICT');tx.set(ref,{payload,revision:previous+1,updatedAt:api.serverTimestamp(),format:1});return previous+1});
  rev=next;localStorage.setItem(revKey(uid),String(rev));if(startChanges===changes){dirty=false;localStorage.removeItem(dirtyKey(uid));status('Все записи синхронизированы ✓','good')}else schedule();
 }catch(e){if(e.message==='CLOUD_CONFLICT'){try{const doc=await api.getDoc(api.doc(db,'users',uid,'private','organizer'));remote=doc.exists()?doc.data():null}catch{}pending('На другом устройстве изменились записи. Выбери облачную версию или замени её локальной после резервного копирования.')}
 else status('Синхронизация не удалась: '+(e.message||e.code)+'. Данные остаются на устройстве.','warn')}
 finally{busy=false}
}
async function accountChanged(u){clearTimeout(timer);active=false;user=u;remote=null;show('#googleLogin',!u);show('#googleLogout',!!u);show('#cloudDecision',false);show('#cloudSyncNow',false);$('#accountSettings').textContent=u?'☁ '+(u.displayName?.split(' ')[0]||'Google'):'☁ Аккаунт';
 if(!u){switchOwner('guest');status('Локальный режим. Для облака войди через Google.');return}
 switchOwner(u.uid);dirty=localStorage.getItem(dirtyKey(u.uid))==='1';rev=Number(localStorage.getItem(revKey(u.uid))||0);uploaded=new Set(parse(localStorage.getItem(filesKey(u.uid)))||[]);
 status('Вход выполнен: '+(u.email||'Google')+'. Проверяю данные…');
 try{const doc=await api.getDoc(api.doc(db,'users',u.uid,'private','organizer'));remote=doc.exists()?doc.data():null;
  if(!remote){if(nonempty(bridge.getData())||nonempty(parse(localStorage.getItem(guestKey))))pending('В облаке ещё нет записей. Можно перенести данные с устройства или начать пустой аккаунт.');else{rev=0;ready('Аккаунт подключён. Облако пустое и готово.')}return}
  const cloud=parse(remote.payload);if(!valid(cloud))throw Error('Некорректные данные в облаке');const cloudRev=Number(remote.revision)||0;
  if(dirty&&cloudRev!==rev){pending('Локальные и облачные записи отличаются. Выбери нужную версию.');return}
  if(dirty&&cloudRev===rev){ready('Локальные изменения ожидают отправки…');schedule();return}
  rev=cloudRev;localStorage.setItem(revKey(u.uid),String(rev));replace(cloud);ready('Данные из облака загружены ✓ — '+(u.email||'Google'));
 }catch(e){status('Не удалось прочитать облако: '+(e.message||e.code)+'. Локальные записи не заменены.','warn')}
}
$('#googleLogin').onclick=async()=>{if(!auth)return;try{await api.signInWithPopup(auth,new api.GoogleAuthProvider())}catch(e){status('Ошибка входа: '+(e.message||e.code)+'. На iPhone попробуй открыть сайт в Safari и разрешить всплывающее окно.','warn')}};
$('#googleLogout').onclick=async()=>{if(!auth)return;if(dirty&&!confirm('Есть несинхронизированные изменения. Выйти? Локальная копия останется в памяти этого устройства.'))return;try{await api.signOut(auth)}catch(e){status('Не удалось выйти: '+e.message,'warn')}};
$('#cloudUseRemote').onclick=()=>{if(!user)return;if(!confirm('Использовать облачные записи вместо текущих? Сначала рекомендуется скачать резервную копию JSON.'))return;
 if(remote){const cloud=parse(remote.payload);if(!valid(cloud))return;replace(cloud);rev=Number(remote.revision)||0}
 else{replace(empty());rev=0}
 localStorage.setItem(revKey(user.uid),String(rev));dirty=false;localStorage.removeItem(dirtyKey(user.uid));ready('Облачная версия выбрана ✓')};
$('#cloudUseLocal').onclick=async()=>{if(!user)return;const local=bridge.getData(),guest=parse(localStorage.getItem(guestKey)),source=nonempty(local)?local:nonempty(guest)?guest:null;
 if(!source){alert('Нет локальных записей для загрузки. Выбери облачную версию.');return}
 if(!confirm(remote?'ЗАМЕНИТЬ облачные записи локальными? Сначала сделай JSON-копию.':'Перенести записи с устройства в твой Google-аккаунт?'))return;
 if(source!==local)replace(source);rev=remote?Number(remote.revision)||0:0;dirty=true;localStorage.setItem(dirtyKey(user.uid),'1');ready('Загружаю локальные записи…');await sync(true)};
$('#cloudSyncNow').onclick=()=>sync(false);
window.addEventListener('online',()=>{if(active&&dirty)schedule()});
if(!config.apiKey||!config.authDomain||!config.projectId||!config.appId){status('Firebase пока не настроен. Заполни firebase-config.js и установи правила доступа. Сейчас записи остаются локальными.','warn');show('#googleLogin',false)}
else{try{
 const [app,au,fs,st]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js'),import('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js'),import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js')]);
 api={...au,...fs,...st};const instance=app.initializeApp(config);firebaseApp=instance;auth=au.getAuth(instance);db=fs.getFirestore(instance);storage=config.storageBucket?st.getStorage(instance):null;
 await au.setPersistence(auth,au.browserLocalPersistence);
 au.onAuthStateChanged(auth,u=>accountChanged(u).catch(e=>status('Ошибка аккаунта: '+e.message,'warn')),e=>status('Ошибка авторизации: '+e.message,'warn'));
 }catch(e){status('Ошибка запуска Firebase: '+(e.message||e)+'. Локальные данные доступны.','warn');show('#googleLogin',false)}}


// v0.8.3-push-diagnostic: Push registration and local delivery diagnostics.
// No changes to organizer data, budget, notes, or cloud synchronization.
const pushStatusEl=$('#pushStatus');
const pushEnableBtn=$('#enablePush');
const pushDisableBtn=$('#disablePush');
const PUSH_DEVICE_KEY='po-v082-push-device-id';
const PUSH_DOC_KEY='po-v082-push-doc-id';
let messagingModule=null, messagingClient=null, pushWorking=false;
const pushStatus=(message,kind='')=>{if(pushStatusEl){pushStatusEl.textContent=message;pushStatusEl.className='account-status '+kind}};
function pushIsStandalone(){return window.navigator.standalone===true||window.matchMedia?.('(display-mode: standalone)').matches===true}
function refreshPushUi(){
 const supported='Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window;
 if(!supported){pushStatus('Это устройство или браузер не поддерживает Web Push.','warn');show('#disablePush',false);return}
 if(!pushIsStandalone()&&/iPhone|iPad|iPod/i.test(navigator.userAgent)){
  pushStatus('На iPhone Push работает только из приложения, добавленного на экран «Домой». Открой Personal Organizer через его иконку, не через вкладку Safari.','warn');
 }else if(Notification.permission==='denied'){
  pushStatus('Уведомления запрещены в настройках iPhone.','warn');
 }else if(Notification.permission==='granted'){
  pushStatus(localStorage.getItem(PUSH_DOC_KEY)?'Разрешение есть, устройство ранее зарегистрировано. Можно проверить тестовым уведомлением.':'Разрешение есть. Нажми «Включить уведомления», чтобы проверить FCM-регистрацию.');
 }else pushStatus('Уведомления ещё не разрешены.');
 show('#disablePush',!!user&&!!localStorage.getItem(PUSH_DOC_KEY));
}
function deviceId(){let id=localStorage.getItem(PUSH_DEVICE_KEY);if(!id){id=crypto.randomUUID?.()||'device-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);localStorage.setItem(PUSH_DEVICE_KEY,id)}return id}
async function activePushWorker(){
 if(!('serviceWorker' in navigator))throw Error('Service Worker не поддерживается');
 const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});
 // Avoid hanging indefinitely when a worker cannot install (e.g. an asset is missing).
 const ready=await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Service Worker не активировался за 12 секунд. Проверь файл sw.js и файлы в кеше.')),12000))]);
 if(ready.scope!==registration.scope)throw Error('Не совпадает область действия Service Worker');
 return ready;
}
async function ensurePushPermission(){
 if(!('Notification' in window))throw Error('Уведомления не поддерживаются');
 if(/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!pushIsStandalone())throw Error('Открой приложение с экрана «Домой», не в Safari');
 if(Notification.permission==='denied')throw Error('Разрешение отключено в настройках iPhone');
 if(Notification.permission!=='granted'){
  const result=await Notification.requestPermission();
  if(result!=='granted')throw Error('Разрешение на уведомления не получено');
 }
}
async function getMessagingClient(){
 if(messagingClient)return messagingClient;
 if(!firebaseApp)throw Error('Firebase ещё не подключён');
 messagingModule=await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js');
 if(!(await messagingModule.isSupported()))throw Error('Firebase Messaging не поддерживается в этой среде. Локальный тест поможет проверить уведомления iPhone.');
 messagingClient=messagingModule.getMessaging(firebaseApp);
 // Foreground delivery is distinct from a background service-worker push.
 messagingModule.onMessage(messagingClient,payload=>{
  const log={at:new Date().toISOString(),notification:!!payload.notification,data:!!payload.data};
  try{localStorage.setItem('po-v083-fcm-foreground',JSON.stringify(log))}catch(_){ }
  pushStatus('Firebase-сообщение получено, пока приложение открыто ✓. Посмотри диагностику Push.','good');
 });
 return messagingClient;
}
if(pushEnableBtn)pushEnableBtn.onclick=async()=>{
 if(pushWorking)return;
 pushWorking=true;pushEnableBtn.disabled=true;pushStatus('Проверяю регистрацию Push…');
 try{
  if(!user||!db)throw Error('Сначала войди через Google');
  await ensurePushPermission();
  const registration=await activePushWorker();
  const client=await getMessagingClient();
  const vapid=window.PERSONAL_ORGANIZER_VAPID_KEY;
  if(!vapid)throw Error('В firebase-config.js отсутствует VAPID-ключ');
  const token=await messagingModule.getToken(client,{vapidKey:vapid,serviceWorkerRegistration:registration});
  if(!token)throw Error('Firebase не выдал токен устройства');
  // Reuse an existing token document if present, so one device isn't duplicated.
  let id=localStorage.getItem(PUSH_DOC_KEY)||deviceId();
  if(!localStorage.getItem(PUSH_DOC_KEY)){
   try{
    const docs=await api.getDocs(api.collection(db,'users',user.uid,'pushTokens'));
    const existing=docs.docs.find(d=>d.data().token===token);
    if(existing)id=existing.id;
   }catch(e){console.warn('Cannot search existing push token document',e)}
  }
  await api.setDoc(api.doc(db,'users',user.uid,'pushTokens',id),{
   token,enabled:true,platform:'web',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',
   userAgent:navigator.userAgent,updatedAt:api.serverTimestamp()
  },{merge:true});
  localStorage.setItem(PUSH_DOC_KEY,id);
  pushStatus('FCM-токен получен и записан в Firestore ✓. Теперь проверь кнопку «Тест на этом iPhone». Автоматические напоминания за 24 часа ещё не настроены.','good');
  show('#disablePush',true);
 }catch(e){pushStatus('Не удалось подключить Push: '+(e.message||e),'warn');console.error('Push setup failed',e)}
 finally{pushWorking=false;pushEnableBtn.disabled=false}
};
if(pushDisableBtn)pushDisableBtn.onclick=async()=>{
 if(!confirm('Отключить Push на этом устройстве? Разрешение в настройках iPhone останется.'))return;
 pushDisableBtn.disabled=true;
 try{
  const id=localStorage.getItem(PUSH_DOC_KEY);
  if(user&&db&&id)await api.deleteDoc(api.doc(db,'users',user.uid,'pushTokens',id));
  if(messagingClient&&messagingModule)await messagingModule.deleteToken(messagingClient);
  localStorage.removeItem(PUSH_DOC_KEY);
  pushStatus('Push отключён для этого устройства.');show('#disablePush',false);
 }catch(e){pushStatus('Не удалось отключить Push: '+(e.message||e),'warn')}
 finally{pushDisableBtn.disabled=false}
};
// This bypasses Firebase sending completely and tests iPhone + the service worker.
const pushPanel=$('.push-panel');
if(pushPanel){
 const localTest=document.createElement('button');
 localTest.type='button';localTest.className='secondary';localTest.textContent='🔔 Тест на этом iPhone';
 localTest.style.width='100%';
 localTest.onclick=async()=>{
  localTest.disabled=true;
  try{
   await ensurePushPermission();
   const registration=await activePushWorker();
   await registration.showNotification('Personal Organizer — тест 🔔',{
    body:'Это локальное уведомление. Firebase-сервер в этом тесте не участвует.',
    icon:'./icon-192.png',badge:'./icon-192.png',tag:'po-local-test-'+Date.now(),
    data:{url:new URL('./',location.href).href}
   });
   pushStatus('Локальное уведомление передано iPhone ✓. Проверь Центр уведомлений. Если его нет, проблема ещё до Firebase-доставки.','good');
  }catch(e){pushStatus('Локальный тест не удался: '+(e.message||e),'warn');console.error('Local push test failed',e)}
  finally{localTest.disabled=false}
 };
 pushPanel.append(localTest);
}
refreshPushUi();


// v0.8.3: Read-only diagnostics; no organizer data is modified.
if(pushPanel){
 const diagnosticButton=document.createElement('button');
 diagnosticButton.type='button';
 diagnosticButton.className='secondary';
 diagnosticButton.textContent='🔎 Проверить доставку Push';
 diagnosticButton.style.width='100%';
 const report=document.createElement('div');
 report.className='account-status';
 report.style.cssText='white-space:pre-line;overflow-wrap:anywhere;font-size:12px;line-height:1.5';
 report.textContent='Диагностика v0.8.3. После отправки теста через Firebase вернись сюда и нажми кнопку.';
 diagnosticButton.onclick=async()=>{
  diagnosticButton.disabled=true;
  const lines=['Диагностика Push · v0.8.3'];
  try{
   lines.push('Разрешение: '+(('Notification' in window)?Notification.permission:'не поддерживается'));
   lines.push('Запущено с экрана «Домой»: '+(pushIsStandalone()?'да':'нет'));
   if('serviceWorker' in navigator){
    const reg=await navigator.serviceWorker.getRegistration('./');
    lines.push('Service Worker: '+(reg?.active?'активен':reg?.installing?'устанавливается':reg?.waiting?'ожидает':'не найден'));
    if(reg?.active){
     const sub=await reg.pushManager?.getSubscription();
     lines.push('Push-подписка: '+(sub?'есть':'нет'));
    }
   }else lines.push('Service Worker: не поддерживается');
   const previous=localStorage.getItem('po-v083-fcm-foreground');
   if(previous){
    const f=JSON.parse(previous);
    lines.push('Firebase в открытом приложении: '+new Date(f.at).toLocaleString('ru-RU'));
   }
   if('caches' in window){
    const cache=await caches.open('po-push-diagnostic-v1');
    const url=new URL('./__po_push_diagnostic__.json',location.href).href;
    const response=await cache.match(url);
    const diag=response?await response.json():null;
    if(diag?.events?.length){
     lines.push('События в фоновом режиме:');
     for(const item of diag.events.slice(-6)){
      const detail=item.kind==='push-received'?' (push получен)':item.kind==='fcm-background-callback'?' (Firebase обработал)':item.kind==='firebase-worker-init-error'?' (ошибка Firebase)':'';
      lines.push('• '+new Date(item.at).toLocaleString('ru-RU')+' — '+item.kind+detail);
      if(item.error)lines.push('  '+item.error);
     }
    }else lines.push('Фоновых Push в журнале пока нет.');
   }
   lines.push('Токен не показывается; данные календаря не затрагиваются.');
  }catch(e){lines.push('Ошибка проверки: '+(e?.message||e))}
  report.textContent=lines.join('\n');
  diagnosticButton.disabled=false;
 };
 pushPanel.append(diagnosticButton,report);
}
