const recordingAccounts=[
  {id:'federico',name:'Federico Velásquez',initials:'FV',portfolios:[
    {id:'kiko-orator',name:'Kiko Orator',initials:'KO',purpose:'Ideas sobre emprendimiento, IA y liderazgo.',voice:'Directa y humana',audience:'Emprendedores',editing:'Impacto directo',colors:['#7350d7','#17121f','#ffe66d']},
    {id:'prisma',name:'Prisma',initials:'PR',purpose:'Estrategia, negocios y decisiones con perspectiva.',voice:'Clara y analítica',audience:'Líderes',editing:'Educativo premium',colors:['#0d7695','#102f42','#7ee6dc']},
    {id:'fede-personal',name:'Federico personal',initials:'FV',purpose:'Historias, valores y aprendizajes personales.',voice:'Cercana y reflexiva',audience:'Comunidad',editing:'Reflexión íntima',colors:['#a7516d','#321c28','#f3b8a6']},
  ]},
  {id:'studio',name:'Kiko Studio Team',initials:'KS',portfolios:[
    {id:'wired',name:'Wired',initials:'WI',purpose:'Tecnología aplicada a ventas y crecimiento.',voice:'Enérgica y práctica',audience:'Equipos comerciales',editing:'IA demostrativa',colors:['#e85249','#161b24','#f5c84b']},
    {id:'bonny',name:'Bonny Angel',initials:'BA',purpose:'Bienestar, propósito y conexiones humanas.',voice:'Cálida e inspiradora',audience:'Mujeres creadoras',editing:'Historia cinematográfica',colors:['#bd6ca1','#3f2441','#f4d7a9']},
  ]},
];

let recordingScenes=[
  {id:'s1',text:'Emprender no comienza cuando tienes una idea. Comienza cuando decides sostenerla.',shot:'Primer plano · Hook',seconds:9,status:'recorded'},
  {id:'s2',text:'La mayoría abandona porque confunde una mala semana con una mala decisión.',shot:'Plano medio · Desarrollo',seconds:12,status:'ready'},
  {id:'s3',text:'El progreso real casi nunca se siente espectacular mientras está ocurriendo.',shot:'Primer plano · Frase clave',seconds:11,status:'ready'},
  {id:'s4',text:'Si estás construyendo algo, guarda este video y vuelve a intentarlo mañana.',shot:'Plano medio · CTA',seconds:10,status:'ready'},
];

let recordingTakes=[
  {id:'t1',scene:1,label:'Toma 01',duration:'00:09',quality:'92% calidad',status:'approved'},
  {id:'t2',scene:2,label:'Toma 02',duration:'00:13',quality:'87% calidad',status:'pending'},
  {id:'t3',scene:2,label:'Toma 03',duration:'00:08',quality:'Frase incompleta',status:'repeat'},
  {id:'t4',scene:3,label:'Toma 04',duration:'00:11',quality:'Error espontáneo',status:'blooper'},
];

let activeRecordingScene=0;
let phoneDemoReady=false;
let mockRecording=false;

function recordingToast(message){if(typeof toast==='function')toast(message)}
function currentRecordingAccount(){return recordingAccounts.find(item=>item.id===$('#accountSwitch').value)||recordingAccounts[0]}
function currentRecordingPortfolio(){const account=currentRecordingAccount();return account.portfolios.find(item=>item.id===$('#portfolioSwitch').value)||account.portfolios[0]}

function populateAccountSwitch(){const savedAccount=localStorage.getItem('kiko-recording-account');$('#accountSwitch').innerHTML=recordingAccounts.map(item=>`<option value="${item.id}">${item.name}</option>`).join('');if(recordingAccounts.some(item=>item.id===savedAccount))$('#accountSwitch').value=savedAccount;populatePortfolioSwitch()}
function populatePortfolioSwitch(){const account=currentRecordingAccount();const saved=localStorage.getItem(`kiko-recording-portfolio-${account.id}`);$('#portfolioSwitch').innerHTML=account.portfolios.map(item=>`<option value="${item.id}">${item.name}</option>`).join('');if(account.portfolios.some(item=>item.id===saved))$('#portfolioSwitch').value=saved;applyPortfolioEssence()}

function applyPortfolioEssence(){const account=currentRecordingAccount();const portfolio=currentRecordingPortfolio();localStorage.setItem('kiko-recording-account',account.id);localStorage.setItem(`kiko-recording-portfolio-${account.id}`,portfolio.id);$('#accountAvatar').textContent=account.initials;$('#essenceMonogram').textContent=portfolio.initials;$('#essenceName').textContent=portfolio.name;$('#essencePurpose').textContent=portfolio.purpose;$('#essenceVoice').textContent=portfolio.voice;$('#essenceAudience').textContent=portfolio.audience;$('#essenceEditing').textContent=portfolio.editing;$('#essenceColors').innerHTML=portfolio.colors.map(color=>`<i style="background:${color}"></i>`).join('');const view=$('#recording');view.style.setProperty('--recording-accent',portfolio.colors[0]);view.style.setProperty('--recording-accent-soft',`${portfolio.colors[0]}18`);$('#accountAvatar').style.background=`linear-gradient(135deg,${portfolio.colors[0]},${portfolio.colors[1]})`;recordingToast(`${portfolio.name}: esencia aplicada a la sesión`) }

