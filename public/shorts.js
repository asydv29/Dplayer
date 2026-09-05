const $=(s,ctx)=>(ctx||document).querySelector(s);
const $$=(s,ctx)=>Array.from((ctx||document).querySelectorAll(s));
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const api=(u,o)=>fetch(u,o).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Request failed");return j});
function fmtViews(n){n=Number(n||0);if(n>=1e9)return (n/1e9).toFixed(1).replace(".0","")+"B views";if(n>=1e6)return (n/1e6).toFixed(1).replace(".0","")+"M views";if(n>=1e3)return (n/1e3).toFixed(1).replace(".0","")+"K views";return n+" views"}
function ago(d){if(!d)return "Recently";const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";if(s<2592000)return Math.floor(s/86400)+"d ago";if(s<31536000)return Math.floor(s/2592000)+"mo ago";return Math.floor(s/31536000)+"y ago"}

const feed=$("#shortsFeed"),emptyEl=$("#shortsEmpty"),loadingEl=$("#shortsLoading"),toastEl=$("#shortsToast");
function toast(m){toastEl.textContent=m;toastEl.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove("show"),2200)}

const params=new URLSearchParams(location.search);
const startId=params.get("id");
const onlyLiked=params.get("list")==="liked";

let muted=localStorage.getItem("mytube_shorts_muted")!=="0";
let speed=1;
let quality="auto";
let items=[];
let activeIndex=-1;
let currentMenuSlide=null;

function slideHTML(v,i){
  const letter=esc((v.title||"M").trim()[0]||"M").toUpperCase();
  const stream="/api/videos/"+encodeURIComponent(v.id)+"/stream";
  return `<section class="short-slide" data-id="${esc(v.id)}" data-index="${i}">
    <video class="short-video" data-src="${stream}" playsinline webkit-playsinline preload="none" poster="${esc(v.thumbnail||"")}"${muted?" muted":""}></video>
    <div class="short-spinner-wrap hidden"><div class="short-mini-spinner"></div></div>
    <div class="short-tap-layer"></div>
    <div class="short-center-icon hidden">▶</div>
    <div class="short-seek-flash left"><span class="short-seek-icon">◁◁</span><span class="short-seek-amount">10s</span></div>
    <div class="short-seek-flash right"><span class="short-seek-icon">▷▷</span><span class="short-seek-amount">10s</span></div>
    <div class="short-speed-flash">▶▶ 2x</div>

    <div class="shorts-topbar">
      <span class="shorts-topbar-title">Shorts</span>
      <div class="shorts-topbar-actions">
        <button class="shorts-icon-btn short-mute-btn${muted?" is-muted":""}" aria-label="Mute">
          <img class="short-icon-volume shorts-icon-invert" src="/icons/volume.png" alt="">
          <img class="short-icon-mute" src="/icons/mute.png" alt="">
        </button>
        <button class="shorts-icon-btn short-search-btn" aria-label="Search"><img src="/icons/search.png" alt=""></button>
        <button class="shorts-icon-btn shorts-dots-btn short-more-btn" aria-label="More options">⋮</button>
      </div>
    </div>

    <div class="short-rail">
      <button class="short-rail-btn short-like-btn${v.liked?" liked":""}" aria-label="Like">
        <span class="short-rail-icon"><img class="shorts-icon-invert" src="/icons/heart.png" alt=""></span>
        <span class="short-rail-count short-like-label">${v.liked?"Liked":"Like"}</span>
      </button>
      <button class="short-rail-btn short-download-btn" aria-label="Download">
        <span class="short-rail-icon"><img class="shorts-icon-invert" src="/icons/download.png" alt=""></span>
        <span class="short-rail-count">Save</span>
      </button>
      <button class="short-rail-btn short-fav-btn${v.favorite?" faved":""}" aria-label="Favorite">
        <span class="short-rail-icon short-fav-star">${v.favorite?"★":"☆"}</span>
        <span class="short-rail-count">${v.favorite?"Saved":"Favorite"}</span>
      </button>
    </div>

    <div class="short-bottom-info">
      <div class="short-channel-row">
        <span class="short-channel-avatar">${letter}</span>
        <span class="short-channel-name">D Player</span>
      </div>
      <p class="short-title">${esc(v.title||"Untitled")}</p>
      <p class="short-stats">${fmtViews(v.views)} · ${ago(v.createdTime)}</p>
    </div>

    <div class="short-progress"><div class="short-progress-track"><div class="short-progress-fill"><span class="short-progress-thumb"></span></div></div></div>
  </section>`;
}

