const json=(d,s=200,e={})=>new Response(JSON.stringify(d),{status:s,headers:{"content-type":"application/json; charset=utf-8",...e}});
const enc=encodeURIComponent;
const cookie=(n,v,a)=>`${n}=${encodeURIComponent(v)}; Path=/; Max-Age=${a}; HttpOnly; Secure; SameSite=Lax`;
const clearCookie=n=>`${n}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
function getCookie(req,n){const h=req.headers.get("Cookie")||"";const m=h.match(new RegExp("(?:^|;\\s*)"+n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"=([^;]*)"));return m?decodeURIComponent(m[1]):null}
async function refresh(env,rt){const b=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:rt,grant_type:"refresh_token"});const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:b});if(!r.ok)throw Error("Google token refresh failed");return r.json()}
async function exchange(env,code,redirect){const b=new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:redirect,grant_type:"authorization_code"});const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:b});if(!r.ok){const t=await r.text();throw Error("Google token exchange failed: "+t)}return r.json()}
async function driveFetch(env,path,init={},email){
  const key=email?("drive_refresh_token:"+email):"drive_refresh_token";
  const rt=await env.SESSIONS.get(key);
  if(!rt)throw Error("Google Drive is not connected");
  // The access token is good for ~1hr, but previously we called Google's OAuth
  // refresh endpoint on every single driveFetch - meaning every Range request
  // during video scrubbing paid for a token refresh round-trip before it could
  // even ask Drive for bytes. Cache the access token so repeat calls within its
  // lifetime skip that entirely.
  const tokenKey="drive_access_token:"+(email||"");
  const doRefresh=async()=>{
    const tk=await refresh(env,rt);
    if(tk.refresh_token&&tk.refresh_token!==rt)await env.SESSIONS.put(key,tk.refresh_token);
    await env.SESSIONS.put(tokenKey,tk.access_token,{expirationTtl:Math.max(60,(tk.expires_in||3600)-120)});
    return tk.access_token;
  };
  let accessToken=await env.SESSIONS.get(tokenKey);
  if(!accessToken)accessToken=await doRefresh();
  const target=path.startsWith("http://")||path.startsWith("https://")?path:"https://www.googleapis.com/drive/v3/"+path;
  const send=tok=>{const h=new Headers(init.headers||{});h.set("Authorization","Bearer "+tok);return fetch(target,{...init,headers:h})};
  let res=await send(accessToken);
  if(res.status===401){
    // Cached token was rejected (revoked or expired early) - refresh once and retry.
    accessToken=await doRefresh();
    res=await send(accessToken);
  }
  return res;
}
async function user(req,env){
  const sid=getCookie(req,"mt_session");if(!sid)return null;
  // Sessions live in D1, not KV, so a plain write-then-read isn't at the
  // mercy of KV's ~60s global propagation delay. But D1 itself can serve
  // reads from a nearby read replica that hasn't caught up to a very
  // recent write yet - the same kind of lag, one layer down - which is why
  // switching to D1 alone still bounced people back to login right after
  // signing in. withSession("first-primary") forces this particular read
  // to go to the primary database instead of a possibly-stale replica, so
  // a session is guaranteed visible the instant it's created.
  const session=env.DB.withSession("first-primary");
  const row=await session.prepare("SELECT email,expires_at FROM sessions WHERE id=?").bind(sid).first();
  if(!row)return null;
  if(Number(row.expires_at)<Date.now()){
    await session.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run().catch(()=>{});
    return null;
  }
  return {email:row.email};
}
async function requireUser(req,env){const u=await user(req,env);if(!u)throw Object.assign(Error("Not signed in"),{status:401});return u}
async function hashPassword(password){
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:100000,hash:"SHA-256"},key,256);
  return "pbkdf2$100000$"+b64(salt)+"$"+b64(new Uint8Array(bits));
}
function b64(bytes){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function unb64(s){const bin=atob(s);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
async function verifyPassword(password,stored){
  const m=/^pbkdf2\$(\d+)\$([^$]+)\$([^$]+)$/.exec(stored||"");if(!m)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:"PBKDF2",salt:unb64(m[2]),iterations:Number(m[1]),hash:"SHA-256"},key,256));
  const got=b64(bits),want=m[3];if(got.length!==want.length)return false;
  let diff=0;for(let i=0;i<got.length;i++)diff|=got.charCodeAt(i)^want.charCodeAt(i);return diff===0;
}
function emailOk(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}

async function hashOtp(otp){
  const data=new TextEncoder().encode(String(otp));
  const digest=await crypto.subtle.digest("SHA-256",data);
  return b64(new Uint8Array(digest));
}
async function sendEmail(env,to,subject,text){
  if(!env.RESEND_API_KEY || !env.MAIL_FROM)
    throw Object.assign(Error("Email delivery is not configured. Add RESEND_API_KEY and MAIL_FROM to your Worker variables."),{status:503});
  const r=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,text})
  });
  if(!r.ok){
    const t=await r.text().catch(()=> "");
    throw Object.assign(Error("Unable to send email: "+(t||r.statusText)),{status:502});
  }
}
async function issueOtp(env,email,purpose){
  const otp=String(Math.floor(100000+Math.random()*900000));
  const now=Date.now(),expires=now+10*60*1000,id=crypto.randomUUID();
  await env.DB.prepare("DELETE FROM auth_otps WHERE email=? AND purpose=?").bind(email,purpose).run();
  await env.DB.prepare("INSERT INTO auth_otps(id,email,purpose,otp_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id,email,purpose,await hashOtp(otp),expires,0,now).run();
  const subject=purpose==="login"?"Your D Player sign-in code":"Your D Player password reset code";
  const text=`Your D Player verification code is ${otp}. It expires in 10 minutes. If you did not request this code, you can ignore this email.`;
  await sendEmail(env,email,subject,text);
}
async function consumeOtp(env,email,purpose,otp){
  const row=await env.DB.prepare("SELECT id,otp_hash,expires_at,attempts FROM auth_otps WHERE email=? AND purpose=? ORDER BY created_at DESC LIMIT 1").bind(email,purpose).first();
  if(!row)throw Object.assign(Error("No OTP was requested. Please request a new code."),{status:400});
  if(Number(row.expires_at)<Date.now())throw Object.assign(Error("OTP expired. Please request a new code."),{status:400});
  if(Number(row.attempts)>=5)throw Object.assign(Error("Too many incorrect attempts. Please request a new code."),{status:429});
  const ok=(await hashOtp(otp))===row.otp_hash;
  if(!ok){
    await env.DB.prepare("UPDATE auth_otps SET attempts=attempts+1 WHERE id=?").bind(row.id).run();
    throw Object.assign(Error("Incorrect OTP."),{status:401});
  }
  await env.DB.prepare("DELETE FROM auth_otps WHERE id=?").bind(row.id).run();
  return true;
}

async function createSession(env,email){
  const sid=crypto.randomUUID(),sessionTtl=31536000;
  await env.DB.prepare(
    "INSERT INTO sessions(id,email,created_at,expires_at) VALUES(?,?,?,?)"
  ).bind(sid,email,Date.now(),Date.now()+sessionTtl*1000).run();
  return cookie("mt_session",sid,sessionTtl);
}
async function destroySession(req,env){
  const sid=getCookie(req,"mt_session");
  if(sid)await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sid).run().catch(()=>{});
}
async function ensureAuthSchema(env){
  // Keep existing production D1 databases compatible even when the
  // one-time migrations (schema.sql etc.) were never applied yet — on a
  // brand new D1 database `users` itself doesn't exist, which used to make
  // the ALTER TABLE below throw "no such table: users" before login could
  // ever run. Create the core tables (mirrors schema.sql) first so this
  // function is safe to call against a completely empty database.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      picture TEXT,
      password_hash TEXT,
      created_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS likes (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id,video_id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id,video_id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS views (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS video_thumbnails (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      image_data BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id,video_id)
    )
  `).run();
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS video_shorts (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      is_short INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id,video_id)
    )
  `).run();

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS auth_otps (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_auth_otps_email_purpose ON auth_otps(email,purpose)"
  ).run();

  // Sessions live in D1 (not KV) so a session is readable the instant it's
  // created - see the comment on user() for why this matters.
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `).run();
  await env.DB.prepare(
    "CREATE INDEX IF NOT EXISTS idx_sessions_email ON sessions(email)"
  ).run();

  // Older databases may have users without password_hash.
  // SQLite throws when the column already exists, so ignore only that case.
  try{
    await env.DB.prepare("ALTER TABLE users ADD COLUMN password_hash TEXT").run();
  }catch(err){
    const message=String(err?.message||err||"");
    if(!/duplicate column name|already exists/i.test(message))throw err;
  }
}

