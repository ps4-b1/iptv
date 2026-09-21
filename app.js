const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const state = {
  channels: [],
  filtered: [],
  current: null,
  category: "الكل",
  favorites: JSON.parse(localStorage.getItem("iptv_favorites") || "[]"),
  source: localStorage.getItem("iptv_source") || "",
  sortAsc: true
};

const video = $("#video");

function saveFavorites(){ localStorage.setItem("iptv_favorites", JSON.stringify(state.favorites)); }

function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function channelCategory(name, group=""){
  const s=(name+" "+group).toLowerCase();
  if(/sport|bein|ssc|رياض|sport/.test(s)) return "رياضة";
  if(/news|خبر|أخبار|الجزيرة|sky news|bbc/.test(s)) return "أخبار";
  if(/movie|cinema|film|فيلم|أفلام/.test(s)) return "أفلام";
  if(/kids|cartoon|children|أطفال|كرتون/.test(s)) return "أطفال";
  return "عامة";
}

function normalizeChannel(c){
  return {
    id:String(c.id ?? c.url ?? Math.random()),
    name:c.name || "قناة",
    url:c.url || "",
    logo:c.logo || "",
    group:c.group || "",
    category:c.category || channelCategory(c.name||"",c.group||"")
  };
}

function render(){
  let list=[...state.channels];
  if(state.category==="المفضلة"){
    list=list.filter(c=>state.favorites.includes(c.id));
  } else if(state.category!=="الكل"){
    list=list.filter(c=>c.category===state.category);
  }
  const q=$("#channelSearch").value.trim().toLowerCase();
  if(q) list=list.filter(c=>(c.name+" "+c.group).toLowerCase().includes(q));
  list.sort((a,b)=>state.sortAsc?a.name.localeCompare(b.name):b.name.localeCompare(a.name));
  state.filtered=list;
  $("#count").textContent=`${list.length} قناة`;
  $("#channels").innerHTML=list.map(c=>{
    const fav=state.favorites.includes(c.id);
    const logo=c.logo ? `<img class="ch-logo" src="${esc(c.logo)}" alt="">` : `<div class="ch-logo">TV</div>`;
    return `<div class="channel ${state.current?.id===c.id?'selected':''}" data-id="${esc(c.id)}">
      ${logo}<div class="ch-body"><strong>${esc(c.name)}</strong><small>${esc(c.group||c.category)} · <span class="live">● مباشر</span></small></div>
      <button class="heart" data-fav="${esc(c.id)}">${fav?'♥':'♡'}</button>
    </div>`;
  }).join("");
  $("#empty").style.display=list.length?"none":"block";
  $$("#channels .channel").forEach(el=>el.addEventListener("click",e=>{
    if(e.target.closest("[data-fav]")) return;
    playChannel(state.channels.find(c=>c.id===el.dataset.id));
  }));
  $$("#channels [data-fav]").forEach(b=>b.addEventListener("click",e=>{
    e.stopPropagation(); toggleFavorite(e.currentTarget.dataset.fav); render();
  }));
}

function toggleFavorite(id){
  state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];
  saveFavorites();
  if(state.current) updateCurrentFavorite();
}

function updateCurrentFavorite(){
  const yes=state.current && state.favorites.includes(state.current.id);
  $("#favoriteCurrent").textContent=yes?"♥":"♡";
  $("#favoriteCurrent").classList.toggle("fav",!!yes);
}

function playChannel(c){
  if(!c || !c.url) return;
  state.current=c;
  $("#currentName").textContent=c.name;
  $("#currentCategory").textContent=c.category+(c.group?` · ${c.group}`:"");
  $("#currentUrl").textContent=c.url;
  $("#currentLogo").innerHTML=c.logo?`<img src="${esc(c.logo)}" style="max-width:100%;max-height:100%;border-radius:7px">`:"TV";
  $("#videoEmpty").style.display="none";
  $("#video").src=c.url;
  $("#video").load();
  video.play().catch(()=>{});
  updateCurrentFavorite();
  render();
}

function parseM3U(text){
  const lines=text.replace(/^\uFEFF/,"").split(/\r?\n/);
  const out=[]; let meta=null;
  for(const raw of lines){
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith("#EXTINF:")){
      const comma=line.indexOf(",");
      const attrs=line.slice(0,comma<0?line.length:comma);
      const name=comma<0?"قناة":line.slice(comma+1).trim();
      const logo=(attrs.match(/tvg-logo="([^"]*)"/i)||[])[1]||"";
      const group=(attrs.match(/group-title="([^"]*)"/i)||[])[1]||"";
      meta={name,logo,group};
    } else if(!line.startsWith("#")){
      const c=normalizeChannel({...(meta||{}),url:line,id:line});
      out.push(c); meta=null;
    }
  }
  return out;
}