function render(){
  feed.innerHTML=items.map((v,i)=>slideHTML(v,i)).join("");
  $$(".short-slide").forEach(wireSlide);
}

function ensureLoaded(i){
  for(const j of [i-1,i,i+1,i+2]){
    const slide=feed.children[j];
    if(!slide)continue;
    const v=slide.querySelector("video");
    if(!v.getAttribute("src")){
      v.muted=muted;
      v.defaultMuted=muted;
      v.preload="auto";
      v.playbackRate=speed;
      v.src=v.dataset.src;
      v.load();
    }
  }
}

function updateCenterIcon(slide,v){
  const icon=slide.querySelector(".short-center-icon");
  const playing=!v.paused&&!v.ended;
  icon.classList.toggle("hidden",playing);
}

function activateSlide(i,slideEl){
  if(i===activeIndex)return;
  const prevSlide=activeIndex>=0?feed.children[activeIndex]:null;
  if(prevSlide){
    const pv=prevSlide.querySelector("video");
    if(pv)pv.pause();
  }
  activeIndex=i;
  ensureLoaded(i);
  const v=slideEl.querySelector("video");
  v.muted=muted;
  v.playbackRate=speed;
  const tryPlay=()=>v.play().catch(()=>{
    // Browsers often block un-muted autoplay when play() is triggered from
    // a scroll/IntersectionObserver callback rather than a direct click/tap.
    // Fall back to a muted autoplay so the next Short still starts on its
    // own, then restore sound right after if the user has sound turned on.
    if(!v.muted){
      v.muted=true;
      v.play().then(()=>{if(!muted)v.muted=false}).catch(()=>updateCenterIcon(slideEl,v));
    }else{
      updateCenterIcon(slideEl,v);
    }
  });
  if(v.readyState>=2)tryPlay();else v.addEventListener("loadeddata",tryPlay,{once:true});
  updateCenterIcon(slideEl,v);
  const item=items[i];
  if(item){
    history.replaceState(null,"","/shorts.html?id="+encodeURIComponent(item.id));
    document.title=(item.title||"Shorts")+" — Shorts — D Player";
  }
}

function setupObserver(){
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      const slide=entry.target;
      const i=Number(slide.dataset.index);
      const v=slide.querySelector("video");
      if(entry.intersectionRatio>=0.6){
        if(i!==activeIndex)activateSlide(i,slide);
      }else if(i!==activeIndex&&v){
        v.pause();
      }
    });
  },{threshold:[0,0.6,1]});
  $$(".short-slide").forEach(s=>observer.observe(s));
}

