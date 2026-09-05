const $=s=>document.querySelector(s);const params=new URLSearchParams(location.search);const list=params.get('list')||'';const view=params.get('view')||'';const folder=params.get('folder')||'';const initialQuery=params.get('q')||'';let all=[];let activeCat='';let folders=[];
$('#search').value=initialQuery;
// Keep the current search text reflected in the URL (without adding a new
// history entry) so that clicking into a video and then using the browser's
// Back button returns to these same search results instead of resetting to
// the plain home screen.
function syncSearchUrl(){
  const q=($('#search').value||'').trim();
  const u=new URL(location.href);
  if(q)u.searchParams.set('q',q);else u.searchParams.delete('q');
  history.replaceState(history.state,'',u);
}
let recSeed=[];let firstLoadDone=false;let selectMode=false;let selected=new Set();let lastRendered=[];
function shuffle(arr){const a=arr.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}
function shuffleRecommendations(){recSeed=shuffle(all.map(v=>v.id))}
function showSkeleton(){
  $('#grid').innerHTML=Array.from({length:8}).map(()=>`<div class="video-card skel-card"><div class="skel-thumb"></div><div class="skel-line"></div><div class="skel-line short"></div></div>`).join('');
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api=async(u,o)=>{const r=await fetch(u,o);if(!r.ok){const j=await r.json().catch(()=>({}));throw Error(j.error||r.statusText)}return r.json()};
const toast=(m)=>{const e=$('#toast');e.textContent=m;e.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>e.classList.remove('show'),2200)};
function fmtViews(n){n=Number(n||0);if(n>=1e9)return (n/1e9).toFixed(1).replace('.0','')+'B views';if(n>=1e6)return (n/1e6).toFixed(1).replace('.0','')+'M views';if(n>=1e3)return (n/1e3).toFixed(1).replace('.0','')+'K views';return n+' views'}
function ago(d){if(!d)return 'Recently';const s=Math.max(0,(Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+' minutes ago';if(s<86400)return Math.floor(s/3600)+' hours ago';if(s<2592000)return Math.floor(s/86400)+' days ago';if(s<31536000)return Math.floor(s/2592000)+' months ago';return Math.floor(s/31536000)+' years ago'}
function historyIds(){try{return JSON.parse(localStorage.getItem('mytube_history')||'[]')}catch{return []}}
function addHistory(id){const a=historyIds().filter(x=>x!==id);a.unshift(id);localStorage.setItem('mytube_history',JSON.stringify(a.slice(0,100)))}
function shortsOrder(){try{return JSON.parse(localStorage.getItem('mytube_shorts_order')||'[]')}catch{return []}}
function render(){let q=($('#search').value||'').trim().toLowerCase();let vs=all.filter(v=>{const text=(v.title+' '+(v.description||'')+' '+(v.category||'')).toLowerCase();const cat=!activeCat||v.category===activeCat||activeCat==='Music'&&/music|song|mix/i.test(text)||activeCat==='Mixes'&&/mix/i.test(text)||activeCat==='Romantic Music'&&/romantic|love/i.test(text);return text.includes(q)&&cat});if(view==='history'){const ids=historyIds();vs.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));vs=vs.filter(v=>ids.includes(v.id))}const isRecommendedView=!list&&!view&&!activeCat&&!q;if(isRecommendedView&&recSeed.length)vs.sort((a,b)=>{const ia=recSeed.indexOf(a.id),ib=recSeed.indexOf(b.id);return (ia===-1?1e9:ia)-(ib===-1?1e9:ib)});else vs.sort((a,b)=>new Date(b.createdTime||0)-new Date(a.createdTime||0));if(view==='shorts'){vs=vs.filter(v=>v.isShort);if(!list&&!activeCat&&!q){const order=shortsOrder();if(order.length)vs.sort((a,b)=>{const ia=order.indexOf(a.id),ib=order.indexOf(b.id);return (ia===-1?1e9:ia)-(ib===-1?1e9:ib)})}}else if(list==='liked'){vs=vs.filter(v=>!v.isShort);}
lastRendered=vs.map(v=>v.id);
$('#grid').innerHTML=vs.length?vs.map((v,i)=>`<article class="video-card${selected.has(v.id)?' is-selected':''}"><a class="thumb" href="${v.isShort?'/shorts.html':'/watch.html'}?id=${encodeURIComponent(v.id)}" data-watch="${esc(v.id)}"><span class="select-check${selected.has(v.id)?' checked':''}" data-select="${esc(v.id)}" aria-label="Select video"></span><img loading="lazy" src="${esc(v.thumbnail)}" alt=""><video class="thumb-preview" muted loop playsinline preload="none" data-src="/api/videos/${encodeURIComponent(v.id)}/stream"></video>${v.isShort?'<span class="short-badge">Shorts</span>':''}<span class="duration">${esc(v.duration||'')}</span><span class="thumb-play">▶</span></a><div class="card-row"><div class="channel-avatar">${esc((v.title||'M').trim()[0].toUpperCase())}</div><div class="card-body"><a class="video-title" href="${v.isShort?'/shorts.html':'/watch.html'}?id=${encodeURIComponent(v.id)}" data-watch="${esc(v.id)}">${esc(v.title)}</a><p class="channel">D Player</p><p class="stats">${fmtViews(v.views)} · ${ago(v.createdTime)}</p></div><button class="more-btn" data-menu="${esc(v.id)}">⋮</button></div><div class="card-menu" id="menu-${esc(v.id)}"><button data-short="${esc(v.id)}">${v.isShort?'◈ Remove from Shorts':'◈ Mark as Short'}</button><button data-thumb="${esc(v.id)}">🖼 Change thumbnail</button><button data-delete="${esc(v.id)}" class="delete-btn">🗑 Delete</button></div></article>`).join(''):(()=>{
  const likedShorts=view==='shorts'&&list==='liked';
  const likedVideos=list==='liked'&&view!=='shorts';
  const icon=view==='shorts'?'◈':'⌕';
  const title=likedShorts?'No liked Shorts yet':likedVideos?'No liked videos yet':view==='shorts'?'No Shorts yet':'No videos found';
  const text=likedShorts?'Like a Short and it will show up here.':likedVideos?'Like a video and it will show up here.':view==='shorts'?'Videos 60 seconds or under show up here automatically — or mark any video as a Short from its ⋮ menu.':'Try another search or upload a video to your D Player Drive folder.';
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><h2>${title}</h2><p>${text}</p></div>`;
})();
 $('#grid').classList.toggle('select-mode',selectMode);
 document.querySelectorAll('[data-watch]').forEach(a=>a.addEventListener('click',e=>{if(selectMode){e.preventDefault();toggleSelect(a.dataset.watch);return}addHistory(a.dataset.watch)}));
 document.querySelectorAll('[data-select]').forEach(el=>el.onclick=e=>{e.preventDefault();e.stopPropagation();toggleSelect(el.dataset.select)});
 document.querySelectorAll('[data-short]').forEach(b=>b.onclick=async e=>{
   e.preventDefault();e.stopPropagation();
   const vid=b.dataset.short;
   const v=all.find(x=>x.id===vid);
   try{await api('/api/videos/'+encodeURIComponent(vid)+'/short',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({short:!(v&&v.isShort)})});await load()}catch(err){toast(err.message)}
 });
document.querySelectorAll('[data-thumb]').forEach(b=>b.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  const input=$('#thumbnailInput');
  input.dataset.videoId=b.dataset.thumb;
  input.value='';
  input.click();
});
document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async e=>{
  e.preventDefault();e.stopPropagation();
  const vid=b.dataset.delete;
  const v=all.find(x=>x.id===vid);
  if(!confirm('Delete "'+(v?v.title:'this video')+'"? It will be moved to the trash in Google Drive.'))return;
  try{
    b.disabled=true;
    await api('/api/videos/'+encodeURIComponent(vid)+'/delete',{method:'DELETE'});
    toast('Video deleted');
    await load();
  }catch(e){toast(e.message||'Could not delete video');b.disabled=false}
});
document.querySelectorAll('[data-menu]').forEach(b=>b.onclick=e=>{e.preventDefault();e.stopPropagation();const menu=$('#menu-'+CSS.escape(b.dataset.menu));const wasOpen=menu.classList.contains('open');document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'));if(!wasOpen)menu.classList.add('open')});
wireThumbPreviews();updateSelectBar();}
// Multi-select: a toggle button switches the grid into selection mode, where
// tapping a card selects it (instead of opening the video) and a toolbar
// offers bulk Favorite/Like/Delete across everything currently checked.
function toggleSelect(id){
  if(selected.has(id))selected.delete(id);else selected.add(id);
  render();
}
function updateSelectBar(){
  const bar=$('#selectBar');
  if(!bar)return;
  if(!selectMode){
    bar.innerHTML='<button class="select-toggle" id="selectToggleBtn" type="button">☑ Select</button>';
    $('#selectToggleBtn').onclick=()=>{selectMode=true;selected.clear();render()};
    return;
  }
  const n=selected.size;
  const allSelected=lastRendered.length>0&&lastRendered.every(id=>selected.has(id));
  bar.innerHTML=`<div class="select-toolbar">
    <button class="select-cancel" id="selectCancelBtn" type="button">✕ Cancel</button>
    <span class="select-count">${n?n+' selected':'Select videos'}</span>
    <button class="select-all-btn" id="selectAllBtn" type="button">${allSelected?'Deselect all':'Select all'}</button>
    <div class="select-actions">
      <button data-bulk="favorite" ${n?'':'disabled'}><span class="fav-icon"></span>Favorite</button>
      <button data-bulk="like" ${n?'':'disabled'}>👍 Like</button>
      <button data-bulk="delete" class="delete-btn" ${n?'':'disabled'}>🗑 Delete</button>
    </div>
  </div>`;
  $('#selectCancelBtn').onclick=()=>{selectMode=false;selected.clear();render()};
  $('#selectAllBtn').onclick=()=>{
    if(allSelected)lastRendered.forEach(id=>selected.delete(id));
    else lastRendered.forEach(id=>selected.add(id));
    render();
  };
  document.querySelectorAll('[data-bulk]').forEach(b=>b.onclick=()=>runBulkAction(b.dataset.bulk));
}
async function runBulkAction(action){
  const ids=[...selected];
  if(!ids.length)return;
  if(action==='delete'&&!confirm(`Delete ${ids.length} video${ids.length>1?'s':''}? They will be moved to the trash in Google Drive.`))return;
  $('#selectBar').querySelectorAll('button').forEach(b=>b.disabled=true);
  let ok=0,fail=0;
  for(const id of ids){
    try{
      const path=action==='delete'?'/delete':'/'+action;
      await api('/api/videos/'+encodeURIComponent(id)+path,{method:action==='delete'?'DELETE':'POST'});
      ok++;
    }catch(e){fail++}
  }
  const verb=action==='delete'?'deleted':'updated';
  toast(fail?`${ok} ${verb}, ${fail} failed`:`${ok} video${ok===1?'':'s'} ${verb}`);
  selectMode=false;selected.clear();
  await load();
}
// Hover preview: on devices with a real mouse, hovering a thumbnail for a
// moment starts playing the video muted in place of the static thumbnail,
// the same way it plays a moment later on watch.html. Only the buffered
// range is fetched (the stream endpoint supports Range requests), and the
// element is fully torn down on mouseleave so nothing keeps downloading in
// the background once the pointer moves off.
const canHoverPreview=matchMedia('(hover:hover) and (pointer:fine)').matches;
function wireThumbPreviews(){
  if(!canHoverPreview)return;
  document.querySelectorAll('.thumb').forEach(t=>{
    const vid=t.querySelector('.thumb-preview');
    if(!vid||vid.dataset.wired)return;
    vid.dataset.wired='1';
    vid.muted=true;
    let timer=null;
    const stop=()=>{
      clearTimeout(timer);
      timer=null;
      t.classList.remove('previewing');
      if(vid.src){vid.pause();vid.removeAttribute('src');vid.load()}
    };
    t.addEventListener('mouseenter',()=>{
      clearTimeout(timer);
      // Start buffering immediately so the stream has a head start over the
      // network - waiting until the delay fires before even requesting the
      // video is what made playback feel laggy once it kicked in. currentTime
      // is already 0 on a fresh src, so skip the redundant extra seek.
      if(!vid.src)vid.src=vid.dataset.src;
      timer=setTimeout(()=>{
        vid.play().then(()=>t.classList.add('previewing')).catch(()=>{});
      },500);
    });
    t.addEventListener('mouseleave',stop);
  });
}
async function prepareThumbnail(file){
  if(!file.type.startsWith('image/'))throw Error('Please choose an image file.');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((resolve,reject)=>{
      const i=new Image();
      i.onload=()=>resolve(i);
      i.onerror=()=>reject(Error('The selected image could not be read.'));
      i.src=url;
    });
    const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,w,h);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob)throw Error('Could not prepare the thumbnail.');
    return blob;
  }finally{URL.revokeObjectURL(url)}
}
$('#thumbnailInput').onchange=async()=>{
  const input=$('#thumbnailInput'),file=input.files?.[0],videoId=input.dataset.videoId;
  if(!file||!videoId)return;
  try{
    toast('Preparing thumbnail…');
    const blob=await prepareThumbnail(file);
    if(blob.size>1900000)throw Error('Thumbnail is still too large. Please choose a smaller image.');
    const r=await fetch('/api/videos/'+encodeURIComponent(videoId)+'/thumbnail',{
      method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw Error(j.error||'Thumbnail upload failed.');
    toast('Thumbnail changed');
    await load();
  }catch(e){toast(e.message||'Thumbnail upload failed.')}
};
function folderVideosUrl(){
  if(list==='liked')return '/api/liked';
  if(list==='favorites')return '/api/favorites';
  return '/api/videos'+(folder?('?folder='+encodeURIComponent(folder)):'');
}
function updateFolderHeader(){
  const el=$('#folderHeader');
  if(!el)return;
  if(!folder){el.hidden=true;return}
  const f=folders.find(x=>x.id===folder);
  $('#folderHeaderTitle').textContent=f?f.name:'Folder';
  el.hidden=false;
}
function renderFolderTree(){
  const map=new Map(folders.map(f=>[f.id,{...f,children:[]}]));
  const roots=[];
  map.forEach(f=>{
    if(f.parentId&&map.has(f.parentId))map.get(f.parentId).children.push(f);
    else roots.push(f);
  });
  const byName=(a,b)=>a.name.localeCompare(b.name);
  (function sortTree(nodes){nodes.sort(byName);nodes.forEach(n=>sortTree(n.children))})(roots);
  function pathToActive(nodes){
    for(const n of nodes){
      if(n.id===folder)return [n.id];
      const sub=pathToActive(n.children);
      if(sub)return [n.id,...sub];
    }
    return null;
  }
  const openPath=new Set(folder?(pathToActive(roots)||[]):[]);
  function renderNodes(nodes,depth){
    if(!nodes.length)return '';
    return '<div class="folder-list">'+nodes.map(n=>{
      const hasKids=n.children.length>0;
      const isOpen=openPath.has(n.id);
      return `<div class="folder-node">
        <div class="folder-row${n.id===folder?' active':''}" style="padding-left:${depth*14}px">
          ${hasKids?`<button class="folder-toggle${isOpen?' open':''}" data-toggle="${esc(n.id)}" aria-label="Expand folder">▸</button>`:'<span class="folder-toggle-spacer"></span>'}
          <button class="folder-link" data-folder="${esc(n.id)}">📁 <span>${esc(n.name)}</span></button>
        </div>
        ${hasKids?`<div class="folder-children" id="fc-${esc(n.id)}" style="display:${isOpen?'block':'none'}">${renderNodes(n.children,depth+1)}</div>`:''}
      </div>`;
    }).join('')+'</div>';
  }
  $('#folderTree').innerHTML=roots.length?renderNodes(roots,0):'<div class="side-small">No folders found.</div>';
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=e=>{
    e.preventDefault();e.stopPropagation();
    toggleFolderChildren(b.dataset.toggle);
  });
  document.querySelectorAll('[data-folder]').forEach(b=>{
    const hasKids=!!document.getElementById('fc-'+b.dataset.folder);
    if(!hasKids){
      // Leaf folders have nothing to expand — a single click just opens them.
      b.onclick=()=>{location.href='/?folder='+encodeURIComponent(b.dataset.folder)};
      return;
    }
    // Folders with subfolders: single click expands/collapses the subfolder
    // list; double click opens the folder's videos (and collapses the list,
    // since the click that triggers dblclick already toggled it open).
    let clickTimer=null;
    b.onclick=()=>{
      if(clickTimer){clearTimeout(clickTimer);clickTimer=null;return}
      clickTimer=setTimeout(()=>{
        clickTimer=null;
        toggleFolderChildren(b.dataset.folder);
      },260);
    };
    b.ondblclick=e=>{
      e.preventDefault();
      if(clickTimer){clearTimeout(clickTimer);clickTimer=null}
      location.href='/?folder='+encodeURIComponent(b.dataset.folder);
    };
  });
}
function toggleFolderChildren(id){
  const kids=document.getElementById('fc-'+id);
  if(!kids)return;
  const isOpenNow=kids.style.display!=='none';
  kids.style.display=isOpenNow?'none':'block';
  const toggleBtn=document.querySelector('[data-toggle="'+id+'"]');
  if(toggleBtn)toggleBtn.classList.toggle('open',!isOpenNow);
}
async function loadFolders(){
  try{
    folders=await api('/api/folders');
    renderFolderTree();
    updateFolderHeader();
  }catch(e){
    $('#folderTree').innerHTML='<div class="side-small">'+(e.message==='Google Drive is not connected'?'Connect Google Drive to see folders.':'Could not load folders.')+'</div>';
  }
}
document.querySelectorAll('[data-nav]').forEach(a=>{
  const isActive=(a.dataset.nav==='home'&&!list&&!folder&&!view)||(a.dataset.nav==='shorts'&&view==='shorts'&&list!=='liked')||(a.dataset.nav==='liked'&&list==='liked'&&view!=='shorts')||(a.dataset.nav==='liked-shorts'&&list==='liked'&&view==='shorts')||(a.dataset.nav==='favorites'&&list==='favorites')||(a.dataset.nav==='history'&&view==='history');
  a.classList.toggle('active',isActive);
});
updateFolderHeader();
async function load(silent){try{
  if(!silent&&!firstLoadDone)showSkeleton();
  const me=await api('/api/me');
  $('#accountStatus').textContent='Signed in as '+(me.email||'');
  if(me.email){$('#avatarBtn').textContent=(me.email[0]||'A').toUpperCase();const bn=$('#bnavAvatar');if(bn)bn.textContent=(me.email[0]||'A').toUpperCase()}
  all=(await api(folderVideosUrl())).filter(v=>String(v.mimeType||'').toLowerCase()!=='application/vnd.google-apps.folder' && !v.isFolder);
  if(!recSeed.length)shuffleRecommendations();
  firstLoadDone=true;
  if(silent)$('#grid').classList.add('refreshing');
  render();
  if(silent)setTimeout(()=>$('#grid').classList.remove('refreshing'),500);
}catch(e){
  firstLoadDone=true;
  if(e.message==='Google Drive is not connected'){
    $('#accountStatus').textContent='Connect Google Drive to load your videos.';
    render();
    return;
  }
  location.href='/login.html';
}}
$('#searchForm').onsubmit=e=>{e.preventDefault();syncSearchUrl();render()};$('#search').oninput=()=>{syncSearchUrl();render()};document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeCat=b.dataset.cat;render()});
function openMenu(){$('#sidebar').classList.add('open');$('#sidebarBackdrop').classList.add('show')}
function closeMenu(){$('#sidebar').classList.remove('open');$('#sidebarBackdrop').classList.remove('show')}
$('#menuBtn').onclick=()=>{$('#sidebar').classList.contains('open')?closeMenu():openMenu()};
$('#sidebarClose').onclick=closeMenu;
$('#sidebarBackdrop').onclick=closeMenu;
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{location.href='/?view='+encodeURIComponent(b.dataset.view)});
$('#createBtn').onclick=()=>showModal('Create','To add videos, upload them to your configured Google Drive “D Player Videos” folder. They will appear here after refresh.');$('#bellBtn').onclick=()=>showModal('Notifications','You have no new notifications.');$('#profileBtn').onclick=async()=>{try{const me=await api('/api/me');showModal('Your profile',me.email||'Signed in');}catch(e){location.href='/login.html'}};
$('#avatarBtn').onclick=async()=>{try{const me=await api('/api/me');showAccountModal(me.email||'Signed in');}catch(e){location.href='/login.html'}};$('#modalClose').onclick=()=>$('#modal').classList.remove('show');$('#modal').onclick=e=>{if(e.target.id==='modal')$('#modal').classList.remove('show')};function clearModalActions(){const a=$('#modalActions');if(a)a.innerHTML=''}
function showModal(t,m){$('#modalTitle').textContent=t;$('#modalText').textContent=m;clearModalActions();$('#modal').classList.add('show')}
function showAccountModal(email){
  $('#modalTitle').textContent='Account';
  $('#modalText').textContent=email;
  const actions=$('#modalActions');
  actions.innerHTML='';
  const out=document.createElement('button');
  out.type='button';
  out.className='modal-signout';
  out.textContent='Sign out';
  out.onclick=()=>{out.disabled=true;out.textContent='Signing out…';location.href='/logout'};
  actions.appendChild(out);
  $('#modal').classList.add('show');
}
document.querySelectorAll('[data-bnav]').forEach(a=>{
  const isActive=(a.dataset.bnav==='home'&&!list&&!folder&&!view)||(a.dataset.bnav==='history'&&view==='history');
  a.classList.toggle('active',isActive);
});
const bnavProfileBtn=$('#bnavProfileBtn');
if(bnavProfileBtn)bnavProfileBtn.onclick=async()=>{try{const me=await api('/api/me');showAccountModal(me.email||'Signed in');}catch(e){location.href='/login.html'}};
(function(){
  const bar=$('#homeBottomNav');
  if(!bar)return;
  let lastY=window.scrollY||0,ticking=false;
  window.addEventListener('scroll',()=>{
    if(ticking)return;
    ticking=true;
    requestAnimationFrame(()=>{
      const y=window.scrollY||0;
      if(y<40)bar.classList.remove('hide');
      else if(y>lastY+4)bar.classList.add('hide');
      else if(y<lastY-4)bar.classList.remove('hide');
      lastY=y;ticking=false;
    });
  },{passive:true});
})();
document.addEventListener('click',e=>{if(!e.target.closest('.more-btn')&&!e.target.closest('.card-menu'))document.querySelectorAll('.card-menu.open').forEach(x=>x.classList.remove('open'))});load();loadFolders();
// Coming back from the Shorts player's search icon: hand focus straight to the search box.
if(params.get('focusSearch')){const sb=$('#search');if(sb){setTimeout(()=>{sb.focus();sb.select()},50)}}