async function authApi(req,env){
  await ensureAuthSchema(env);
  const u=new URL(req.url),p=u.pathname;
  if(p==="/api/auth/me"){
    const me=await user(req,env);return json({signedIn:!!me,email:me?.email||null});
  }
  if(p==="/api/auth/logout"){
    if(req.method!=="POST")throw Object.assign(Error("Method not allowed"),{status:405});
    await destroySession(req,env);
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json; charset=utf-8","Set-Cookie":clearCookie("mt_session")}});
  }
  if(req.method!=="POST")throw Object.assign(Error("Method not allowed"),{status:405});
  let body={};try{body=await req.json()}catch{throw Object.assign(Error("Invalid JSON"),{status:400})}
  const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||""),name=String(body.name||"").trim();

  // Google-session password setup does not require an email in the request.
  if(p==="/api/auth/set-password"){
    const me=await requireUser(req,env);
    if(password.length<8)throw Object.assign(Error("Password must be at least 8 characters."),{status:400});
    const hash=await hashPassword(password);
    const r=await env.DB.prepare("UPDATE users SET password_hash=? WHERE email=?").bind(hash,me.email).run();
    if(!r.meta?.changes)throw Object.assign(Error("Unable to set password."),{status:500});
    return json({ok:true});
  }

  // Change password for an already authenticated account.
  // The current password is required, so a logged-in user cannot silently
  // replace an existing password without proving they know it.
  if(p==="/api/auth/change-password"){
    const me=await requireUser(req,env);
    const currentPassword=String(body.currentPassword||"");
    const newPassword=String(body.newPassword||"");

    if(!currentPassword)
      throw Object.assign(Error("Enter your current password."),{status:400});
    if(newPassword.length<8)
      throw Object.assign(Error("New password must be at least 8 characters."),{status:400});
    if(currentPassword===newPassword)
      throw Object.assign(Error("New password must be different from your current password."),{status:400});

    const row=await env.DB.prepare(
      "SELECT password_hash FROM users WHERE email=?"
    ).bind(me.email).first();

    if(!row?.password_hash || !(await verifyPassword(currentPassword,row.password_hash)))
      throw Object.assign(Error("Current password is incorrect."),{status:401});

    const hash=await hashPassword(newPassword);
    const r=await env.DB.prepare(
      "UPDATE users SET password_hash=? WHERE email=?"
    ).bind(hash,me.email).run();

    if(!r.meta?.changes)
      throw Object.assign(Error("Unable to change password."),{status:500});

    return json({ok:true});
  }

  if(!emailOk(email))throw Object.assign(Error("Enter a valid email address."),{status:400});

  if(p==="/api/auth/otp/request"){
    const purpose=body.purpose==="reset"?"reset":"login";
    const exists=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if(purpose==="login" && !exists)throw Object.assign(Error("No account exists with this email. Please create an account first."),{status:404});
    if(purpose==="reset" && !exists)return json({ok:true}); // don't reveal whether an account exists
    await issueOtp(env,email,purpose);
    return json({ok:true});
  }

  if(p==="/api/auth/otp/verify"){
    const purpose=body.purpose==="reset"?"reset":"login";
    await consumeOtp(env,email,String(body.otp||"").trim());
    if(purpose==="reset")return json({ok:true});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json; charset=utf-8","Set-Cookie":await createSession(env,email)}});
  }

  if(p==="/api/auth/password-reset"){
    if(password.length<8)throw Object.assign(Error("Password must be at least 8 characters."),{status:400});
    await consumeOtp(env,email,"reset",String(body.otp||"").trim());
    const hash=await hashPassword(password);
    const r=await env.DB.prepare("UPDATE users SET password_hash=? WHERE email=?").bind(hash,email).run();
    if(!r.meta?.changes)throw Object.assign(Error("Unable to reset password."),{status:500});
    return json({ok:true});
  }

  if(password.length<8)throw Object.assign(Error("Password must be at least 8 characters."),{status:400});
  if(p==="/api/auth/signup"){
    const exists=await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if(exists)throw Object.assign(Error("An account with this email already exists. Sign in instead."),{status:409});
    const hash=await hashPassword(password);
    await env.DB.prepare("INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(),email,name||null,hash,Date.now()).run();
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json; charset=utf-8","Set-Cookie":await createSession(env,email)}});
  }
  if(p==="/api/auth/login"){
    const row=await env.DB.prepare("SELECT email,password_hash FROM users WHERE email=?").bind(email).first();
    if(!row?.password_hash || !(await verifyPassword(password,row.password_hash)))
      throw Object.assign(Error("Incorrect email or password."),{status:401});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json; charset=utf-8","Set-Cookie":await createSession(env,email)}});
  }
  throw Object.assign(Error("Not found"),{status:404});
}
async function listFolders(env,u){
  const q="trashed = false and mimeType = 'application/vnd.google-apps.folder'";
  const fields="nextPageToken,files(id,name,parents)";
  let pageToken=null, files=[];
  do{
    const params=new URLSearchParams({
      q,orderBy:"name",pageSize:"1000",fields,
      spaces:"drive",includeItemsFromAllDrives:"true",supportsAllDrives:"true"
    });
    if(pageToken)params.set("pageToken",pageToken);
    const r=await driveFetch(env,"files?"+params,{},u.email);
    if(!r.ok){
      const detail=await r.text().catch(()=> "");
      throw Error("Google Drive API "+r.status+": "+(detail||r.statusText||"Unable to list folders"));
    }
    const j=await r.json();
    files.push(...(j.files||[]));
    pageToken=j.nextPageToken||null;
  }while(pageToken);
  return files.map(f=>({id:f.id,name:f.name,parentId:(f.parents&&f.parents[0])||null}));
}
async function listVideos(env,u,folderId){
  const typeQ="(mimeType contains 'video/' or name contains '.ts' or name contains '.TS' or name contains '.mkv' or name contains '.MKV' or name contains '.avi' or name contains '.AVI' or name contains '.mov' or name contains '.MOV' or name contains '.m4v' or name contains '.M4V' or name contains '.mpeg' or name contains '.MPEG' or name contains '.mpg' or name contains '.MPG' or name contains '.mts' or name contains '.MTS' or name contains '.m2ts' or name contains '.M2TS')";
  let q="trashed = false and "+typeQ;
  if(folderId&&/^[\w-]+$/.test(folderId))q=`'${folderId}' in parents and trashed = false and `+typeQ;
  const fields="nextPageToken,files(id,name,mimeType,size,createdTime,description,thumbnailLink,videoMediaMetadata(durationMillis,width,height))";
  let pageToken=null, files=[];
  do{
    const params=new URLSearchParams({
      q,orderBy:"createdTime desc",pageSize:"1000",fields,
      spaces:"drive",includeItemsFromAllDrives:"true",supportsAllDrives:"true"
    });
    if(pageToken)params.set("pageToken",pageToken);
    const r=await driveFetch(env,"files?"+params,{},u.email);
    if(!r.ok){
      const detail=await r.text().catch(()=> "");
      throw Error("Google Drive API "+r.status+": "+(detail||r.statusText||"Unable to list files"));
    }
    const j=await r.json();
    files.push(...(j.files||[]));
    pageToken=j.nextPageToken||null;
  }while(pageToken);

  const [lr,fr,vr]=await Promise.all([
    env.DB.prepare("SELECT video_id FROM likes WHERE user_id=?").bind(u.email).all(),
    env.DB.prepare("SELECT video_id FROM favorites WHERE user_id=?").bind(u.email).all(),
    env.DB.prepare("SELECT video_id,COUNT(*) count FROM views GROUP BY video_id").all()
  ]);
  let tr={results:[]};
  try{tr=await env.DB.prepare("SELECT video_id,updated_at FROM video_thumbnails WHERE user_id=?").bind(u.email).all()}catch(_){}
  let sr={results:[]};
  try{sr=await env.DB.prepare("SELECT video_id,is_short FROM video_shorts WHERE user_id=?").bind(u.email).all()}catch(_){}
  const ls=new Set(lr.results.map(x=>x.video_id));
  const fs=new Set(fr.results.map(x=>x.video_id));
  const vc=new Map(vr.results.map(x=>[x.video_id,x.count]));
  const tv=new Map(tr.results.map(x=>[x.video_id,x.updated_at]));
  const so=new Map(sr.results.map(x=>[x.video_id,!!x.is_short]));
  // Shorts (YouTube-style short-form clips): a video counts as a Short
  // automatically when it's 60 seconds or under, OR when Drive reports it
  // as portrait/vertical (taller than it is wide) — matching YouTube's own
  // rule that vertical clips belong in Shorts regardless of length. A
  // manual override in video_shorts always wins over that automatic guess,
  // in either direction, so a longer or landscape clip can still be flagged
  // as a Short and vice versa.
  const fmtDuration=ms=>{
    if(!ms)return null;
    const total=Math.round(ms/1000),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
    const mm=h?String(m).padStart(2,"0"):String(m);
    return (h?h+":":"")+mm+":"+String(s).padStart(2,"0");
  };
  return files.map(f=>{
    const meta=f.videoMediaMetadata;
    const durationMs=meta?.durationMillis?Number(meta.durationMillis):null;
    const width=meta?.width?Number(meta.width):null;
    const height=meta?.height?Number(meta.height):null;
    const isPortrait=!!(width&&height&&height>width);
    const autoShort=(durationMs!=null&&durationMs<=60000)||isPortrait;
    const isShort=so.has(f.id)?so.get(f.id):autoShort;
    return {...f,title:f.name,category:"Other",views:vc.get(f.id)||0,
      liked:ls.has(f.id),favorite:fs.has(f.id),isShort,isPortrait,
      duration:fmtDuration(durationMs),
      thumbnail:"/api/videos/"+enc(f.id)+"/thumbnail"+(tv.has(f.id)?"?v="+tv.get(f.id):"")};
  });
}
async function api(req,env){
  const u=new URL(req.url),p=u.pathname;
  if(p.startsWith("/api/auth/"))return await authApi(req,env);
  const me=await requireUser(req,env);
  if(p==="/api/me"){const row=await env.DB.prepare("SELECT email,name,picture FROM users WHERE email=?").bind(me.email).first();return json({signedIn:true,email:me.email,name:row?.name||null,picture:row?.picture||null});}
  if(p==="/api/videos"&&req.method==="GET")return json(await listVideos(env,me,u.searchParams.get("folder")||null));
  if(p==="/api/folders"&&req.method==="GET")return json(await listFolders(env,me));
  if(p==="/api/liked")return json((await listVideos(env,me)).filter(v=>v.liked));
  if(p==="/api/favorites")return json((await listVideos(env,me)).filter(v=>v.favorite));

  const m=p.match(/^\/api\/videos\/([^/]+)\/(like|favorite|view|stream|thumbnail|delete|short)$/);
  if(!m)throw Object.assign(Error("Not found"),{status:404});
  const id=decodeURIComponent(m[1]),act=m[2];

  if(act==="delete"){
    if(req.method!=="DELETE"&&req.method!=="POST")throw Object.assign(Error("Method not allowed"),{status:405});
    // Move the file to Google Drive's trash rather than deleting it
    // permanently, so a mistaken delete can still be recovered from Drive.
    const r=await driveFetch(env,`files/${enc(id)}`,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({trashed:true})
    },me.email);
    if(!r.ok){
      if(r.status===404)throw Object.assign(Error("Video not found"),{status:404});
      const detail=await r.text().catch(()=> "");
      throw Error("Google Drive "+r.status+": "+(detail||r.statusText||"Unable to delete video"));
    }
    await Promise.all([
      env.DB.prepare("DELETE FROM likes WHERE video_id=?").bind(id).run(),
      env.DB.prepare("DELETE FROM favorites WHERE video_id=?").bind(id).run(),
      env.DB.prepare("DELETE FROM views WHERE video_id=?").bind(id).run(),
      env.DB.prepare("DELETE FROM video_thumbnails WHERE video_id=?").bind(id).run(),
      env.DB.prepare("DELETE FROM video_shorts WHERE video_id=?").bind(id).run()
    ]);
    return json({ok:true});
  }

  if(act==="like"||act==="favorite"){
    const t=act==="like"?"likes":"favorites";
    const has=await env.DB.prepare(`SELECT 1 FROM ${t} WHERE user_id=? AND video_id=?`).bind(me.email,id).first();
    if(has)await env.DB.prepare(`DELETE FROM ${t} WHERE user_id=? AND video_id=?`).bind(me.email,id).run();
    else await env.DB.prepare(`INSERT OR IGNORE INTO ${t}(user_id,video_id,created_at) VALUES(?,?,?)`).bind(me.email,id,Date.now()).run();
    return json({active:!has});
  }

  // Manual Shorts override. Automatic classification (<=60s) happens in
  // listVideos; this table lets a user pull a video in or out of the
  // Shorts shelf regardless of its actual duration.
  if(act==="short"&&req.method==="POST"){
    const body=await req.json().catch(()=>({}));
    const isShort=!!body.short;
    await env.DB.prepare(`
      INSERT INTO video_shorts(user_id,video_id,is_short,updated_at)
      VALUES(?,?,?,?)
      ON CONFLICT(user_id,video_id) DO UPDATE SET
        is_short=excluded.is_short,
        updated_at=excluded.updated_at
    `).bind(me.email,id,isShort?1:0,Date.now()).run();
    return json({isShort});
  }

  if(act==="view"){
    await env.DB.prepare("INSERT INTO views(user_id,video_id,created_at) VALUES(?,?,?)").bind(me.email,id,Date.now()).run();
    return json({ok:true});
  }

  // D Player keeps custom thumbnails in D1. This avoids depending on Google
  // Drive's generated thumbnail for video files, which can override a
  // contentHints.thumbnail supplied to Drive.
  if(act==="thumbnail" && req.method==="POST"){
    const contentType=(req.headers.get("content-type")||"image/jpeg").split(";")[0].toLowerCase();
    if(!["image/jpeg","image/png","image/gif","image/webp"].includes(contentType)){
      throw Object.assign(Error("Thumbnail must be JPG, PNG, GIF or WebP"),{status:415});
    }
    const bytes=await req.arrayBuffer();
    if(!bytes.byteLength)throw Object.assign(Error("Thumbnail is empty"),{status:400});
    // D1 has a 2 MB maximum string/BLOB/row size. Keep a safety margin for
    // the rest of the row and reject oversized uploads.
    if(bytes.byteLength>1900000)throw Object.assign(Error("Thumbnail is too large. Please use an image under 1.9 MB."),{status:413});
    await env.DB.prepare(`
      INSERT INTO video_thumbnails(user_id,video_id,mime_type,image_data,updated_at)
      VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,video_id) DO UPDATE SET
        mime_type=excluded.mime_type,
        image_data=excluded.image_data,
        updated_at=excluded.updated_at
    `).bind(me.email,id,contentType,new Uint8Array(bytes),Date.now()).run();
    return json({ok:true});
  }

  if(act==="thumbnail"){
    const custom=await env.DB.prepare(
      "SELECT mime_type,image_data,updated_at FROM video_thumbnails WHERE user_id=? AND video_id=?"
    ).bind(me.email,id).first();
    if(custom?.image_data){
      // D1 can return BLOB columns as ArrayBuffer/TypedArray values.
      // Normalize the value to a real ArrayBuffer before creating the
      // Response. Passing the raw D1 BLOB directly can produce a Worker
      // Response error, which appears in the browser as a broken image.
      let body=custom.image_data;
      if(body instanceof ArrayBuffer){
        // already suitable for Response
      }else if(ArrayBuffer.isView(body)){
        body=body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength);
      }else if(Array.isArray(body)){
        body=Uint8Array.from(body).buffer;
      }else{
        throw Object.assign(Error("Stored thumbnail data is invalid"),{status:500});
      }
      return new Response(body,{
        status:200,
        headers:{
          "content-type":custom.mime_type||"image/jpeg",
          "content-length":String(body.byteLength),
          "cache-control":"private,no-store",
          "x-content-type-options":"nosniff",
          "etag":`"mt-thumb-${custom.updated_at}"`
        }
      });
    }
    const info=await driveFetch(env,`files/${enc(id)}?fields=${enc("id,name,mimeType,size,thumbnailLink")}`,{},me.email);
    if(!info.ok)return new Response("",{status:404});
    const f=await info.json();
    if(!f.thumbnailLink)return new Response("",{status:404});
    const tr=await driveFetch(env,f.thumbnailLink,{},me.email);
    if(!tr.ok)return new Response("",{status:404});
    return new Response(tr.body,{status:tr.status,headers:{
      "content-type":tr.headers.get("content-type")||"image/jpeg",
      "cache-control":"private,max-age=300"
    }});
  }

  // File metadata (name/size/mimeType) almost never changes mid-playback, but
  // scrubbing fires a fresh Range request - and previously a fresh metadata
  // lookup - on every seek. Cache it briefly per user+file so a scrub session
  // only pays for the metadata round-trip once.
  const metaKey=`drive_video_meta:${me.email}:${id}`;
  let f=null;
  const cachedMeta=await env.SESSIONS.get(metaKey);
  if(cachedMeta){
    f=JSON.parse(cachedMeta);
  }else{
    const info=await driveFetch(env,`files/${enc(id)}?fields=${enc("id,name,mimeType,size,thumbnailLink")}`,{},me.email);
    if(!info.ok)return new Response("Not found",{status:404});
    f=await info.json();
    await env.SESSIONS.put(metaKey,JSON.stringify(f),{expirationTtl:300});
  }
  if(req.method==="HEAD")return new Response(null,{status:200,headers:{
    "content-type":f.mimeType||"application/octet-stream",
    "content-length":String(f.size||0),
    "accept-ranges":"bytes",
    "cache-control":"private, no-store"
  }});
  const range=req.headers.get("Range");
  const h={};
  if(range)h.Range=range;
  h.Accept="*/*";
  h["Accept-Encoding"]="identity";
  let r=await driveFetch(env,`files/${enc(id)}?alt=media`,{headers:h,redirect:"manual"},me.email);
  if(r.status>=300&&r.status<400){
    const loc=r.headers.get("Location");
    if(!loc)throw Error("Google Drive returned a redirect without a download URL");
    r=await driveFetch(env,loc,{headers:h,redirect:"follow"},me.email);
  }
  if(!r.ok){
    const detail=await r.text().catch(()=> "");
    throw Error("Google Drive video "+r.status+": "+(detail||r.statusText||"Unable to stream video"));
  }
  const headers=new Headers(r.headers);
  const ext=((f.name||"").match(/\.([^.]+)$/)||[])[1]?.toLowerCase();
  const mediaTypes={ts:"video/mp2t",mts:"video/mp2t",m2ts:"video/mp2t",mkv:"video/x-matroska",avi:"video/x-msvideo",mov:"video/quicktime",m4v:"video/x-m4v",mpeg:"video/mpeg",mpg:"video/mpeg"};
  headers.set("content-type",mediaTypes[ext]||f.mimeType||headers.get("content-type")||"application/octet-stream");
  headers.set("content-disposition",`${u.searchParams.has("download")?"attachment":"inline"}; filename="${(f.name||"video").replaceAll('"',"")}"`);
  headers.set("accept-ranges","bytes");
  headers.set("cache-control","private, no-store");
  return new Response(r.body,{status:r.status,headers});
}