function wireSlide(slide){
  const v=slide.querySelector("video");
  const tap=slide.querySelector(".short-tap-layer");
  const spinner=slide.querySelector(".short-spinner-wrap");
  let counted=false;

  // Auto-hide: once playback is under way, fade everything except the
  // mute button, the three-dot menu and Like. Pausing or tapping brings
  // the full UI straight back.
  let hideTimer=null;
  const showUI=()=>{clearTimeout(hideTimer);slide.classList.remove("ui-hidden")};
  const scheduleHide=()=>{
    clearTimeout(hideTimer);
    hideTimer=setTimeout(()=>{if(!v.paused&&!v.ended)slide.classList.add("ui-hidden")},2200);
  };
  v.addEventListener("play",scheduleHide);
  v.addEventListener("pause",showUI);
  v.addEventListener("ended",showUI);
  v.addEventListener("seeking",showUI);

  // ---- Gestures on the tap layer ----
  // • Single tap:            play / pause
  // • Double tap left/right: seek -10s / +10s (accumulates on rapid repeats)
  // • Press & hold:          play at 2x while held, back to normal on release
  const seekFlashLeft=slide.querySelector(".short-seek-flash.left");
  const seekFlashRight=slide.querySelector(".short-seek-flash.right");
  const speedFlash=slide.querySelector(".short-speed-flash");
  const LONG_PRESS_MS=350,TAP_MOVE_TOLERANCE=12,DOUBLE_TAP_MS=300,SEEK_STEP=10;
  let longPressTimer=null,isLongPressing=false,pointerActive=false,pointerStartX=0,pointerStartY=0;
  let tapTimer=null,pendingSide=null;
  let seekAccum={left:0,right:0},seekAccumTimer=null;

  function startLongPress(){
    isLongPressing=true;
    v.playbackRate=2;
    speedFlash.classList.add("show");
  }
  function endLongPress(){
    if(!isLongPressing)return;
    isLongPressing=false;
    v.playbackRate=speed;
    speedFlash.classList.remove("show");
  }
  v.addEventListener("pause",endLongPress);

  function doSeek(side){
    if(!v.duration)return;
    const delta=side==="left"?-SEEK_STEP:SEEK_STEP;
    v.currentTime=Math.min(Math.max(0,v.currentTime+delta),v.duration);
    const el=side==="left"?seekFlashLeft:seekFlashRight;
    const other=side==="left"?seekFlashRight:seekFlashLeft;
    other.classList.remove("show");
    seekAccum[side]+=SEEK_STEP;
    seekAccum[side==="left"?"right":"left"]=0;
    el.querySelector(".short-seek-amount").textContent=seekAccum[side]+"s";
    el.classList.add("show");
    clearTimeout(seekAccumTimer);
    seekAccumTimer=setTimeout(()=>{
      el.classList.remove("show");
      seekAccum.left=0;seekAccum.right=0;
    },650);
  }

  tap.addEventListener("contextmenu",e=>e.preventDefault());

  // Laptops (mouse/trackpad) and tablets (larger touchscreens) don't need
  // the double-tap-to-seek debounce that phones use — on those devices a
  // single click/tap should pause or play immediately. Phones keep the
  // short wait so a fast second tap on the same side can still seek.
  function isImmediateTapDevice(pointerType){
    if(pointerType==="mouse"||pointerType==="pen")return true;
    return Math.min(window.innerWidth,window.innerHeight)>=600;
  }
  function togglePlayback(){
    if(v.paused||v.ended)v.play().catch(()=>{});else v.pause();
  }

  tap.addEventListener("pointerdown",e=>{
    if(e.pointerType==="mouse"&&e.button!==0)return;
    pointerActive=true;
    pointerStartX=e.clientX;pointerStartY=e.clientY;
    clearTimeout(longPressTimer);
    longPressTimer=setTimeout(()=>{if(pointerActive)startLongPress()},LONG_PRESS_MS);
  });

  tap.addEventListener("pointermove",e=>{
    if(!pointerActive)return;
    if(Math.abs(e.clientX-pointerStartX)>TAP_MOVE_TOLERANCE||Math.abs(e.clientY-pointerStartY)>TAP_MOVE_TOLERANCE){
      clearTimeout(longPressTimer);
      if(isLongPressing)endLongPress();
      pointerActive=false;
    }
  });

  function finishPress(e){
    clearTimeout(longPressTimer);
    if(!pointerActive)return;
    pointerActive=false;
    if(isLongPressing){endLongPress();return}
    const rect=tap.getBoundingClientRect();
    const clientX=e.clientX!=null?e.clientX:pointerStartX;
    const side=(clientX-rect.left)<rect.width/2?"left":"right";
    if(tapTimer&&pendingSide===side){
      clearTimeout(tapTimer);tapTimer=null;pendingSide=null;
      doSeek(side);
      return;
    }
    clearTimeout(tapTimer);
    pendingSide=side;

    if(isImmediateTapDevice(e.pointerType)){
      // React right away instead of waiting to see if a second tap follows.
      // A same-side second tap within the window still seeks (handled by
      // the pendingSide check above), it just no longer blocks the pause.
      tapTimer=setTimeout(()=>{tapTimer=null;pendingSide=null},DOUBLE_TAP_MS);
      togglePlayback();
      return;
    }

    tapTimer=setTimeout(()=>{
      tapTimer=null;pendingSide=null;
      if(slide.classList.contains("ui-hidden")){
        // UI (icons, title, stats) is faded out during playback — the
        // first tap just brings it back instead of pausing immediately.
        showUI();
        scheduleHide();
        return;
      }
      togglePlayback();
    },DOUBLE_TAP_MS);
  }
  tap.addEventListener("pointerup",finishPress);
  tap.addEventListener("pointercancel",()=>{
    clearTimeout(longPressTimer);
    if(isLongPressing)endLongPress();
    pointerActive=false;
    clearTimeout(tapTimer);tapTimer=null;pendingSide=null;
  });

  ["play","pause","ended"].forEach(evt=>v.addEventListener(evt,()=>updateCenterIcon(slide,v)));
  v.addEventListener("ended",()=>{
    const i=Number(slide.dataset.index);
    const next=feed.children[i+1];
    if(next)next.scrollIntoView({behavior:"smooth"});
  });
  v.addEventListener("waiting",()=>spinner.classList.remove("hidden"));
  v.addEventListener("playing",()=>spinner.classList.add("hidden"));
  v.addEventListener("canplay",()=>spinner.classList.add("hidden"));
  v.addEventListener("play",()=>{
    if(counted)return;counted=true;
    api("/api/videos/"+encodeURIComponent(slide.dataset.id)+"/view",{method:"POST"}).catch(()=>{});
  });
  v.addEventListener("timeupdate",()=>{
    if(!v.duration||progressBar.classList.contains("dragging"))return;
    progressFill.style.width=(v.currentTime/v.duration*100)+"%";
  });

  // ---- Draggable progress/seek bar (YouTube-style scrubber) ----
  const progressBar=slide.querySelector(".short-progress");
  const progressFill=slide.querySelector(".short-progress-fill");
  let wasPlayingBeforeDrag=false;
  function ratioFromEvent(e){
    const rect=progressBar.getBoundingClientRect();
    return Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width));
  }
  function seekTo(ratio){
    progressFill.style.width=(ratio*100)+"%";
    if(v.duration)v.currentTime=ratio*v.duration;
  }
  progressBar.addEventListener("pointerdown",e=>{
    e.stopPropagation();
    progressBar.setPointerCapture(e.pointerId);
    progressBar.classList.add("dragging");
    showUI();
    wasPlayingBeforeDrag=!v.paused&&!v.ended;
    v.pause();
    seekTo(ratioFromEvent(e));
  });
  progressBar.addEventListener("pointermove",e=>{
    if(!progressBar.classList.contains("dragging"))return;
    e.stopPropagation();
    seekTo(ratioFromEvent(e));
  });
  function endDrag(e){
    if(!progressBar.classList.contains("dragging"))return;
    e.stopPropagation();
    progressBar.classList.remove("dragging");
    seekTo(ratioFromEvent(e));
    if(wasPlayingBeforeDrag)v.play().catch(()=>{});
    scheduleHide();
  }
  progressBar.addEventListener("pointerup",endDrag);
  progressBar.addEventListener("pointercancel",endDrag);
  progressBar.addEventListener("click",e=>e.stopPropagation());

  slide.querySelector(".short-mute-btn").onclick=e=>{
    e.stopPropagation();
    muted=!muted;
    localStorage.setItem("mytube_shorts_muted",muted?"1":"0");
    $$(".short-video").forEach(vv=>vv.muted=muted);
    $$(".short-mute-btn").forEach(b=>b.classList.toggle("is-muted",muted));
  };

  slide.querySelector(".short-search-btn").onclick=e=>{
    e.stopPropagation();
    location.href="/?focusSearch=1";
  };

  slide.querySelector(".short-more-btn").onclick=e=>{
    e.stopPropagation();
    openMoreMenu(slide);
  };

  const likeBtn=slide.querySelector(".short-like-btn");
  likeBtn.onclick=async e=>{
    e.stopPropagation();
    const id=slide.dataset.id;
    try{
      const r=await api("/api/videos/"+encodeURIComponent(id)+"/like",{method:"POST"});
      likeBtn.classList.toggle("liked",r.active);
      likeBtn.querySelector(".short-like-label").textContent=r.active?"Liked":"Like";
      const item=items.find(x=>String(x.id)===String(id));if(item)item.liked=r.active;
    }catch(err){toast(err.message)}
  };

  const favBtn=slide.querySelector(".short-fav-btn");
  favBtn.onclick=async e=>{
    e.stopPropagation();
    const id=slide.dataset.id;
    try{
      const r=await api("/api/videos/"+encodeURIComponent(id)+"/favorite",{method:"POST"});
      favBtn.classList.toggle("faved",r.active);
      favBtn.querySelector(".short-fav-star").textContent=r.active?"★":"☆";
      favBtn.querySelector(".short-rail-count").textContent=r.active?"Saved":"Favorite";
      const item=items.find(x=>String(x.id)===String(id));if(item)item.favorite=r.active;
    }catch(err){toast(err.message)}
  };

  slide.querySelector(".short-download-btn").onclick=e=>{
    e.stopPropagation();
    const id=slide.dataset.id;
    const item=items.find(x=>String(x.id)===String(id));
    const a=document.createElement("a");
    a.href="/api/videos/"+encodeURIComponent(id)+"/stream?download=1";
    a.download=(item&&item.title)||"short";
    document.body.appendChild(a);a.click();a.remove();
    toast("Downloading…");
  };
}

