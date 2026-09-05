const $=s=>document.querySelector(s),id=new URLSearchParams(location.search).get("id");
const api=(u,o)=>fetch(u,o).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Request failed");return j});
const fmt=s=>{if(!Number.isFinite(s)||s<0)return"0:00";s=Math.floor(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`:`${m}:${String(x).padStart(2,"0")}`};
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

// ---- Hamburger navigation drawer (mirrors the one on the home page) ----
(function(){
  const sidebar=$("#sidebar"),backdrop=$("#sidebarBackdrop"),menuBtn=$("#menuBtn");
  if(!sidebar||!backdrop||!menuBtn)return;
  function openMenu(){sidebar.classList.add("open");backdrop.classList.add("show")}
  function closeMenu(){sidebar.classList.remove("open");backdrop.classList.remove("show")}
  menuBtn.onclick=()=>{sidebar.classList.contains("open")?closeMenu():openMenu()};
  const sidebarClose=$("#sidebarClose");
  if(sidebarClose)sidebarClose.onclick=closeMenu;
  backdrop.onclick=closeMenu;
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});

  document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{location.href="/?view="+encodeURIComponent(b.dataset.view)});

  const modal=$("#modal");
  function showAccountModal(email){
    $("#modalTitle").textContent="Account";
    $("#modalText").textContent=email;
    const actions=$("#modalActions");
    actions.innerHTML="";
    const out=document.createElement("button");
    out.type="button";out.className="modal-signout";out.textContent="Sign out";
    out.onclick=()=>{out.disabled=true;out.textContent="Signing out…";location.href="/logout"};
    actions.appendChild(out);
    modal.classList.add("show");
  }
  const modalClose=$("#modalClose");
  if(modalClose)modalClose.onclick=()=>modal.classList.remove("show");
  if(modal)modal.onclick=e=>{if(e.target.id==="modal")modal.classList.remove("show")};
  const profileBtn=$("#profileBtn");
  if(profileBtn)profileBtn.onclick=async()=>{
    try{const me=await api("/api/me");showAccountModal(me.email||"Signed in")}
    catch(err){location.href="/login.html"}
  };

  api("/api/me").then(me=>{
    const el=$("#accountStatus");if(el)el.textContent="Signed in as "+(me.email||"");
  }).catch(()=>{
    const el=$("#accountStatus");if(el)el.textContent="Connect Google Drive to load your videos.";
  });

  function toggleFolderChildren(fid){
    const kids=document.getElementById("fc-"+fid);
    if(!kids)return;
    const isOpenNow=kids.style.display!=="none";
    kids.style.display=isOpenNow?"none":"block";
    const toggleBtn=document.querySelector('[data-toggle="'+fid+'"]');
    if(toggleBtn)toggleBtn.classList.toggle("open",!isOpenNow);
  }
  function renderFolderTree(folders){
    const map=new Map(folders.map(f=>[f.id,{...f,children:[]}]));
    const roots=[];
    map.forEach(f=>{
      if(f.parentId&&map.has(f.parentId))map.get(f.parentId).children.push(f);
      else roots.push(f);
    });
    const byName=(a,b)=>a.name.localeCompare(b.name);
    (function sortTree(nodes){nodes.sort(byName);nodes.forEach(n=>sortTree(n.children))})(roots);
    function renderNodes(nodes,depth){
      if(!nodes.length)return "";
      return '<div class="folder-list">'+nodes.map(n=>{
        const hasKids=n.children.length>0;
        return `<div class="folder-node">
          <div class="folder-row" style="padding-left:${depth*14}px">
            ${hasKids?`<button class="folder-toggle" data-toggle="${esc(n.id)}" aria-label="Expand folder">▸</button>`:'<span class="folder-toggle-spacer"></span>'}
            <button class="folder-link" data-folder="${esc(n.id)}">📁 <span>${esc(n.name)}</span></button>
          </div>
          ${hasKids?`<div class="folder-children" id="fc-${esc(n.id)}" style="display:none">${renderNodes(n.children,depth+1)}</div>`:""}
        </div>`;
      }).join("")+"</div>";
    }
    const tree=$("#folderTree");
    if(!tree)return;
    tree.innerHTML=roots.length?renderNodes(roots,0):'<div class="side-small">No folders found.</div>';
    document.querySelectorAll("[data-toggle]").forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();toggleFolderChildren(b.dataset.toggle)});
    document.querySelectorAll("[data-folder]").forEach(b=>{
      const hasKids=!!document.getElementById("fc-"+b.dataset.folder);
      if(!hasKids){b.onclick=()=>{location.href="/?folder="+encodeURIComponent(b.dataset.folder)};return}
      let clickTimer=null;
      b.onclick=()=>{
        if(clickTimer){clearTimeout(clickTimer);clickTimer=null;return}
        clickTimer=setTimeout(()=>{clickTimer=null;toggleFolderChildren(b.dataset.folder)},260);
      };
      b.ondblclick=e=>{e.preventDefault();if(clickTimer){clearTimeout(clickTimer);clickTimer=null}location.href="/?folder="+encodeURIComponent(b.dataset.folder)};
    });
  }
  api("/api/folders").then(renderFolderTree).catch(err=>{
    const tree=$("#folderTree");
    if(tree)tree.innerHTML='<div class="side-small">'+(err.message==="Google Drive is not connected"?"Connect Google Drive to see folders.":"Could not load folders.")+"</div>";
  });
})();

async function main(){
 const videos=await api("/api/videos"),vinfo=videos.find(x=>String(x.id)===String(id));if(!vinfo)throw Error("Video not found");
 const v=$("#video"),player=$("#player"),hint=$("#gestureHint"),speedBadge=$("#speedBadge"),controls=$("#controls"),stream="/api/videos/"+encodeURIComponent(id)+"/stream";
 const fileName=String(vinfo.title||"").toLowerCase();
 const isTs=/\.(ts|mts|m2ts)$/.test(fileName);
 const tsStatus=$("#tsStatus");
 let tsPrepared=false,tsPreparing=false,tsObjectUrl=null,ffmpeg=null;
 if(isTs && tsStatus){
   tsStatus.hidden=false;
   tsStatus.textContent="This .TS video will be prepared for browser playback when you press Play.";
 }
 if(!isTs) v.src=stream;
 $("#title").textContent=vinfo.title||"Untitled video";
 $("#title").classList.remove("skel-text");
 v.poster=vinfo.thumbnail||("/api/videos/"+encodeURIComponent(id)+"/thumbnail");
 $("#like").textContent=vinfo.liked?"👍 Liked":"👍 Like";
 $("#fav").textContent=vinfo.favorite?"⭐ Saved":"☆ Favorite";

 // Player loading spinner: shown until the stream has real playable data.
 const playerLoading=$("#playerLoading");
 const hidePlayerLoading=()=>playerLoading&&playerLoading.classList.add("hidden");
 if(playerLoading){
   ["loadeddata","canplay","playing"].forEach(ev=>v.addEventListener(ev,hidePlayerLoading));
   v.addEventListener("error",hidePlayerLoading);
   v.addEventListener("waiting",()=>playerLoading.classList.remove("hidden"));
   v.addEventListener("canplay",hidePlayerLoading);
 }

 const playBtn=$("#playBtn"),center=$("#centerPlay"),centerFlash=$("#centerFlash");
 const ui=()=>{
   const playing=!v.paused&&!v.ended;
   playBtn.textContent=playing?"❚❚":"▶";
   center.classList.toggle("hidden",playing);
   if(!playing){showControls();clearTimeout(hideTimer)}else{showControls()}
 };
 // Brief center play/pause flash, similar to the on-screen icon YouTube shows
 // when you click/tap the middle of the video or press Space/K.
 const flashCenter=txt=>{
   if(!centerFlash)return;
   centerFlash.textContent=txt;
   centerFlash.classList.remove("pulse");
   void centerFlash.offsetWidth;
   centerFlash.classList.add("pulse");
 };
 const togglePlayWithFlash=()=>{
   flashCenter(v.paused||v.ended?"▶":"❚❚");
   play();
 };
 // Shared FFmpeg.wasm loader, reused by the .TS conversion flow and by
 // the quality menu's in-browser resolution transcoding below.
 const ensureFfmpeg=async()=>{
   if(ffmpeg)return ffmpeg;
   if(!window.FFmpeg)throw Error("The browser video converter could not be loaded.");
   const apiFF=window.FFmpeg;
   ffmpeg=apiFF.createFFmpeg({
     log:false,
     corePath:"https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.6/dist/ffmpeg-core.js"
   });
   await ffmpeg.load();
   return ffmpeg;
 };
 const prepareTs=async()=>{
   if(!isTs||tsPrepared)return true;
   if(tsPreparing)return false;
   tsPreparing=true;
   if(tsStatus){tsStatus.hidden=false;tsStatus.textContent="Preparing .TS video for playback…";tsStatus.classList.add("working")}
   try{
     await ensureFfmpeg();
     ffmpeg.setProgress(({ratio})=>{
       if(tsStatus){
         const pct=Math.max(0,Math.min(100,Math.round((ratio||0)*100)));
         tsStatus.textContent=`Preparing .TS video… ${pct}%`;
       }
     });
     const response=await fetch(stream,{credentials:"same-origin"});
     if(!response.ok)throw Error("Unable to download the .TS video for conversion.");
     const input=await response.arrayBuffer();
     ffmpeg.FS("writeFile","input.ts",new Uint8Array(input));
     try{
       await ffmpeg.run("-i","input.ts","-c","copy","-movflags","faststart","output.mp4");
     }catch(_){
       await ffmpeg.run("-i","input.ts","-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","faststart","output.mp4");
     }
     const out=ffmpeg.FS("readFile","output.mp4");
     tsObjectUrl=URL.createObjectURL(new Blob([out.buffer],{type:"video/mp4"}));
     v.src=tsObjectUrl;
     if(pv){pv.src=tsObjectUrl;try{pv.load()}catch(_){}}
     if(pv2){pv2.src=tsObjectUrl;try{pv2.load()}catch(_){}}
     previewCache.clear();
     tsPrepared=true;
     if(tsStatus){tsStatus.textContent="Ready";setTimeout(()=>tsStatus.hidden=true,900)}
     return true;
   }catch(err){
     if(tsStatus){tsStatus.hidden=false;tsStatus.classList.remove("working");tsStatus.textContent="Could not prepare this .TS video: "+(err.message||"unknown error")}
     return false;
   }finally{tsPreparing=false}
 };
 const play=async()=>{
   if(!v.paused){v.pause();return}
   if(isTs && !tsPrepared){
     const ok=await prepareTs();
     if(!ok)return;
   }
   v.play().catch(()=>{});
 };
 playBtn.onclick=e=>{e.stopPropagation();play()};
 center.onclick=e=>{e.stopPropagation();togglePlayWithFlash()};
 ["play","pause","ended"].forEach(e=>v.addEventListener(e,ui));

 // Auto-hide controls.
 // On phones/tablets, tapping the video toggles the controls instead of
 // creating a permanent touch layer over the picture.
 let hideTimer=null;
 const hideControls=()=>{
   if(!v.paused&&!v.ended){
     controls.classList.add("auto-hidden");
     hideTimer=null;
   }
 };
 const showControls=()=>{
   controls.classList.remove("auto-hidden");
   clearTimeout(hideTimer);
   if(!v.paused&&!v.ended){
     hideTimer=setTimeout(hideControls,2500);
   }
 };
 const toggleControls=()=>{
   if(v.paused||v.ended){showControls();return;}
   if(controls.classList.contains("auto-hidden")) showControls();
   else {
     clearTimeout(hideTimer);
     hideControls();
   }
 };
 const restartHide=()=>showControls();

 player.addEventListener("pointermove",e=>{
   if(e.target.closest(".controls")) restartHide();
   else if(e.pointerType==="mouse") restartHide();
 },{passive:true});
 player.addEventListener("pointerdown",e=>{
   if(e.target.closest(".controls")) return;
   if(e.pointerType==="mouse") return;
   // Do not preventDefault: this keeps native video gestures and seeking usable.
 },{passive:true});
 player.addEventListener("mouseenter",restartHide);
 player.addEventListener("mouseleave",()=>{
   if(!v.paused&&!v.ended) hideTimer=setTimeout(hideControls,700);
 });
 controls.addEventListener("pointermove",e=>{
   e.stopPropagation();
   restartHide();
 },{passive:true});
 controls.addEventListener("pointerdown",e=>e.stopPropagation());
 showControls();

 // Timeline and thumbnail preview.
 const timeline=$("#timeline"),seekArea=$("#seekArea"),played=$("#played"),buffered=$("#buffered"),scrubber=$("#scrubber"),preview=$("#preview"),canvas=$("#previewCanvas"),ctx=canvas.getContext("2d"),ptime=$("#previewTime");
 let pv=null,busy=false,wanted=0,dragging=false,wasPlayingBeforeDrag=false;
 const getPV=()=>{
   if(pv)return pv;
   pv=document.createElement("video");pv.muted=true;pv.playsInline=true;pv.preload="metadata";pv.src=tsPrepared&&tsObjectUrl?tsObjectUrl:stream;
   pv.style.cssText="position:fixed;left:-99999px;width:2px;height:2px";
   document.body.appendChild(pv);return pv;
 };
 const fracFromX=x=>{
   const r=timeline.getBoundingClientRect();
   return Math.max(0,Math.min(1,(x-r.left)/r.width));
 };
 const setUI=f=>{
   const pct=(f*100)+"%";
   played.style.width=pct;scrubber.style.left=pct;
   timeline.setAttribute("aria-valuenow",String(Math.round(f*(v.duration||0))));
 };
 // Each seek on the preview/main video is a fresh network round-trip through
 // the Drive proxy, so the biggest win is simply asking for fewer of them:
 // snap to a coarser time grid and widen the "close enough, don't reseek"
 // window. A pointermove-driven scrub can fire far faster than seeks can
 // resolve, so we also collapse bursts of pointermove events down to one
 // update per animation frame instead of acting on every single event.
 const SNAP=.5;
 // Proactive scrub-preview pre-caching. showPrev() below needs a network
 // round-trip through the Drive proxy for every hover position, which is
 // the slow part. Instead of only fetching on demand, quietly warm a
 // spread of frames across the whole video shortly after it loads, using a
 // *second* hidden video element so this never fights with the live,
 // pointer-driven preview. Each warmed frame is cached as an ImageBitmap;
 // once cached, scrubbing over that spot draws instantly with no further
 // request. This doesn't download the full file — it's the same small
 // Range/seek fetches the preview already made, just done ahead of time
 // and spread out instead of one-by-one while the user is dragging.
 const previewCache=new Map();
 let pv2=null,prefetchTimer=null,prefetchStop=false;
 const getPV2=()=>{
   if(pv2)return pv2;
   pv2=document.createElement("video");pv2.muted=true;pv2.playsInline=true;pv2.preload="metadata";pv2.src=tsPrepared&&tsObjectUrl?tsObjectUrl:stream;
   pv2.style.cssText="position:fixed;left:-99999px;width:2px;height:2px";
   document.body.appendChild(pv2);return pv2;
 };
 async function cacheFrameAt(t){
   const key=Math.round(t/SNAP)*SNAP;
   if(previewCache.has(key))return;
   const q=getPV2();
   await new Promise(resolve=>{
     const se=()=>{q.removeEventListener("seeked",se);resolve()};
     q.addEventListener("seeked",se);
     try{q.currentTime=key}catch(_){resolve()}
   });
   try{if(q.readyState>=2)previewCache.set(key,await createImageBitmap(q))}catch(_){}
 }
 async function runPrefetch(){
   if(!v.duration)return;
   const dur=v.duration,MAX_FRAMES=36;
   const step=Math.max(SNAP,Math.round((dur/MAX_FRAMES)/SNAP)*SNAP||SNAP);
   for(let t=0;t<dur;t+=step){
     if(prefetchStop)return;
     // Yield to any live drag in progress rather than competing for bandwidth.
     while(dragging){if(prefetchStop)return;await new Promise(r=>setTimeout(r,250))}
     await cacheFrameAt(t);
     await new Promise(r=>setTimeout(r,200));
   }
 }
 function schedulePrefetch(){
   if(!v.duration)return;
   clearTimeout(prefetchTimer);
   // Let the actual video get a head start on bandwidth before we start
   // warming preview frames in the background.
   prefetchTimer=setTimeout(runPrefetch,1500);
 }
 if(v.duration)schedulePrefetch();else v.addEventListener("loadedmetadata",schedulePrefetch,{once:true});
 window.addEventListener("beforeunload",()=>{prefetchStop=true});
 const showPrev=x=>{
   if(!v.duration)return;
   const f=fracFromX(x),rawT=f*v.duration,t=Math.round(rawT/SNAP)*SNAP,pr=player.getBoundingClientRect();
   preview.style.left=Math.max(100,Math.min(pr.width-100,x-pr.left))+"px";
   preview.classList.add("show");ptime.textContent=fmt(rawT);wanted=t;
   const cached=previewCache.get(t);
   if(cached){try{ctx.clearRect(0,0,192,108);ctx.drawImage(cached,0,0,192,108)}catch(_){}return}
   const q=getPV();
   if(!busy&&Math.abs((q.currentTime||0)-t)>.4){
     busy=true;
     const done=()=>{
       try{
         if(q.readyState>=2){
           ctx.drawImage(q,0,0,192,108);
           // Cache this frame too, so hovering back over the same spot is instant.
           createImageBitmap(q).then(bmp=>{if(!previewCache.has(t))previewCache.set(t,bmp)}).catch(()=>{});
         }
       }catch(_){}
       busy=false;if(Math.abs(wanted-q.currentTime)>.4)showPrev(x);
     };
     const se=()=>{q.removeEventListener("seeked",se);done()};
     q.addEventListener("seeked",se);
     try{q.currentTime=t}catch(_){busy=false}
   }else if(q.readyState>=2){try{ctx.drawImage(q,0,0,192,108)}catch(_){}}
 };
 const hidePrev=()=>preview.classList.remove("show");
 // Live-update the bar UI as the pointer moves, without hammering currentTime on every pixel.
 let lastScrubTime=null;
 const scrubTo=x=>{
   if(!v.duration)return;
   const f=fracFromX(x),t=Math.round((f*v.duration)/SNAP)*SNAP;
   setUI(f);
   if(lastScrubTime!==null&&Math.abs(t-lastScrubTime)<SNAP)return;
   lastScrubTime=t;
   v.currentTime=t;
 };
 // Coalesce rapid-fire pointermove events into one update per frame — the
 // seeks they trigger are far slower than the events themselves arrive.
 let pendingX=null,rafId=null;
 const flushPointerMove=()=>{
   rafId=null;
   if(pendingX===null)return;
   const x=pendingX;pendingX=null;
   showPrev(x);
   if(dragging)scrubTo(x);
 };
 const queuePointerMove=x=>{
   pendingX=x;
   if(rafId===null)rafId=requestAnimationFrame(flushPointerMove);
 };
 const beginDrag=x=>{
   if(!v.duration)return;
   dragging=true;
   lastScrubTime=null;
   wasPlayingBeforeDrag=!v.paused&&!v.ended;
   if(wasPlayingBeforeDrag)v.pause();
   timeline.classList.add("dragging");
   scrubTo(x);
   showPrev(x);
   showControls();
   clearTimeout(hideTimer);
 };
 const endDrag=()=>{
   if(!dragging)return;
   dragging=false;
   if(rafId!==null){cancelAnimationFrame(rafId);rafId=null}
   pendingX=null;
   timeline.classList.remove("dragging");
   if(wasPlayingBeforeDrag)v.play().catch(()=>{});
   restartHide();
 };
 seekArea.addEventListener("pointermove",e=>{
   queuePointerMove(e.clientX);
 });
 seekArea.addEventListener("pointerleave",()=>{if(!dragging)hidePrev()});
 seekArea.addEventListener("pointerdown",e=>{
   e.preventDefault();e.stopPropagation();
   try{seekArea.setPointerCapture(e.pointerId)}catch(_){}
   beginDrag(e.clientX);
 });
 seekArea.addEventListener("pointerup",e=>{
   try{seekArea.releasePointerCapture(e.pointerId)}catch(_){}
   endDrag();
   hidePrev();
 });
 seekArea.addEventListener("pointercancel",()=>{endDrag();hidePrev()});
 // Safety net: an interrupted touch (an OS gesture, a notification, switching
 // apps, the tab going to background) can end a drag session without a normal
 // pointerup/pointerleave ever reaching the seek area, which otherwise leaves
 // the scrub-preview thumbnail stuck on screen. Force it closed whenever the
 // touch session could plausibly be over.
 window.addEventListener("pointerup",e=>{if(e.pointerType==="touch"&&!dragging)hidePrev()},true);
 window.addEventListener("pointercancel",()=>{endDrag();hidePrev()},true);
 document.addEventListener("visibilitychange",()=>{if(document.hidden){endDrag();hidePrev()}});
 window.addEventListener("blur",()=>{endDrag();hidePrev()});
 // Keyboard access: focus the timeline and use arrow keys / Home / End to seek.
 timeline.setAttribute("tabindex","0");
 timeline.setAttribute("role","slider");
 timeline.setAttribute("aria-label","Seek");
 timeline.setAttribute("aria-valuemin","0");
 timeline.addEventListener("keydown",e=>{
   if(!v.duration)return;
   let t=null;
   if(e.key==="ArrowLeft")t=Math.max(0,v.currentTime-5);
   else if(e.key==="ArrowRight")t=Math.min(v.duration,v.currentTime+5);
   else if(e.key==="Home")t=0;
   else if(e.key==="End")t=v.duration;
   if(t===null)return;
   e.preventDefault();
   v.currentTime=t;
   setUI(t/v.duration);
   showControls();
 });
 v.addEventListener("timeupdate",()=>{
   if(!v.duration)return;
   if(!dragging)setUI(v.currentTime/v.duration);
   $("#time").textContent=fmt(v.currentTime)+" / "+fmt(v.duration);
 });
 v.addEventListener("progress",()=>{
   if(!v.duration||!v.buffered.length)return;
   try{buffered.style.width=Math.min(100,v.buffered.end(v.buffered.length-1)/v.duration*100)+"%"}catch(_){}
 });
 v.addEventListener("loadedmetadata",()=>{
   $("#time").textContent=fmt(v.currentTime)+" / "+fmt(v.duration);
   timeline.setAttribute("aria-valuemax",String(Math.round(v.duration)));
   showControls();
 });

 // Volume.
 const vol=$("#volumeRange"),mute=$("#muteBtn"),volui=()=>{
   vol.value=String(v.volume);
   const isMuted=v.muted||v.volume===0;
   mute.classList.toggle("is-muted",isMuted);
   mute.setAttribute("aria-label",isMuted?"Unmute":"Mute");
 };
 vol.oninput=()=>{v.muted=false;v.volume=+vol.value;volui();showControls()};
 mute.onclick=e=>{e.stopPropagation();v.muted=!v.muted;volui();showControls()};

 // Seek helper, used by keyboard shortcuts (arrows, J/L).
 const skip=(seconds)=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+seconds));
   show(`${seconds>0?"+":"−"}${Math.abs(seconds)} seconds`);
   showControls();
 };

 // Quality menu: Auto/Original play the source stream directly and instantly.
 // 240p–1080p are produced on demand with FFmpeg.wasm right in the browser
 // (there's no server-side transcoding pipeline here) and cached per-session
 // so switching back to a resolution you already prepared is instant.
 const qb=$("#qualityBtn"),qm=$("#qualityMenu"),qualityStatus=$("#qualityStatus");
 const QUALITY_LABELS={auto:"Auto",original:"Original","1080":"1080p","720":"720p","480":"480p","360":"360p","240":"240p"};
 let currentQuality="original",qualityBusy=false,sourceFsName=null,sourceFsFrom=null;
 const qualityCache={};
 qb.onclick=e=>{e.stopPropagation();qm.classList.toggle("show");moreMenu.classList.remove("show");showControls()};

 const updateQualityMenuActive=()=>{
   qm.querySelectorAll("button[data-quality]").forEach(b=>b.classList.toggle("active",b.dataset.quality===currentQuality));
 };
 const ensureQualitySource=async()=>{
   if(isTs&&!tsPrepared){
     const ok=await prepareTs();
     if(!ok)throw Error("Video isn't ready yet.");
   }
   return (isTs&&tsObjectUrl)?tsObjectUrl:stream;
 };
 // Writes the full source video into FFmpeg's virtual filesystem once, reusing
 // it for every resolution the viewer picks so it's only downloaded once.
 const ensureSourceInFs=async()=>{
   const from=await ensureQualitySource();
   await ensureFfmpeg();
   if(sourceFsName&&sourceFsFrom===from)return sourceFsName;
   const resp=await fetch(from,{credentials:"same-origin"});
   if(!resp.ok)throw Error("Unable to load the video source.");
   const buf=await resp.arrayBuffer();
   const name="qsource"+Date.now()+(/\.ts(\?|$)/i.test(from)?".ts":".mp4");
   if(sourceFsName){try{ffmpeg.FS("unlink",sourceFsName)}catch(_){}}
   ffmpeg.FS("writeFile",name,new Uint8Array(buf));
   sourceFsName=name;sourceFsFrom=from;
   return name;
 };
 // Swap the <video> source while preserving playback position/state.
 const applyQualitySource=async(url,resumeTime,wasPlaying)=>{
   v.src=url;
   await new Promise(res=>{
     const onMeta=()=>{v.removeEventListener("loadedmetadata",onMeta);res()};
     v.addEventListener("loadedmetadata",onMeta);
   });
   if(resumeTime)try{v.currentTime=resumeTime}catch(_){}
   if(wasPlaying)v.play().catch(()=>{});
 };
 async function setQuality(q){
   if(qualityBusy||q===currentQuality){qm.classList.remove("show");return}
   const label=QUALITY_LABELS[q]||q;
   const resumeTime=v.currentTime,wasPlaying=!v.paused&&!v.ended;
   qualityBusy=true;
   qm.classList.remove("show");
   try{
     if(q==="auto"||q==="original"){
       const src=await ensureQualitySource();
       currentQuality=q;
       qb.textContent=label;
       updateQualityMenuActive();
       await applyQualitySource(src,resumeTime,wasPlaying);
       show(label);
     }else{
       let url=qualityCache[q];
       if(!url){
         if(qualityStatus){qualityStatus.hidden=false;qualityStatus.classList.add("working");qualityStatus.textContent=`Preparing ${label}…`}
         const srcName=await ensureSourceInFs();
         ffmpeg.setProgress(({ratio})=>{
           if(qualityStatus){
             const pct=Math.max(0,Math.min(100,Math.round((ratio||0)*100)));
             qualityStatus.textContent=`Preparing ${label}… ${pct}%`;
           }
         });
         const outName=`out_${q}_${Date.now()}.mp4`;
         await ffmpeg.run("-i",srcName,"-vf",`scale=-2:${q}`,"-c:v","libx264","-preset","ultrafast","-crf","23","-c:a","aac","-b:a","128k","-movflags","faststart",outName);
         const out=ffmpeg.FS("readFile",outName);
         url=URL.createObjectURL(new Blob([out.buffer],{type:"video/mp4"}));
         qualityCache[q]=url;
       }
       currentQuality=q;
       qb.textContent=label;
       updateQualityMenuActive();
       await applyQualitySource(url,resumeTime,wasPlaying);
       if(pv){pv.src=url;try{pv.load()}catch(_){}}
       if(qualityStatus){qualityStatus.classList.remove("working");qualityStatus.textContent=`Playing ${label}`;setTimeout(()=>qualityStatus.hidden=true,1200)}
     }
   }catch(err){
     if(qualityStatus){qualityStatus.hidden=false;qualityStatus.classList.remove("working");qualityStatus.textContent="Could not prepare "+label+": "+(err.message||"unknown error");setTimeout(()=>qualityStatus.hidden=true,2500)}
     else show("Couldn't switch quality");
   }finally{
     qualityBusy=false;
     showControls();
   }
 }
 qm.querySelectorAll("button[data-quality]").forEach(b=>b.onclick=e=>{
   e.stopPropagation();
   setQuality(b.dataset.quality);
 });

 // Change thumbnail.
 const thumbInput=$("#watchThumbnailInput");
 const prepareThumbnail=async file=>{
   if(!file.type.startsWith("image/"))throw Error("Please choose an image file.");
   const url=URL.createObjectURL(file);
   try{
     const img=await new Promise((resolve,reject)=>{
       const i=new Image();
       i.onload=()=>resolve(i);
       i.onerror=()=>reject(Error("The selected image could not be read."));
       i.src=url;
     });
     const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
     const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
     const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
     canvas.getContext("2d").drawImage(img,0,0,w,h);
     const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.88));
     if(!blob)throw Error("Could not prepare the thumbnail.");
     return blob;
   }finally{URL.revokeObjectURL(url)}
 };
 $("#changeThumbnailBtn").onclick=e=>{e.stopPropagation();thumbInput.value="";thumbInput.click();show("Choose a thumbnail")};
 thumbInput.onchange=async()=>{
   const file=thumbInput.files?.[0];if(!file)return;
   try{
     const blob=await prepareThumbnail(file);
     if(blob.size>1900000)throw Error("Thumbnail is too large. Please choose a smaller image.");
     const r=await fetch("/api/videos/"+encodeURIComponent(id)+"/thumbnail",{
       method:"POST",headers:{"Content-Type":"image/jpeg"},body:blob
     });
     const j=await r.json().catch(()=>({}));
     if(!r.ok)throw Error(j.error||"Thumbnail upload failed.");
     // Refresh recommendation/home thumbnail cache after a successful change.
     document.querySelectorAll(".rec-thumb img").forEach(img=>{
       const base=img.src.split("?")[0];img.src=base+"?t="+Date.now();
     });
     show("Thumbnail changed");
   }catch(err){show(err.message||"Thumbnail upload failed.");}
 };

 // Download — single click, always original quality.
 $("#downloadBtn").onclick=e=>{
   e.stopPropagation();
   const a=document.createElement("a");a.href=stream+"?download=1";a.download=vinfo.title||"video";
   document.body.appendChild(a);a.click();a.remove();
   show("Downloading original quality");
 };

 // Likes/favorites.
 $("#like").onclick=async e=>{e.stopPropagation();$("#like").textContent=(await api(`/api/videos/${encodeURIComponent(id)}/like`,{method:"POST"})).active?"👍 Liked":"👍 Like"};
 $("#fav").onclick=async e=>{e.stopPropagation();$("#fav").textContent=(await api(`/api/videos/${encodeURIComponent(id)}/favorite`,{method:"POST"})).active?"⭐ Saved":"☆ Favorite"};

 // Delete — moves the file to the trash in Google Drive and sends the
 // viewer back to their previous page (falling back to home).
 const deleteBtn=$("#deleteBtn");
 if(deleteBtn)deleteBtn.onclick=async e=>{
   e.stopPropagation();
   if(!confirm(`Delete "${vinfo.title||"this video"}"? It will be moved to the trash in Google Drive.`))return;
   try{
     deleteBtn.disabled=true;deleteBtn.textContent="Deleting…";
     await api(`/api/videos/${encodeURIComponent(id)}/delete`,{method:"DELETE"});
     if(document.referrer && new URL(document.referrer).origin===location.origin)history.back();
     else location.href="/";
   }catch(err){
     deleteBtn.disabled=false;deleteBtn.textContent="🗑 Delete";
     show(err.message||"Could not delete video.");
   }
 };

 // Fullscreen.
 $("#fullscreenBtn").onclick=async e=>{
   e.stopPropagation();
   try{document.fullscreenElement?await document.exitFullscreen():await player.requestFullscreen()}
   catch(_){try{await v.webkitEnterFullscreen()}catch(__){}}
 };
 // Picture-in-picture (also reachable from the ⋮ more menu and the "I" shortcut).
 const togglePip=async()=>{
   try{document.pictureInPictureElement?await document.exitPictureInPicture():await v.requestPictureInPicture()}catch(_){}
 };

 // Touch and mouse interaction.
 // A tap on the picture toggles the control bar. Pressing and holding the
 // right side — finger on touch, or a held-down click on desktop — temporarily
 // plays at 2x, like the YouTube gesture, and restores the previous speed on
 // release. Fullscreen is only triggered by the fullscreen button.
 let longPressTimer=null,longPressActive=false,longPressPointerId=null;
 let savedRate=1;

 // Pinch-to-zoom while watching in landscape — mirrors YouTube's mobile
 // gesture: pinching outward crops the video to fill the frame, pinching
 // inward restores the letterboxed fit. Only two simultaneous touch points
 // count as a pinch, so it never fights the single-finger tap / long-press /
 // skip gestures below.
 const activeTouches=new Map();
 let pinchBaseDist=null,pinchGestureActive=false;
 const isLandscape=()=>matchMedia("(orientation: landscape)").matches;
 const touchDist=()=>{
   const pts=[...activeTouches.values()];
   return Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
 };

 const isInsideControls=e=>!!e.target.closest(".controls");
 const clearLongPress=()=>{
   if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null}
 };
 const endLongPress=()=>{
   clearLongPress();
   if(!longPressActive)return;
   longPressActive=false;
   if(longPressPointerId!==null){
     try{player.releasePointerCapture(longPressPointerId)}catch(_){}
   }
   longPressPointerId=null;
   v.playbackRate=savedRate;
   speedBadge.classList.remove("show");
   showControls();
 };

 player.addEventListener("pointerdown",e=>{
   if(isInsideControls(e) || e.target.closest("#centerPlay"))return;

   if(e.pointerType==="touch"){
     activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
     if(activeTouches.size===2 && isLandscape()){
       // A second finger just landed — this is a pinch, not a tap, long
       // press, or skip. Cancel whatever the first finger started.
       pinchGestureActive=true;
       clearLongPress();
       if(longPressActive)endLongPress();
       resetTap();
       pinchBaseDist=touchDist();
       return;
     }
     if(activeTouches.size>1)return;
   }

   const rect=player.getBoundingClientRect();
   const x=e.clientX-rect.left;
   const inRightZone=x >= rect.width*0.62;

   // On desktop, only the right-side long-press-to-2x gesture applies here;
   // double-click already toggles fullscreen and single click isn't hijacked.
   if(e.pointerType==="mouse" && !inRightZone)return;

   // Only the right 38% of the video activates the long-press gesture.
   if(inRightZone){
     clearLongPress();
     longPressPointerId=e.pointerId;
     longPressTimer=setTimeout(()=>{
       longPressTimer=null;
       if(v.paused || v.ended)return;
       longPressActive=true;
       savedRate=v.playbackRate || 1;
       v.playbackRate=2;
       speedBadge.classList.add("show");
       showControls();
       try{player.setPointerCapture(e.pointerId)}catch(_){}
     },450);
   }
 },{passive:true});

 player.addEventListener("pointermove",e=>{
   if(e.pointerType!=="touch" || !pinchGestureActive || !activeTouches.has(e.pointerId))return;
   activeTouches.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(activeTouches.size!==2 || pinchBaseDist===null)return;
   const d=touchDist(),delta=d-pinchBaseDist,PINCH_THRESHOLD=45;
   if(delta>PINCH_THRESHOLD && !fillMode){
     fillMode=true;updateFit();show("Zoom to fill");showControls();
     pinchBaseDist=d;
   }else if(delta<-PINCH_THRESHOLD && fillMode){
     fillMode=false;updateFit();show("Fit to screen");showControls();
     pinchBaseDist=d;
   }
 },{passive:true});

 player.addEventListener("pointerup",e=>{
   if(isInsideControls(e) || e.target.closest("#centerPlay"))return;

   if(e.pointerType==="touch"){
     activeTouches.delete(e.pointerId);
     if(activeTouches.size>=1)return; // another finger still down mid-pinch
     if(pinchGestureActive){
       pinchGestureActive=false;pinchBaseDist=null;
       endLongPress();
       return;
     }
   }

   const wasLong=longPressActive;
   endLongPress();

   if(e.pointerType==="mouse"){
     // A held-down click on the right zone already did its 2x thing above;
     // a plain click on the rest of the video toggles play/pause, YouTube-style.
     if(wasLong)return;
     const rect=player.getBoundingClientRect();
     const x=e.clientX-rect.left;
     const inRightZone=x >= rect.width*0.62;
     if(!inRightZone) togglePlayWithFlash();
     return;
   }
   if(wasLong)return;

   const rect=player.getBoundingClientRect();
   const x=e.clientX-rect.left;
   if(x<rect.width*0.38){
     if(registerDoubleTapSkip("left"))return;
   }else if(x>=rect.width*0.62){
     if(registerDoubleTapSkip("right"))return;
   }else{
     resetTap();
   }

   toggleControls();
 },{passive:true});

 const cancelTouch=e=>{
   if(e.pointerType==="touch"){
     activeTouches.delete(e.pointerId);
     if(activeTouches.size===0){pinchGestureActive=false;pinchBaseDist=null}
   }
   endLongPress();
 };
 player.addEventListener("pointercancel",cancelTouch,{passive:true});
 player.addEventListener("pointerleave",e=>{
   if(e.pointerType==="touch"){
     activeTouches.delete(e.pointerId);
     if(activeTouches.size===0){pinchGestureActive=false;pinchBaseDist=null}
   }
   if(longPressActive)endLongPress();
   else clearLongPress();
 },{passive:true});
 player.addEventListener("contextmenu",e=>{
   if(longPressActive || e.pointerType!=="mouse")e.preventDefault();
 });

 // Double-tap to seek ±10s, YouTube-style, on the left/right thirds of the
 // video (touch only — desktop already has J/L and the arrow-key shortcuts).
 // A double-tap is two quick releases, while the long-press-for-2x gesture
 // above requires a sustained hold, so the two never collide. Extra taps on
 // the same side within the window keep stacking (10s, then 20s, then 30s…).
 const skipLeftEl=$("#skipLeft"),skipRightEl=$("#skipRight"),skipLeftText=$("#skipLeftText"),skipRightText=$("#skipRightText");
 const DOUBLE_TAP_MS=350;
 let tapSide=null,tapCount=0,tapTotal=0,tapTimer=null;
 const skipSilent=seconds=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+seconds));
   showControls();
 };
 const resetTap=()=>{tapSide=null;tapCount=0;tapTotal=0;clearTimeout(tapTimer);tapTimer=null};
 const flashSkip=(el,textEl,secs)=>{
   textEl.textContent=secs+" seconds";
   el.classList.remove("pulse");
   void el.offsetWidth;
   el.classList.add("pulse");
 };
 const registerDoubleTapSkip=side=>{
   if(tapSide===side)tapCount++;
   else{tapSide=side;tapCount=1;tapTotal=0}
   clearTimeout(tapTimer);
   tapTimer=setTimeout(resetTap,DOUBLE_TAP_MS);
   if(tapCount<2)return false;
   tapTotal+=10;
   skipSilent(side==="left"?-10:10);
   flashSkip(side==="left"?skipLeftEl:skipRightEl,side==="left"?skipLeftText:skipRightText,tapTotal);
   return true;
 };

 // Zoom-to-fill / fit.
 const fitBtn=$("#fitBtn");
 let fillMode=false;
 const updateFit=()=>{
   v.style.objectFit=fillMode?"cover":"contain";
   fitBtn.textContent=fillMode?"Fit":"Fill";
   fitBtn.setAttribute("aria-label",fillMode?"Fit video":"Zoom to fill");
 };
 fitBtn.onclick=e=>{
   e.stopPropagation();
   fillMode=!fillMode;
   updateFit();
   show(fillMode?"Zoom to fill":"Fit to screen");
   showControls();
 };
 updateFit();

 // Gesture hint no longer blocks clicks.
 const show=t=>{hint.textContent=t;hint.classList.add("show");clearTimeout(show._t);show._t=setTimeout(()=>hint.classList.remove("show"),700)};

 // Keyboard shortcuts help panel.
 const shortcutsPanel=$("#shortcutsPanel"),shortcutsClose=$("#shortcutsClose");
 const toggleShortcuts=open=>{
   const willShow=open===undefined?shortcutsPanel.hidden:open;
   shortcutsPanel.hidden=!willShow;
   if(willShow)showControls();
 };
 shortcutsClose.onclick=e=>{e.stopPropagation();toggleShortcuts(false)};
 shortcutsPanel.addEventListener("pointerdown",e=>{
   e.stopPropagation();
   if(e.target===shortcutsPanel)toggleShortcuts(false);
 });

 // Three-dot "more options" menu: playback speed, keyboard shortcuts, picture-in-picture.
 const moreBtn=$("#moreBtn"),moreMenu=$("#moreMenu"),moreMenuMain=$("#moreMenuMain"),moreMenuSpeed=$("#moreMenuSpeed"),
   moreSpeedBtn=$("#moreSpeedBtn"),moreSpeedValue=$("#moreSpeedValue"),moreSpeedBack=$("#moreSpeedBack"),
   moreShortcutsBtn=$("#moreShortcutsBtn"),morePipBtn=$("#morePipBtn");
 const speedLabel=r=>r===1?"Normal":r+"×";
 const sets=r=>{v.playbackRate=r;moreSpeedValue.textContent=speedLabel(r);closeMoreMenu();showControls()};
 const openMoreMenu=()=>{
   moreMenu.classList.add("show");
   qm.classList.remove("show");
   showControls();
 };
 const closeMoreMenu=()=>{moreMenu.classList.remove("show")};
 moreBtn.onclick=e=>{e.stopPropagation();moreMenu.classList.contains("show")?closeMoreMenu():openMoreMenu()};
 moreSpeedBtn.onclick=e=>{e.stopPropagation();moreMenuMain.classList.add("hidden");moreMenuSpeed.classList.remove("hidden")};
 moreSpeedBack.onclick=e=>{e.stopPropagation();moreMenuSpeed.classList.add("hidden");moreMenuMain.classList.remove("hidden")};
 moreMenuSpeed.querySelectorAll("button[data-speed]").forEach(b=>b.onclick=e=>{e.stopPropagation();sets(+b.dataset.speed)});
 moreShortcutsBtn.onclick=e=>{e.stopPropagation();closeMoreMenu();toggleShortcuts(true)};
 morePipBtn.onclick=e=>{e.stopPropagation();closeMoreMenu();togglePip()};

 // Cast, via the standard Remote Playback API (Chromecast on Chrome/Edge/
 // Android) with a fallback to WebKit's AirPlay picker on Safari/iOS. The
 // button stays hidden wherever neither is supported, and hidden by default
 // until a receiver is actually known to be available.
 const moreCastBtn=$("#moreCastBtn");
 if(moreCastBtn){
   const castLabel=moreCastBtn.querySelector("span");
   const setCastLabel=txt=>{if(castLabel)castLabel.textContent=txt};
   if(typeof v.webkitShowPlaybackTargetPicker==="function"){
     v.addEventListener("webkitplaybacktargetavailabilitychanged",e=>{
       moreCastBtn.hidden=e.availability!=="available";
     });
     v.addEventListener("webkitcurrentplaybacktargetiswirelesschanged",()=>{
       setCastLabel(v.webkitCurrentPlaybackTargetIsWireless?"Casting…":"Cast");
     });
     moreCastBtn.onclick=e=>{
       e.stopPropagation();closeMoreMenu();
       try{v.webkitShowPlaybackTargetPicker()}catch(_){}
     };
   }else if("remote" in v && v.remote && typeof v.remote.watchAvailability==="function"){
     v.remote.watchAvailability(available=>{moreCastBtn.hidden=!available}).catch(()=>{});
     v.remote.addEventListener("connect",()=>setCastLabel("Casting…"));
     v.remote.addEventListener("disconnect",()=>setCastLabel("Cast"));
     moreCastBtn.onclick=async e=>{
       e.stopPropagation();closeMoreMenu();
       try{await v.remote.prompt()}catch(_){}
     };
   }else{
     moreCastBtn.remove();
   }
 }

 // Keyboard shortcuts.
 const speeds=[.5,.75,1,1.25,1.5,1.75,2,2.5,3];
 const nudgeSpeed=dir=>{
   const cur=v.playbackRate;
   let idx=0,best=Infinity;
   speeds.forEach((s,i)=>{const d=Math.abs(s-cur);if(d<best){best=d;idx=i}});
   idx=Math.max(0,Math.min(speeds.length-1,idx+dir));
   sets(speeds[idx]);
   show(speeds[idx]+"×");
 };
 const changeVolume=delta=>{
   v.muted=false;
   v.volume=Math.max(0,Math.min(1,+(v.volume+delta).toFixed(2)));
   volui();
   show(Math.round(v.volume*100)+"%");
   showControls();
 };
 const seekToPercent=f=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=v.duration*f;
   showControls();
 };
 const stepFrame=dir=>{
   if(!Number.isFinite(v.duration))return;
   v.currentTime=Math.max(0,Math.min(v.duration,v.currentTime+dir/30));
   showControls();
 };
 const isTypingTarget=el=>{
   if(!el)return false;
   const tag=el.tagName;
   return tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||el.isContentEditable;
 };
 document.addEventListener("keydown",e=>{
   if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey)return;
   const active=document.activeElement;
   if(isTypingTarget(active))return;
   // Let a focused button keep native Space/Enter activation.
   if(active&&active.tagName==="BUTTON"&&(e.key===" "||e.key==="Enter"))return;
   // The timeline has its own Left/Right/Home/End seek handling when focused.
   if(active===timeline&&["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;

   if(e.key==="Escape"){
     if(!shortcutsPanel.hidden){toggleShortcuts(false)}
     return;
   }
   if(e.key==="?"){e.preventDefault();toggleShortcuts();return}
   if(!shortcutsPanel.hidden)return;

   switch(e.key){
     case " ":case "k":case "K":
       e.preventDefault();togglePlayWithFlash();break;
     case "ArrowLeft":
       e.preventDefault();skip(-5);break;
     case "ArrowRight":
       e.preventDefault();skip(5);break;
     case "j":case "J":
       skip(-10);break;
     case "l":case "L":
       skip(10);break;
     case "ArrowUp":
       e.preventDefault();changeVolume(.05);break;
     case "ArrowDown":
       e.preventDefault();changeVolume(-.05);break;
     case "m":case "M":
       v.muted=!v.muted;volui();show(v.muted?"Muted":"Unmuted");showControls();break;
     case "f":case "F":
       $("#fullscreenBtn").click();break;
     case "i":case "I":
       togglePip();break;
     case ",":
       if(v.paused){v.pause();stepFrame(-1);show("◀ frame")}
       break;
     case ".":
       if(v.paused){v.pause();stepFrame(1);show("frame ▶")}
       break;
     case "<":
       nudgeSpeed(-1);break;
     case ">":
       nudgeSpeed(1);break;
     case "Home":
       e.preventDefault();seekToPercent(0);break;
     case "End":
       e.preventDefault();seekToPercent(1);break;
     default:
       if(e.key>="0"&&e.key<="9"){
         e.preventDefault();
         seekToPercent((+e.key)/10);
       }
   }
 });

 // Close popup menus when clicking elsewhere.
 document.addEventListener("click",e=>{
   if(!moreMenu.contains(e.target)&&e.target!==moreBtn)closeMoreMenu();
   if(!qm.contains(e.target)&&e.target!==qb)qm.classList.remove("show");
 });

 // Recommendations with real Google Drive thumbnails.
 // Google Drive folders are never valid recommendations — filter them out the
 // same way the home page does, defensively, even though /api/videos already
 // targets video files.
 const recList=$("#recommendationList"),recSentinel=$("#recSentinel");
 const others=videos.filter(x=>{
   if(String(x.id)===String(id))return false;
   if(String(x.mimeType||"").toLowerCase()==="application/vnd.google-apps.folder")return false;
   if(x.isFolder)return false;
   return true;
 });
 function shuffleArr(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
 // Shuffle on initial load too, not just on manual/idle refresh - otherwise
 // every video's recommendation panel shows the same underlying list order,
 // just with that video itself filtered out.
 let recOrder=shuffleArr(others);
 function thumbFor(x){return x.thumbnail||("/api/videos/"+encodeURIComponent(x.id)+"/thumbnail")}
 function recCardHtml(x){
   return `<a class="rec-card" href="/watch.html?id=${encodeURIComponent(x.id)}">
       <div class="rec-thumb">
         <img src="${esc(thumbFor(x))}" alt="" loading="lazy" onerror="if(!this.dataset.fallback){this.dataset.fallback="1";this.src="/api/videos/"+encodeURIComponent(x.id)+"/thumbnail"}else{this.style.display='none'}">
         <span class="rec-play">▶</span>
       </div>
       <div class="rec-info">
         <strong>${esc(x.title||"Untitled video")}</strong>
         <small>${x.liked?"💗 ":""}D Player</small>
       </div>
     </a>`;
 }
 const REC_PAGE_SIZE=10,REC_MAX_CARDS=240;
 let recCursor=0;
 function renderRecommendations(){
   recCursor=0;
   if(!recOrder.length){
     recList.innerHTML="<div class='empty-recommendations'>No other videos found.</div>";
     return;
   }
   recList.innerHTML="";
   // Pre-fill enough cards to cover taller (laptop/desktop) viewports up front,
   // instead of relying only on the scroll-triggered sentinel for the first screen.
   const initialFill=Math.min(REC_MAX_CARDS,Math.max(REC_PAGE_SIZE*2,recOrder.length));
   while(recCursor<initialFill)appendRecommendations();
 }
 function appendRecommendations(){
   if(!recOrder.length||recCursor>=REC_MAX_CARDS)return;
   // Only take as many as remain in the current shuffled pass, so a single
   // batch never wraps around and shows the same video twice. Once every
   // video in the pool has appeared, reshuffle for the next pass instead of
   // padding this one out with repeats.
   const remainingInCycle=recOrder.length-(recCursor%recOrder.length);
   const take=Math.min(REC_PAGE_SIZE,remainingInCycle,REC_MAX_CARDS-recCursor);
   const batch=[];
   for(let i=0;i<take;i++){
     batch.push(recOrder[recCursor%recOrder.length]);
     recCursor++;
   }
   if(recOrder.length>1&&recCursor%recOrder.length===0){
     let next=shuffleArr(recOrder);
     // Avoid the reshuffled list starting with the same video that just ended
     // the previous pass, so back-to-back cards never repeat either.
     if(next[0]===batch[batch.length-1]){
       const swapAt=1+Math.floor(Math.random()*(next.length-1));
       [next[0],next[swapAt]]=[next[swapAt],next[0]];
     }
     recOrder=next;
   }
   recList.insertAdjacentHTML("beforeend",batch.map(recCardHtml).join(""));
 }
 renderRecommendations();

 // Infinite scroll: load more recommended videos as the viewer scrolls down
 // (cycling and reshuffling once every video has been shown, since the
 // library is finite but the feed should feel endless like a real "up next").
 if(recSentinel&&"IntersectionObserver" in window){
   const recObserver=new IntersectionObserver(entries=>{
     if(entries.some(en=>en.isIntersecting))appendRecommendations();
   },{root:null,rootMargin:"600px 0px"});
   recObserver.observe(recSentinel);
 }

 // Auto-refresh removed per request - recommendations now only reshuffle on
 // initial load or when the viewer taps the manual refresh button.
 const recAutoTimer=null;

 // Manual refresh button — reshuffle the recommendations on demand.
 const recRefreshBtn=$("#recRefreshBtn");
 recRefreshBtn?.addEventListener("click",e=>{
   e.stopPropagation();
   if(others.length<2)return;
   recOrder=shuffleArr(others);
   renderRecommendations();
   recRefreshBtn.classList.remove("spinning");
   void recRefreshBtn.offsetWidth;
   recRefreshBtn.classList.add("spinning");
 });

 // Autoplay the next recommended video as soon as the current one ends.
 function goToNext(next){
   clearInterval(recAutoTimer);
   location.href="/watch.html?id="+encodeURIComponent(next.id);
 }
 v.addEventListener("ended",()=>{
   const next=recOrder[0];
   if(next)goToNext(next);
 });

 let counted=false;
 v.addEventListener("play",()=>{
   if(!counted){counted=true;api(`/api/videos/${encodeURIComponent(id)}/view`,{method:"POST"}).catch(()=>{})}
 });
 ui();volui();
}
main().catch(e=>document.body.innerHTML='<main class="error-page"><h2>'+esc(e.message)+'</h2><a href="/">← Back to D Player</a></main>');