async function loadM3U(url){
  try{
    const r=await fetch(url,{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const text=await r.text();
    const list=parseM3U(text);
    if(!list.length) throw new Error("لم يتم العثور على قنوات في الملف");
    state.channels=list; state.source=url; localStorage.setItem("iptv_source",url);
    state.category="الكل"; updateChips(); render(); closeModal();
    toast(`تم تحميل ${list.length} قناة`);
  }catch(e){
    showError("تعذر تحميل M3U", e.message+" — إذا ظهر CORS فالمشكلة من خادم القائمة، وليس من GitHub Pages.");
  }
}

async function loadXtream(host,user,pass){
  host=host.trim().replace(/\/+$/,"");
  if(!/^https?:\/\//i.test(host)) host="http://"+host;
  const api=`${host}/player_api.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  try{
    const r=await fetch(api,{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const data=await r.json();
    const streams=Array.isArray(data.live_streams)?data.live_streams:[];
    if(!streams.length) throw new Error("الخادم لم يُرجع قنوات مباشرة");
    const list=streams.map(x=>normalizeChannel({
      id:x.stream_id,url:`${host}/live/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/${x.stream_id}.${x.container_extension||"m3u8"}`,
      name:x.name,logo:x.stream_icon,group:x.category_name
    }));
    state.channels=list; state.source=host; localStorage.setItem("iptv_source",host);
    state.category="الكل"; updateChips(); render(); closeModal();
    toast(`تم الاتصال بـ Xtream وتحميل ${list.length} قناة`);
  }catch(e){
    showError("تعذر الاتصال بـ Xtream", e.message+" — تحقق من CORS وبيانات الخادم؛ GitHub Pages لا يستطيع تجاوز حماية CORS.");
  }
}

function modal(title,html){
  $("#modalTitle").textContent=title; $("#modalBody").innerHTML=html; $("#modal").classList.add("open");
}
function closeModal(){ $("#modal").classList.remove("open"); }
function showError(title,msg){modal(title,`<div class="notice bad">${esc(msg)}</div>`)}
function toast(msg){ 
  const n=document.createElement("div"); n.textContent=msg;
  Object.assign(n.style,{position:"fixed",bottom:"65px",right:"20px",zIndex:100,padding:"12px 16px",background:"#0b3150",border:"1px solid #168cff",borderRadius:"9px"});
  document.body.appendChild(n); setTimeout(()=>n.remove(),2800);
}

function m3uModal(){
  modal("إضافة قائمة M3U",`<div class="notice">أدخل رابط <b>M3U/M3U8</b> مباشر يسمح بالوصول من المتصفح (CORS).</div>
  <div class="form-row"><label>رابط القائمة</label><input id="m3uUrl" placeholder="https://example.com/playlist.m3u"></div>
  <div class="modal-actions"><button class="primary" id="loadM3UConfirm">تحميل القائمة</button></div>`);
  $("#loadM3UConfirm").onclick=()=>loadM3U($("#m3uUrl").value.trim());
}

function xtreamModal(){
  modal("إعدادات Xtream Codes",`<div class="notice">الواجهة تتصل مباشرة بـ <b>player_api.php</b>. يجب أن يسمح مزود الخدمة بطلبات المتصفح CORS.</div>
  <div class="form-row"><label>الخادم</label><input id="xHost" placeholder="http(s)://server:port"></div>
  <div class="form-row"><label>اسم المستخدم</label><input id="xUser"></div>
  <div class="form-row"><label>كلمة المرور</label><input id="xPass" type="password"></div>
  <div class="modal-actions"><button class="primary" id="xtreamConnect">اتصال وتحميل</button></div>`);
  $("#xtreamConnect").onclick=()=>loadXtream($("#xHost").value,$("#xUser").value,$("#xPass").value);
}

async function internetCheck(){
  const card=$("#netCard"), title=$("#netTitle"), txt=$("#netText"), dot=$("#netDot"), footer=$("#footerNet");
  const start=performance.now();
  try{
    if(navigator.onLine===false) throw new Error("المتصفح يقول إن الاتصال غير متصل");
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),7000);
    await fetch("https://www.gstatic.com/generate_204?iptv="+Date.now(),{mode:"no-cors",cache:"no-store",signal:controller.signal});
    clearTimeout(timer);
    const ms=Math.round(performance.now()-start);
    title.textContent="الإنترنت يعمل بنجاح";
    txt.textContent=`تم الوصول إلى الإنترنت · ${ms} ms`;
    dot.style.background="#00e885"; card.classList.remove("bad");
    footer.textContent=`● الإنترنت يعمل · ${ms} ms`;
    footer.style.color="#00e58a"; $("#speedText").textContent=`${ms} ms`;
  }catch(e){
    title.textContent="تعذر تأكيد الإنترنت";
    txt.textContent="تحقق من Wi‑Fi / الشبكة أو DNS";
    card.classList.add("bad"); dot.style.background="#ff5c62";
    footer.textContent="● لم يتم تأكيد الإنترنت"; footer.style.color="#ff7373";
    $("#speedText").textContent="غير متاح";
  }
}

function clock(){
  const d=new Date();
  $("#clock").textContent=d.toLocaleTimeString("ar",{hour:"2-digit",minute:"2-digit",hour12:false});
  $("#date").textContent=d.toLocaleDateString("ar",{year:"numeric",month:"long",day:"numeric"});
}
function updateChips(){ $$(".chip").forEach(x=>x.classList.toggle("active",x.dataset.cat===state.category)); }

$$(".chip").forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;updateChips();render()});
$("#channelSearch").oninput=render;
$("#sortBtn").onclick=()=>{state.sortAsc=!state.sortAsc;render()};
$("#favoriteCurrent").onclick=()=>{if(state.current){toggleFavorite(state.current.id);render()}};
$("#fullscreenBtn").onclick=()=>video.requestFullscreen?.();
$("#qualityBtn").onclick=()=>toast("الجودة تعتمد على البث الذي يقدمه مزود IPTV.");
$("#infoBtn").onclick=()=>{if(!state.current)return toast("اختر قناة أولاً");modal("معلومات القناة",`<div class="notice"><b>${esc(state.current.name)}</b><br>التصنيف: ${esc(state.current.category)}<br>الرابط: ${esc(state.current.url)}</div>`)};
$("#m3uBtn").onclick=m3uModal; $("#emptyM3U").onclick=m3uModal;
$("#xtreamBtn").onclick=xtreamModal; $("#emptyXtream").onclick=xtreamModal;
$("#favBtn").onclick=()=>{state.category="المفضلة";updateChips();$("#listTitle").textContent="المفضلة";render()};
$("#searchBtn").onclick=()=>$("#channelSearch").focus();
$("#settingsBtn").onclick=()=>modal("إعدادات المشغل",`<div class="notice">يتم حفظ المفضلة ورابط المصدر محلياً في المتصفح فقط.<br><br>إذا لم تعمل قائمة M3U أو Xtream، ابحث عن رسالة CORS: يجب أن يسمح الخادم بالطلبات من صفحات الويب.</div>`);
$("#settingsQuick").onclick=()=>$("#settingsBtn").click();
$("#helpBtn").onclick=()=>modal("المساعدة",`<div class="notice">1) تأكد أن بطاقة الإنترنت أصبحت خضراء.<br>2) أضف رابط M3U أو بيانات Xtream.<br>3) اختر قناة.<br>4) إذا ظهرت CORS، لا يمكن للصفحة تجاوز سياسة الخادم.</div>`);
$("#aboutBtn").onclick=()=>modal("حول",`<div class="notice">IPTV Web Player v2.0<br>واجهة HTML/CSS/JavaScript مستقلة ومناسبة للكمبيوتر ومتصفح PS4.<br>لا تحتوي على قنوات أو اشتراكات.</div>`);
$("#closeModal").onclick=closeModal;
$("#modal").onclick=e=>{if(e.target.id==="modal")closeModal()};

$$(".nav[data-filter]").forEach(b=>b.onclick=()=>{state.category=b.dataset.filter;updateChips();$("#listTitle").textContent=b.querySelector("span").textContent;render();$$(".nav").forEach(n=>n.classList.remove("active"));b.classList.add("active")});
$("#video").addEventListener("error",()=>toast("تعذر تشغيل البث: تحقق من صيغة البث أو صلاحية الرابط ومتصفح PS4."));
$("#video").addEventListener("playing",()=>$("#videoEmpty").style.display="none");

clock(); setInterval(clock,1000); internetCheck(); setInterval(internetCheck,30000); render();