// ---- Three-dot "more" menu: speed + quality + PiP + copy link ----
const moreMenu=$("#shortsMoreMenu"),menuBackdrop=$("#shortsMenuBackdrop"),moreMain=$("#shortsMoreMain"),
  speedPanel=$("#shortsSpeedPanel"),qualityPanel=$("#shortsQualityPanel"),
  speedBtn=$("#shortsSpeedBtn"),qualityBtn=$("#shortsQualityBtn"),
  speedValue=$("#shortsSpeedValue"),qualityValueEl=$("#shortsQualityValue"),
  pipBtn=$("#shortsPipBtn"),reportBtn=$("#shortsReportBtn"),qualityStatus=$("#shortsQualityStatus"),
  watchFullBtn=$("#shortsWatchFullBtn"),removeBtn=$("#shortsRemoveBtn");

function showPanel(panel){
  moreMain.classList.add("hidden");speedPanel.classList.add("hidden");qualityPanel.classList.add("hidden");
  panel.classList.remove("hidden");
}
function openMoreMenu(slide){
  currentMenuSlide=slide;
  moreMain.classList.remove("hidden");speedPanel.classList.add("hidden");qualityPanel.classList.add("hidden");
  moreMenu.hidden=false;menuBackdrop.hidden=false;
}
function closeMoreMenu(){moreMenu.hidden=true;menuBackdrop.hidden=true}
menuBackdrop.onclick=closeMoreMenu;
speedBtn.onclick=()=>showPanel(speedPanel);
qualityBtn.onclick=()=>showPanel(qualityPanel);
$$("[data-back]").forEach(b=>b.onclick=()=>showPanel(moreMain));

