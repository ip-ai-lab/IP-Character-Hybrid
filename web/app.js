const $ = (x) => document.getElementById(x);
const form = $('vault-form');
const activity = $('activity');
const submit = $('generate');
let compressedFile = null;
let pollTimer = null;
let currentJob = null;
let extracted = null;
let capabilities = null;
const modeExplanations={economy:'Fast prototype: generic img2img; some panels reused and full-body accuracy is limited.', balanced:'Requires InstantID + SDXL OpenPose ControlNet in ComfyUI; all poses and expressions generated separately.',studio:'Adds local InsightFace similarity review and selective retries (up to 3 renders per low-quality panel).'};
$('mode').addEventListener('change',()=>{$('mode-help').textContent=modeExplanations[$('mode').value]});

function accessCode() {
  let code = sessionStorage.getItem('vault-access-code');
  if (!code) {
    code = window.prompt('Enter your IP Character Vault access code (configured in Netlify as VAULT_ACCESS_CODE):') ?? '';
    if (code.trim()) sessionStorage.setItem('vault-access-code', code.trim());
  }
  return code?.trim() ?? '';
}
async function api(path, options={}) {
  const code = accessCode();
  if (!code) throw new Error('Your studio access code is required. Refresh and enter it.');
  const headers = new Headers(options.headers || {});
  headers.set('x-vault-access-code', code);
  let res = await fetch('/api/' + path, {...options, headers});
  if (res.status === 401) { sessionStorage.removeItem('vault-access-code'); throw new Error('Invalid studio access code. Refresh the page and try again.'); }
  if (!res.ok) {
    const data=await res.json().catch(()=>({}));
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return res;
}
function activityUpdate(title,progress,desc,error) {
  activity.classList.remove('hidden');
  $('activity-title').textContent=title;
  $('progress-text').textContent=`${progress}%`;
  $('progress-bar').style.width=`${progress}%`;
  $('activity-subtitle').textContent=desc||'';
  $('activity-error').classList.toggle('hidden',!error);
  $('activity-error').textContent=error||'';
}
function stopPolling(){if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}}
async function compressImage(file){
  if(!file.type.startsWith('image/')) throw new Error('Upload a PNG, JPG or WebP reference image.');
  if(file.size>30_000_000) throw new Error('Select an image smaller than 30 MB.');
  const bitmap=await createImageBitmap(file);
  const maxSide=1600;
  const scale=Math.min(1,maxSide/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*scale); canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  bitmap.close();
  const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/jpeg',.83));
  if(!blob)throw new Error('Could not prepare the image.');
  if(blob.size>3_000_000)throw new Error('The image is too large for Netlify. Try a smaller photo.');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
}
async function setImage(file){
  if(!file)return;
  try{
    compressedFile=await compressImage(file);
    $('preview').src=URL.createObjectURL(compressedFile);
    $('preview').hidden=false;
    $('dropzone').querySelector('strong').textContent=file.name;
  }catch(e){alert(e.message);$('reference').value='';compressedFile=null;}
}
$('reference').addEventListener('change',(e)=>setImage(e.target.files?.[0]));
const dz=$('dropzone');
['dragover','dragenter'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('drag')}));
['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('drag')}));
dz.addEventListener('drop',(e)=>setImage(e.dataTransfer?.files?.[0]));
async function ping(){
  try {const res=await api('health');const data=await res.json();$('backend-pill').textContent=data.ready?'● Worker online':'● Worker setup needed';$('backend-pill').className='pill '+(data.ready?'ok':'fail');const cap=await api('capabilities');capabilities=await cap.json();$('mode-capabilities').textContent=Object.entries(capabilities.modes).map(([key,val])=>key.toUpperCase()+': '+(val.ready?'ready':'setup required')).join(' · ');}
  catch(e){$('backend-pill').textContent='● Worker offline';$('backend-pill').className='pill fail';}
}
async function waitForJob(id){
  const res=await api('jobs/'+id);
  const job=await res.json();
  activityUpdate(job.state==='completed'?'Character sheet ready':job.state==='failed'?'Generation stopped':job.state==='analyzing'?'Analyzing your reference':'Building character continuity',job.progress||0,job.message||'',job.state==='failed'?job.error||'Worker failed.':'');
  if(job.state==='failed'){submit.disabled=false;return;}
  if(job.state==='completed'){
    submit.disabled=false;extracted=job.extracted||{};
    $('metadata').textContent=JSON.stringify(extracted,null,2);$('review-report').textContent=JSON.stringify(job.review||{notice:'No consistency reviewer was used.'},null,2);
    const image=await api('jobs/'+id+'/result');const blob=await image.blob();const url=URL.createObjectURL(blob);
    $('result-image').src=url;$('download').href=url;$('download').download=(job.character_name||'character').replace(/[^\w-]/g,'-').toLowerCase()+'-continuity-sheet.png';$('result').classList.remove('hidden');
    $('result').scrollIntoView({behavior:'smooth',block:'start'});return;
  }
  pollTimer=setTimeout(()=>waitForJob(id).catch(e=>{activityUpdate('Connection issue',0,'Could not check the worker.',e.message);submit.disabled=false}),3000);
}
form.addEventListener('submit',async (event)=>{
  event.preventDefault();stopPolling();$('result').classList.add('hidden');
  if(!compressedFile){alert('Upload a reference image first.');return;}
  submit.disabled=true;activityUpdate('Preparing image',3,'Connecting to your hybrid AI worker…');
  try{
    const fd=new FormData();fd.set('reference',compressedFile);
    for(const field of ['name','role','notes','age','build','features','outfit','wardrobe','mode','generator'])fd.set(field,$(field).value);
    const resp=await api('jobs',{method:'POST',body:fd});const data=await resp.json();currentJob=data.id;
    activityUpdate('Analyzing your reference',5,'The worker is extracting visible identity and outfit details.');
    await waitForJob(currentJob);
  }catch(e){submit.disabled=false;activityUpdate('Could not start generation',0,'Check your studio connection.',e.message);}
});
$('copy-metadata').onclick=async()=>{await navigator.clipboard.writeText(JSON.stringify(extracted||{},null,2));$('copy-metadata').textContent='Copied ✓';setTimeout(()=>$('copy-metadata').textContent='Copy extracted JSON',1600)};
$('restart').onclick=()=>{stopPolling();$('result').classList.add('hidden');activity.classList.add('hidden');window.scrollTo({top:0,behavior:'smooth'})};
// Don't eagerly show a credential prompt. Status gets checked after the first user action.
$('backend-pill').addEventListener('click',ping);
