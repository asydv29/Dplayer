const $=s=>document.querySelector(s);
let signup=false;
function setMode(){
  $('#authTitle').textContent=signup?'Create your D Player account':'Sign in to D Player';
  $('#authSubtitle').textContent=signup?'Create an account with your email and password.':'Use your email and password, or continue with Google.';
  $('#nameLabel').classList.toggle('hidden',!signup);
  $('#confirmLabel').classList.toggle('hidden',!signup);
  $('#name').required=signup;
  $('#confirm').required=signup;
  $('#password').autocomplete=signup?'new-password':'current-password';
  $('#submitBtn').textContent=signup?'Create account':'Sign in';
  $('#switchBtn').textContent=signup?'Already have an account? Sign in':'Create an account';
  $('#error').textContent='';
}
async function api(url,opt){const r=await fetch(url,opt);const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||'Request failed');return j}
$('#switchBtn').onclick=()=>{signup=!signup;setMode()};
$('#authForm').onsubmit=async e=>{
 e.preventDefault();$('#error').textContent='';
 const email=$('#email').value.trim().toLowerCase(),password=$('#password').value;
 if(signup && password!==$('#confirm').value){$('#error').textContent='Passwords do not match.';return}
 try{
  await api(signup?'/api/auth/signup':'/api/auth/login',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email,password,name:$('#name').value.trim()})
  });
  location.href='/';
 }catch(err){$('#error').textContent=err.message||'Unable to sign in.'}
};
setMode();