$$("#shortsSpeedPanel [data-speed]").forEach(b=>b.onclick=()=>{
  speed=+b.dataset.speed;
  $$(".short-video").forEach(v=>v.playbackRate=speed);
  speedValue.textContent=speed===1?"Normal":speed+"×";
  $$("#shortsSpeedPanel [data-speed]").forEach(x=>x.classList.toggle("active",x===b));
  closeMoreMenu();
  toast("Speed: "+(speed===1?"Normal":speed+"×"));
});

$$("#shortsQualityPanel [data-quality]").forEach(b=>b.onclick=()=>{
  quality=b.dataset.quality;
  qualityValueEl.textContent=quality==="auto"?"Auto":"Original";
  $$("#shortsQualityPanel [data-quality]").forEach(x=>x.classList.toggle("active",x===b));
  qualityStatus.hidden=false;qualityStatus.textContent="Playing "+(quality==="auto"?"Auto":"Original");
  setTimeout(()=>qualityStatus.hidden=true,1200);
  closeMoreMenu();
});

watchFullBtn.onclick=()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  if(id)location.href="/watch.html?id="+encodeURIComponent(id);
};

removeBtn.onclick=async()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  if(!id)return;
  try{
    await api("/api/videos/"+encodeURIComponent(id)+"/short",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({short:false})});
    const removedIndex=activeIndex;
    items=items.filter(x=>String(x.id)!==String(id));
    slide.remove();
    $$(".short-slide").forEach((s,i)=>{s.dataset.index=i});
    toast("Removed from Shorts");
    if(!items.length){emptyEl.hidden=false;return}
    activeIndex=-1;
    const nextIndex=Math.min(removedIndex,items.length-1);
    const nextSlide=feed.children[nextIndex];
    if(nextSlide){
      activateSlide(nextIndex,nextSlide);
      nextSlide.scrollIntoView({block:"start"});
    }
  }catch(err){toast(err.message)}
};