function renderRecordingScenes(){const list=$('#sceneList');list.innerHTML=recordingScenes.map((scene,index)=>`<article class="scene-item ${index===activeRecordingScene?'active':''} ${scene.status==='recorded'?'recorded':''}" data-scene="${index}"><i>${String(index+1).padStart(2,'0')}</i><div><p>${esc(scene.text)}</p><small>${esc(scene.shot)} · ${scene.seconds} s</small></div><b>${scene.status==='recorded'?'Grabada':'Lista'}</b></article>`).join('');$('#sceneCount').textContent=String(recordingScenes.length);$('#scriptDuration').textContent=`${recordingScenes.reduce((sum,scene)=>sum+scene.seconds,0)} s`;$('#activeSceneTotal').textContent=String(recordingScenes.length);$$('.scene-item').forEach(item=>item.onclick=()=>{activeRecordingScene=Number(item.dataset.scene);renderRecordingScenes();updateTeleprompter()});updateTeleprompter()}
function updateTeleprompter(){const scene=recordingScenes[activeRecordingScene]||recordingScenes[0];$('#activeSceneNumber').textContent=String(activeRecordingScene+1);$('#teleprompterText').textContent=scene?.text||'Agrega una escena al libreto.'}

function renderRecordingTakes(){const list=$('#takeReviewList');list.innerHTML=recordingTakes.map(take=>`<article class="take-card" data-take="${take.id}"><div class="take-preview"><i>▶</i><small>Escena ${take.scene} · ${take.duration}</small><b>${esc(take.quality)}</b></div><div class="take-copy"><div><h4>${esc(take.label)}</h4><small>${take.status==='pending'?'Sin revisar':take.status==='approved'?'Aprobada':take.status==='repeat'?'Repetir':'Blooper'}</small></div><p>Grabación local del celular · Vista previa</p><div class="take-actions"><button type="button" data-action="approved" class="${take.status==='approved'?'selected':''}">✓ Aprobar</button><button type="button" data-action="repeat" class="${take.status==='repeat'?'selected':''}">↻ Repetir</button><button type="button" data-action="blooper" class="${take.status==='blooper'?'selected':''}">✦ Blooper</button></div></div></article>`).join('');$$('.take-actions button').forEach(button=>button.onclick=()=>{const card=button.closest('.take-card');const take=recordingTakes.find(item=>item.id===card.dataset.take);take.status=button.dataset.action;renderRecordingTakes();recordingToast(button.dataset.action==='approved'?'Toma aprobada para edición':button.dataset.action==='blooper'?'Toma guardada en Bloopers':'Toma marcada para repetir')});updateRecordingCounts()}
function updateRecordingCounts(){const count=status=>recordingTakes.filter(take=>take.status===status).length;$('#approvedCount').textContent=String(count('approved'));$('#repeatCount').textContent=String(count('repeat'));$('#blooperCount').textContent=String(count('blooper'));const pending=count('pending');$('#reviewCounter').textContent=pending?`${pending} sin revisar`:'Todo revisado'}

$('#accountSwitch').onchange=populatePortfolioSwitch;
$('#portfolioSwitch').onchange=applyPortfolioEssence;

$('#pairPhone').onclick=()=>{phoneDemoReady=!phoneDemoReady;$('#phoneLinkStatus').textContent=phoneDemoReady?'Demo preparada':'Sin conectar';$('#phoneLinkStatus').classList.toggle('warning',!phoneDemoReady);$('#cameraConnection').textContent=phoneDemoReady?'Vista simulada':'Offline';$('#cameraConnection').classList.toggle('camera-offline',!phoneDemoReady);$('#pairPhone').textContent=phoneDemoReady?'Ocultar código QR':'Mostrar código QR';$('#cameraNoticeTitle').textContent=phoneDemoReady?'Flujo del celular listo para validar':'Conecta el celular para comenzar';$('#cameraNoticeText').textContent=phoneDemoReady?'Esta es una simulación visual; la conexión real se implementará después de aprobar el diseño.':'La cámara real se habilitará en la siguiente fase funcional.';recordingToast(phoneDemoReady?'Prototipo de vinculación activado':'Prototipo de vinculación cerrado')};

$('#recordButton').onclick=()=>{if(!phoneDemoReady){recordingToast('Primero muestra el QR para activar la simulación del celular');return}mockRecording=!mockRecording;$('#recordButton').classList.toggle('recording',mockRecording);$('#phonePreview').classList.toggle('is-recording',mockRecording);$('#cameraNoticeTitle').textContent=mockRecording?'Grabando toma simulada…':'Toma simulada lista para revisar';if(!mockRecording){const scene=recordingScenes[activeRecordingScene];scene.status='recorded';recordingTakes.unshift({id:`t${Date.now()}`,scene:activeRecordingScene+1,label:`Toma ${String(recordingTakes.length+1).padStart(2,'0')}`,duration:`00:${String(scene.seconds).padStart(2,'0')}`,quality:'Pendiente de revisar',status:'pending'});renderRecordingScenes();renderRecordingTakes();recordingToast('Toma simulada agregada a la bandeja de revisión')}};

$('#addScene').onclick=()=>{recordingScenes.push({id:`s${Date.now()}`,text:'Nueva escena: escribe aquí la siguiente idea del libreto.',shot:'Plano medio · Nueva escena',seconds:10,status:'ready'});activeRecordingScene=recordingScenes.length-1;renderRecordingScenes();recordingToast('Escena visual agregada al libreto')};

$('#newRecordingSession').onclick=()=>{activeRecordingScene=0;recordingTakes=recordingTakes.map((take,index)=>({...take,status:index===0?'approved':'pending'}));renderRecordingScenes();renderRecordingTakes();recordingToast('Nueva sesión visual preparada')};
$('#editSchedule').onclick=()=>{$('#sessionDay').textContent='VIE 30';$('#sessionTime').textContent='10:00 a. m.';recordingToast('Programación de muestra actualizada')};
$('#sendApprovedToEdit').onclick=()=>recordingToast('Prototipo visual: en la fase funcional se enviarán solo las tomas aprobadas al montaje');

populateAccountSwitch();
renderRecordingScenes();
renderRecordingTakes();
