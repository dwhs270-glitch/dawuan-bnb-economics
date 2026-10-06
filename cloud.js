import { firebaseConfig, teacherEmail } from './cloud-config.js';
const el=id=>document.getElementById(id);
let user=null,ready=false,revision=0,auth,db,sdk,ref,busy=false,queued=false,conflict=false,sequence=0,epoch=0,lastSavedPayload='';
const app=window.bnbApp;
const status=text=>{el('cloudStatus').textContent=text;el('saveStatus').textContent=text};
function cacheKey(){return user?'dawuan-bnb-account-'+user.uid:null}
function draft(pending){if(!user)return;try{localStorage.setItem(cacheKey(),JSON.stringify({payload:app.snapshot(),pending,revision,savedAt:Date.now()}))}catch{status('本機備份失敗；請匯出填答檔，並確認雲端同步狀態。')}}
function noteError(e){if(e.message==='CONFLICT')return '另一部裝置已更新資料。已保留本機填答，請匯出後重新載入雲端版本。';return '尚未同步至雲端。請確認網路與登入狀態，恢復連線後會自動同步；也可先匯出填答檔。'}
async function flush(){
  if(!ready||!user||conflict)return;
  if(busy){queued=true;return}
  busy=true;const startEpoch=epoch;
  try {
    do {
      queued=false;const sentSequence=sequence,expected=revision,docRef=ref,owner=user.uid;
      const payload=JSON.stringify(app.snapshot());
      if(payload.length>100000)throw Error('TOO_LARGE');
      const data={ownerUid:owner,payload,summary:el('report').textContent.slice(0,40000),groupLabel:el('group').value.slice(0,200),bnbName:el('name').value.slice(0,200),revision:expected+1,updatedAt:sdk.serverTimestamp()};
      status('正在同步至雲端…');
      await sdk.runTransaction(db,async tx=>{const current=await tx.get(docRef);if((current.exists()?current.data().revision:0)!==expected)throw Error('CONFLICT');tx.set(docRef,data)});
      if(epoch!==startEpoch)return;
      revision=expected+1;lastSavedPayload=payload;queued=queued||sequence!==sentSequence||JSON.stringify(app.snapshot())!==payload;
      draft(queued);status(queued?'正在儲存最新修改…':'已自動儲存至雲端 · '+new Date().toLocaleTimeString('zh-TW'));
    }while(queued&&navigator.onLine&&epoch===startEpoch);
  }catch(e){if(epoch===startEpoch){draft(true);conflict=e.message==='CONFLICT';el('reloadCloud').hidden=!conflict;status(noteError(e))}}
  finally{busy=false}
}
window.addEventListener('bnb:changed',()=>{if(!ready||!user)return;sequence++;draft(true);status(navigator.onLine?'修改已備份；即將自動同步…':'離線中，修改已暫存本機；恢復連線後同步。');clearTimeout(window.bnbSyncTimer);window.bnbSyncTimer=setTimeout(flush,1200)});
window.addEventListener('online',flush);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&ready&&JSON.stringify(app.snapshot())!==lastSavedPayload){sequence++;draft(true);flush()}});
el('reloadCloud').onclick=()=>{if(confirm('本機未同步內容請先匯出。確定重新載入雲端版本？'))location.reload()};
el('signOutCloud').onclick=async()=>{if(busy){status('正在同步，請稍後再登出。');return}let cached;try{cached=JSON.parse(localStorage.getItem(cacheKey()))}catch{}if(cached?.pending&&!confirm('有尚未同步的填答，請先匯出備份。仍要登出？'))return;await sdk.signOut(auth)};
el('useLocalDraft').onclick=()=>{try{const cached=JSON.parse(localStorage.getItem(cacheKey()));if(!cached?.payload)return;if(!confirm('將以此帳號的本機備份取代目前雲端內容，是否繼續？'))return;app.restore(cached.payload);el('useLocalDraft').hidden=true;window.dispatchEvent(new Event('bnb:changed'))}catch{status('無法恢復本機備份，請匯入填答檔。')}};
function resetForm(){app.blank();app.update()}
async function loadUser(u){
  epoch++;user=u;ready=false;conflict=false;sequence=0;revision=0;resetForm();el('teacherPanel').hidden=true;el('useLocalDraft').hidden=true;el('signOutCloud').hidden=!u;el('loginCloud').hidden=!!u;app.lock(true);
  if(!u){el('cloudUser').textContent='尚未登入';status('請登入 Google 帳號，以跨裝置接續填答。');return}
  el('cloudUser').textContent=u.displayName||u.email||'已登入';status('正在讀取這個帳號的雲端填答…');const currentEpoch=epoch;ref=sdk.doc(db,'bnbResponses',u.uid);
  try{
    const d=await sdk.getDoc(ref);if(currentEpoch!==epoch)return;
    if(d.exists()){app.restore(JSON.parse(d.data().payload));revision=d.data().revision}
    lastSavedPayload=JSON.stringify(app.snapshot());
    let cached;try{cached=JSON.parse(localStorage.getItem(cacheKey()));if(cached?.pending&&JSON.stringify(cached.payload)===lastSavedPayload){cached.pending=false;draft(false)}}catch{}
    el('useLocalDraft').hidden=!cached?.pending;
    ready=true;app.lock(false);status(d.exists()?'已載入雲端填答；修改後自動儲存。':'登入完成，開始填寫後會自動儲存至雲端。');
    if(cached?.pending)status('已載入雲端版本，另有本機未同步備份；可選「恢復本機備份」。');
    const teacherDoc=await sdk.getDoc(sdk.doc(db,'bnbTeachers',u.uid));if(currentEpoch===epoch&&(teacherDoc.exists()||u.email===teacherEmail)){el('teacherPanel').hidden=false;loadTeacher()}
  }catch(e){status('無法讀取雲端資料，填寫暫停以避免覆蓋。請確認網路後重新整理。')}
}
async function loadTeacher(){el('teacherList').textContent='正在讀取各組成果…';try{const docs=await sdk.getDocs(sdk.collection(db,'bnbResponses'));el('teacherList').replaceChildren();if(docs.empty){el('teacherList').textContent='尚未有學生填答。';return}docs.docs.sort((a,b)=>(a.data().groupLabel||'').localeCompare(b.data().groupLabel||'','zh-TW')).forEach(d=>{const v=d.data(),box=document.createElement('details'),title=document.createElement('summary'),pre=document.createElement('pre');title.textContent=(v.groupLabel||'未填組別')+'｜'+(v.bnbName||'未命名民宿')+'｜更新：'+(v.updatedAt?.toDate().toLocaleString('zh-TW')||'—');pre.textContent=v.summary;pre.style.whiteSpace='pre-wrap';pre.style.overflowWrap='anywhere';box.style.marginBottom='16px';box.append(title,pre);el('teacherList').append(box)})}catch{el('teacherList').textContent='無法查看各組資料，請確認教師帳號權限。'}}
el('refreshTeacher').onclick=loadTeacher;
app.lock(true);
if(!firebaseConfig){status('雲端服務尚未設定。此為修改稿，尚未啟用跨裝置儲存。');el('loginCloud').disabled=true;}
else{
  try{
    const [a,b,c]=await Promise.all([import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js')]);sdk={...b,...c};const firebaseApp=a.initializeApp(firebaseConfig);auth=b.getAuth(firebaseApp);db=c.getFirestore(firebaseApp);
    el('loginCloud').onclick=async()=>{try{await b.signInWithPopup(auth,new b.GoogleAuthProvider())}catch(e){status(e.code==='auth/popup-blocked'?'登入視窗被阻擋，請允許彈出視窗後重試。':'登入未完成，請重新按「Google 登入」。')}};
    b.onAuthStateChanged(auth,loadUser);
  }catch{status('雲端服務載入失敗，請檢查網路後重新整理。')}
}