pipBtn.onclick=async()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const v=slide&&slide.querySelector("video");
  if(!v)return;
  try{
    if(document.pictureInPictureElement)await document.exitPictureInPicture();
    else await v.requestPictureInPicture();
  }catch(err){toast("Picture-in-picture isn't available for this video")}
};

reportBtn.onclick=()=>{
  closeMoreMenu();
  const slide=feed.children[activeIndex];
  const id=slide&&slide.dataset.id;
  const url=location.origin+"/shorts.html?id="+encodeURIComponent(id||"");
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(url).then(()=>toast("Link copied")).catch(()=>toast(url));
  }else toast(url);
};

// Keyboard navigation for desktop.
document.addEventListener("keydown",e=>{
  if(!moreMenu.hidden)return;
  if(e.key==="ArrowDown"){e.preventDefault();feed.children[activeIndex+1]?.scrollIntoView({behavior:"smooth"});}
  else if(e.key==="ArrowUp"){e.preventDefault();feed.children[activeIndex-1]?.scrollIntoView({behavior:"smooth"});}
  else if(e.key==="ArrowLeft"){
    e.preventDefault();
    const slide=feed.children[activeIndex],v=slide&&slide.querySelector("video");
    if(v&&v.duration)v.currentTime=Math.max(0,v.currentTime-10);
  }
  else if(e.key==="ArrowRight"){
    e.preventDefault();
    const slide=feed.children[activeIndex],v=slide&&slide.querySelector("video");
    if(v&&v.duration)v.currentTime=Math.min(v.duration,v.currentTime+10);
  }
  else if(e.code==="Space"){
    e.preventDefault();
    const slide=feed.children[activeIndex],v=slide&&slide.querySelector("video");
    if(v){if(v.paused||v.ended)v.play().catch(()=>{});else v.pause();}
  }
});

async function main(){
  let all;
  try{
    all=await api("/api/videos");
  }catch(err){
    loadingEl.classList.add("hidden");
    toast(err.message||"Could not load videos");
    return;
  }
  items=all.filter(v=>v.isShort&&(!onlyLiked||v.liked));
  if(startId&&!items.some(v=>String(v.id)===String(startId))){
    const direct=all.find(v=>String(v.id)===String(startId));
    if(direct)items.unshift(direct);
  }
  // Shuffle so every time you start playing Shorts you get a fresh running
  // order (Fisher-Yates). This is the only moment the recommended order
  // changes — saved (for the general/non-liked list) so the home page's
  // Shorts grid matches it too until the next time you play Shorts.
  for(let i=items.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [items[i],items[j]]=[items[j],items[i]];
  }
  if(!onlyLiked){
    try{localStorage.setItem("mytube_shorts_order",JSON.stringify(items.map(v=>v.id)))}catch{}
  }
  loadingEl.classList.add("hidden");
  if(!items.length){emptyEl.hidden=false;return}
  let startIndex=0;
  if(startId){const i=items.findIndex(v=>String(v.id)===String(startId));if(i>=0)startIndex=i}
  render();
  const slides=$$(".short-slide");
  slides[startIndex].scrollIntoView({block:"start"});
  setupObserver();
  activateSlide(startIndex,slides[startIndex]);
}
main();