export default {async fetch(req,env){
  try{
    const u=new URL(req.url);

    if(u.pathname==="/auth/google"){
      // Keep the OAuth state in a short-lived HttpOnly cookie instead of KV.
      // Workers KV is eventually consistent, so the callback can reach a
      // different Cloudflare location before the just-created KV value is
      // visible there, causing a false "Invalid OAuth state" error.
      const state=crypto.randomUUID();
      const redirect=u.origin+"/auth/google/callback";
      const q=new URLSearchParams({
        client_id:env.GOOGLE_CLIENT_ID,
        redirect_uri:redirect,
        response_type:"code",
        scope:"openid email https://www.googleapis.com/auth/drive",
        access_type:"offline",
        prompt:"consent",
        state
      });
      return new Response(null,{status:302,headers:{
        Location:"https://accounts.google.com/o/oauth2/v2/auth?"+q,
        "Set-Cookie":cookie("oauth_state",state,600)
      }});
    }

    if(u.pathname==="/auth/google/callback"){
      const state=u.searchParams.get("state");
      const savedState=getCookie(req,"oauth_state");
      if(!state||!savedState||state!==savedState)
        return new Response("Invalid OAuth state",{status:400});

      const redirect=u.origin+"/auth/google/callback";
      const t=await exchange(env,u.searchParams.get("code"),redirect);
      if(!t.access_token)throw Error("Google did not return an access token.");

      const me=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{
        headers:{Authorization:"Bearer "+t.access_token}
      });
      const pr=await me.json();
      if(!pr.email)throw Error("Google did not return an email.");

      // Make sure the auth schema exists before reading password_hash.
      await ensureAuthSchema(env);

      await env.DB.prepare(
        "INSERT OR IGNORE INTO users(id,email,name,picture,created_at) VALUES(?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        pr.email,
        pr.name||null,
        pr.picture||null,
        Date.now()
      ).run();

      if(t.refresh_token)
        await env.SESSIONS.put("drive_refresh_token:"+pr.email,t.refresh_token);

      const sessionCookie=await createSession(env,pr.email);

      // If this Google account has no password yet, send the user to the
      // Set Password page. Otherwise continue normally to the home page.
      const account=await env.DB.prepare(
        "SELECT password_hash FROM users WHERE email=?"
      ).bind(pr.email).first();

      const destination=account?.password_hash ? "/" : "/set-password.html";

      return new Response(null,{
        status:302,
        headers:{
          Location:destination,
          "Set-Cookie":[sessionCookie,clearCookie("oauth_state")]
        }
      });
    }

    if(u.pathname==="/logout"){
      await ensureAuthSchema(env);
      await destroySession(req,env);
      return new Response(null,{
        status:302,
        headers:{
          Location:"/",
          "Set-Cookie":clearCookie("mt_session")
        }
      });
    }

    if(u.pathname.startsWith("/api/"))
      return await api(req,env);

    return env.ASSETS.fetch(req);
  }catch(e){
    return json({error:e.message||"Server error"},e.status||500);
  }
}};
