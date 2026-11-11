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
let auth,db,storage,api,user=null,remote=null,rev=0,dirty=false,active=false,busy=false,muted=false,timer,changes=0,uploaded=new Set();
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
 api={...au,...fs,...st};const instance=app.initializeApp(config);auth=au.getAuth(instance);db=fs.getFirestore(instance);storage=config.storageBucket?st.getStorage(instance):null;
 await au.setPersistence(auth,au.browserLocalPersistence);
 au.onAuthStateChanged(auth,u=>accountChanged(u).catch(e=>status('Ошибка аккаунта: '+e.message,'warn')),e=>status('Ошибка авторизации: '+e.message,'warn'));
 }catch(e){status('Ошибка запуска Firebase: '+(e.message||e)+'. Локальные данные доступны.','warn');show('#googleLogin',false)}}
