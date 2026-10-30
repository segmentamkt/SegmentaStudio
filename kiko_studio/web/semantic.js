// Editor semántico: tomas + libreto → plan en segundo plano → revisión (cortes, gráficos, vista previa) → render.
// Usa $, $$, api, esc, toast, dashboard, projectOptions y refresh de app.js.
let semantic={id:null,plan:null,segmentos:[],agregar:[],ajustes:{},quitar:new Set(),textos:{},montaje:null};
let semanticSelected=[];             // tomas marcadas, en el orden en que se marcaron (el libreto decide el orden final)
let semanticProject=null;            // proyecto cuyos recursos y marca están cargados
let semanticAssets=[];
let semanticImages=[];               // propuestas generadas con IA (se guardan en recursos solo si las apruebas)
let semanticMissing=[];              // imágenes que pide el libreto y todavía no están en los recursos
let semanticImageTimer=null;
let semanticImagePrefsSet=false;     // el generador toma su IA y estilo de la skill una sola vez (luego mandas tú)
let semanticProgressFor=null;        // edición que muestra la barra de progreso
const semanticChecks=new Map();      // video_id → revisión de formato y audio
const semanticPollers=new Map();     // edit_id → temporizador del seguimiento en segundo plano
const semanticBusy=new Set(['planning','previewing','rendering']);
const semanticStageNames={queued:'En espera',transcribing:'Escuchando las tomas',analyzing:'Comparando con el libreto',planning:'Revisión con IA',audio:'Limpiando la voz',assets:'Efectos y música',rendering:'Renderizando',verifying:'Control de calidad',complete:'Terminado',failed:'Detenido'};
const semanticStatusNames={planning:'Planificando',planned:'Plan listo para revisar',previewing:'Preparando la vista previa',rendering:'Renderizando',ready:'Video listo',failed:'Error'};
const semanticQcNames={'1080x1920_30fps':'1080×1920 a 30 fps',duracion:'Duración exacta',loudness:'Voz a −14 LUFS',pico_real:'Pico de audio seguro',efectos_a_2_fotogramas_de_su_palabra:'Efectos sincronizados con su palabra',subtitulos_sin_cortes_sintacticos:'Subtítulos bien cortados',subtitulos_no_tapan_rostro:'Subtítulos sin tapar la cara'};
const semanticFuenteNames={libreto:'pedido en el libreto',usuario:'agregado por ti',local:'detectado por Kiko',ia:'propuesto por la IA'};
const semanticKindNames={image:'Imagen',logo:'Logo',sound:'Sonido',music:'Música'};
const semanticAccept={image:'.png,.jpg,.jpeg,.webp',logo:'.png,.jpg,.jpeg,.webp',sound:'.wav,.mp3,.m4a,.aiff,.aif',music:'.mp3,.m4a,.wav,.aiff,.aif'};
// Zonas que tapa la interfaz de cada red (aproximadas, en píxeles de un video 1080×1920).
const semanticZones={tiktok:{nombre:'TikTok',top:130,bottom:370,right:140,left:60},reels:{nombre:'Reels',top:220,bottom:420,right:120,left:60},shorts:{nombre:'Shorts',top:190,bottom:380,right:130,left:60}};
const seconds=t=>`${Number(t).toFixed(1).replace('.',',')} s`;
const postJson=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
// Igual que planificador.clave_recurso: «Biblia_Antigua.png», «biblia-antigua» y «bibliaantigua» son el mismo recurso.
const semanticKey=nombre=>nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\.[a-z0-9]+$/,'').replace(/[^a-z0-9]/g,'');

// --- Progreso y avisos ------------------------------------------------------------------------

function setSemanticProgress({percent=0,stage='queued',message='',status='running'}){const box=$('#semanticProgress');const value=Math.max(0,Math.min(100,Math.round(Number(percent)||0)));box.querySelector('.semantic-percent').textContent=`${value}%`;box.querySelector('.semantic-stage').textContent=semanticStageNames[stage]||stage;box.querySelector('.semantic-message').textContent=message||'Procesando…';box.querySelector('.semantic-fill').style.width=`${value}%`;box.querySelector('[role="progressbar"]').setAttribute('aria-valuenow',String(value));box.classList.toggle('working',status==='running');box.classList.toggle('complete',status==='complete');box.classList.toggle('failed',status==='failed')}
function semanticAskNotifications(){if('Notification' in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{})}
function semanticNotify(title,body){toast(`${title}. ${body}`);if('Notification' in window&&Notification.permission==='granted'&&(document.hidden||!document.hasFocus())){try{new Notification(`Kiko Studio · ${title}`,{body})}catch{}}}

// Sigue una edición en segundo plano hasta que termine el paso en curso (también al volver a abrir el panel).
function watchSemantic(id,desde){if(semanticPollers.has(id))return;if(!semanticProgressFor)semanticProgressFor=id;
  const tick=async()=>{try{
    if(semanticProgressFor===id){const progress=await api(`/api/edits/progress?id=${encodeURIComponent(id)}`);if(progress.status==='running')setSemanticProgress(progress)}
    const item=await api(`/api/semantic/plan?id=${encodeURIComponent(id)}`);
    if(semanticBusy.has(item.status))return;
    clearInterval(semanticPollers.get(id));semanticPollers.delete(id);finishSemantic(item,desde)}catch{}};
  semanticPollers.set(id,setInterval(tick,1500));tick()}
function finishSemantic(item,desde){
  const avisos={planning:['Plan listo para revisar','Revísalo y mira la vista previa; todavía no se ha renderizado nada.'],previewing:['Vista previa lista','Mírala antes de aprobar el render completo.'],rendering:['Video listo','Renderizado y verificado; ya puedes descargarlo.']};
  const propia=semanticProgressFor===item.id;
  if(item.status==='failed'){if(propia)setSemanticProgress({percent:0,stage:'failed',message:item.error||'',status:'failed'});semanticNotify('La edición se detuvo',item.error||item.name)}
  else{const [titulo,detalle]=avisos[desde]||['Listo',''];if(propia)setSemanticProgress({percent:100,stage:'complete',message:detalle,status:'complete'});semanticNotify(titulo,`${item.name}: ${detalle}`)}
  if(propia)semanticProgressFor=null;
  if(!semantic.id||semantic.id===item.id)openSemantic(item,desde==='planning');
  refresh()}

// --- Proyecto, tomas y libreto ------------------------------------------------------------------

window.renderSemantic=function(){const info=dashboard.semantic_editor||{};const status=$('#semanticStatus');status.textContent=info.ready?'Remotion listo':info.detail||'Sin comprobar';status.className=`status ${info.ready?'ready':'failed'}`;
  const select=$('#semanticProject');const current=select.value;select.innerHTML=projectOptions();if(current&&[...select.options].some(o=>o.value===current))select.value=current;
  renderSemanticTakes();renderSemanticHistory();if(select.value&&select.value!==semanticProject)loadSemanticProject(select.value);
  (dashboard.semantic_edits||[]).filter(e=>semanticBusy.has(e.status)).forEach(e=>watchSemantic(e.id,e.status))};

function semanticVideos(){return dashboard.videos.filter(v=>v.project_id===$('#semanticProject').value).sort((a,b)=>a.original_name.localeCompare(b.original_name,undefined,{numeric:true}))}
function semanticCheckHtml(id){const r=semanticChecks.get(id);if(!r)return '';if(r==='cargando')return '<small class="semantic-checking">Revisando formato y audio…</small>';if(r.error)return `<small class="bad">${esc(r.error)}</small>`;const avisos=(r.revision||[]).filter(x=>x.nivel!=='ok');return avisos.length?`<ul class="semantic-check-list">${avisos.map(x=>`<li class="${esc(x.nivel)}">${esc(x.mensaje)}</li>`).join('')}</ul>`:'<small class="ok">✓ Formato, audio y silencio inicial correctos</small>'}
function renderSemanticTakes(){const items=semanticVideos();const ids=new Set(items.map(v=>v.id));semanticSelected=semanticSelected.filter(id=>ids.has(id));
  $('#semanticTakes').innerHTML=items.length?items.map(v=>{const on=semanticSelected.includes(v.id);return `<div class="semantic-take ${on?'on':''}"><label><input type="checkbox" data-id="${esc(v.id)}" ${on?'checked':''}><span>${esc(v.original_name)}</span></label>${on?semanticCheckHtml(v.id):''}</div>`}).join(''):'<div class="empty">No hay tomas en este proyecto; súbelas aquí abajo.</div>';
  $$('#semanticTakes input').forEach(input=>input.onchange=()=>{const id=input.dataset.id;semanticSelected=input.checked?[...semanticSelected,id]:semanticSelected.filter(x=>x!==id);renderSemanticTakes();if(input.checked)checkSemanticTake(id)})}
async function checkSemanticTake(id){if(semanticChecks.has(id))return;semanticChecks.set(id,'cargando');renderSemanticTakes();try{semanticChecks.set(id,await api(`/api/semantic/check?video_id=${encodeURIComponent(id)}`))}catch(e){semanticChecks.set(id,{error:e.message})}renderSemanticTakes()}

function semanticLibretoStats(){const lineas=$('#semanticLibreto').value.split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#'));const indicaciones=lineas.reduce((n,l)=>n+(l.match(/\[[^\]]+\]/g)||[]).length,0);const palabras=lineas.join(' ').replace(/\[[^\]]*\]/g,' ').split(/\s+/).filter(Boolean).length;return {lineas:lineas.length,indicaciones,palabras}}
function updateSemanticLibreto(){renderSemanticMissing();const s=semanticLibretoStats();$('#semanticLibretoCount').textContent=`${s.palabras} palabras · ${s.lineas} líneas · ${s.indicaciones} indicaciones`;$('#semanticLibretoCount').classList.toggle('bad',s.palabras>0&&s.palabras<5);try{localStorage.setItem(`kiko-libreto-${$('#semanticProject').value}`,$('#semanticLibreto').value)}catch{}}
function restoreSemanticLibreto(){let guardado='',objetivo='';try{guardado=localStorage.getItem(`kiko-libreto-${$('#semanticProject').value}`)||'';objetivo=localStorage.getItem(`kiko-objetivo-${$('#semanticProject').value}`)||''}catch{}$('#semanticLibreto').value=guardado;$('#semanticObjetivo').value=objetivo;updateSemanticLibreto()}
function insertSemanticDirective(texto){const area=$('#semanticLibreto');const fin=area.selectionEnd??area.value.length;const antes=area.value.slice(0,fin);const espacio=antes&&!/\s$/.test(antes)?' ':'';area.value=`${antes}${espacio}${texto}${area.value.slice(fin)}`;area.focus();area.selectionStart=area.selectionEnd=fin+espacio.length+texto.length;updateSemanticLibreto()}

// --- Recursos y marca ---------------------------------------------------------------------------

async function loadSemanticProject(projectId){semanticProject=projectId;restoreSemanticLibreto();loadSemanticImages(projectId);try{const [assets,marca]=await Promise.all([api(`/api/assets?project_id=${encodeURIComponent(projectId)}`),api(`/api/semantic/brand?project_id=${encodeURIComponent(projectId)}`)]);if(semanticProject!==projectId)return;semanticAssets=assets.items||[];renderSemanticAssets();fillSemanticBrand(marca)}catch(e){toast(e.message)}}
function semanticDirective(a){return a.kind==='image'?`[IMAGEN ${a.name}]`:a.kind==='sound'?`[SONIDO ${a.name}]`:''}
function renderSemanticAssets(){$('#semanticAssetCount').textContent=String(semanticAssets.length);
  $('#semanticAssets').innerHTML=semanticAssets.length?semanticAssets.map(a=>{const directiva=semanticDirective(a);return `<div class="semantic-asset"><span class="semantic-kind ${esc(a.kind)}">${esc(semanticKindNames[a.kind]||a.kind)}</span><div><strong>${esc(a.name)}</strong><small>${a.license?esc(a.license):'<span class="bad">Sin licencia registrada</span>'}</small></div>${directiva?`<button type="button" class="quiet semantic-insert" data-directiva="${esc(directiva)}" title="Insertar en el libreto donde está el cursor">${esc(directiva)}</button>`:`<small class="muted">${a.kind==='logo'?'Úsalo en la plantilla de marca':'Música de fondo del video'}</small>`}</div>`}).join(''):'<div class="empty">Todavía no hay recursos. Sube imágenes, sonidos, música o tu logo.</div>';
  $$('.semantic-insert').forEach(button=>button.onclick=()=>insertSemanticDirective(button.dataset.directiva));
  renderSemanticMissing();const logo=$('#semanticBrandLogo');const actual=logo.value;logo.innerHTML='<option value="">Sin logo</option>'+semanticAssets.filter(a=>a.kind==='logo').map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('');logo.value=actual&&[...logo.options].some(o=>o.value===actual)?actual:''}
function fillSemanticBrand(m){$('#semanticColorMorado').value=m.colores.morado;$('#semanticColorVioleta').value=m.colores.violeta;$('#semanticColorAmarillo').value=m.colores.amarillo;$('#semanticBrandLogo').value=m.logo_asset_id&&[...$('#semanticBrandLogo').options].some(o=>o.value===m.logo_asset_id)?m.logo_asset_id:'';$('#semanticBrandWatermark').checked=m.marca_de_agua;$('#semanticBrandClosing').value=m.cierre.texto||'';const duracion=$('#semanticBrandClosingSeconds');const valor=String(m.cierre.duracion);if(![...duracion.options].some(o=>o.value===valor))duracion.insertAdjacentHTML('beforeend',`<option value="${esc(valor)}">${esc(valor.replace('.',','))} s</option>`);duracion.value=valor}

// --- Imágenes generadas con IA ------------------------------------------------------------------

async function loadSemanticImages(projectId){clearTimeout(semanticImageTimer);
  try{const r=await api(`/api/images?project_id=${encodeURIComponent(projectId)}`);if(projectId!==$('#semanticProject').value)return;
    const antes=new Map(semanticImages.map(i=>[i.id,i.status]));semanticImages=r.items||[];
    semanticImages.forEach(i=>{if(antes.get(i.id)==='generating'&&i.status!=='generating')semanticNotify(i.status==='ready'?'Imagen lista':'La imagen no se pudo generar',i.status==='ready'?`«${i.nombre}» con ${i.proveedor}: revísala y guárdala en tus recursos.`:i.error||i.nombre)});
    const disponibles=(r.proveedores||[]).filter(p=>p.disponible);const estado=$('#semanticImageProviders');estado.textContent=disponibles.length?disponibles.map(p=>p.nombre.split(' ')[0]).join(' · '):'Sin IA de imágenes';estado.className=`status ${disponibles.length?'ready':'failed'}`;
    [...$('#semanticImageProvider').options].forEach(o=>{if(o.value==='ambas')o.disabled=disponibles.length<2;else if(o.value!=='auto')o.disabled=!disponibles.some(p=>p.id===o.value)});
    renderSemanticImages();renderSemanticMissing();
    if(semanticImages.some(i=>i.status==='generating'))semanticImageTimer=setTimeout(()=>loadSemanticImages(projectId),4000)}
  catch(e){toast(e.message)}}
function renderSemanticImages(){$('#semanticImages').innerHTML=semanticImages.map(i=>`<div class="semantic-image ${esc(i.status)}" data-id="${esc(i.id)}"><div class="semantic-image-frame">${i.status==='ready'?`<a href="${esc(i.url)}" target="_blank" title="Ver en grande"><img src="${esc(i.url)}" alt="${esc(i.descripcion)}"></a>`:i.status==='generating'?'<span class="semantic-spinner"></span><small>Generando…</small>':'<small class="bad">No se generó</small>'}</div>
  <div class="semantic-image-info"><strong>${esc(i.nombre)}</strong><small>${esc(i.proveedor)}${i.width?` · ${i.width}×${i.height}`:''}</small><small class="muted">${esc(i.descripcion)}</small>${i.error?`<small class="bad">${esc(i.error)}</small>`:''}
  ${i.status==='ready'?`<div class="semantic-image-actions"><input class="semantic-image-name" value="${esc(i.nombre)}" aria-label="Nombre del recurso"><button type="button" class="primary" data-op="save">Guardar en recursos</button><button type="button" class="quiet" data-op="again">Otra versión</button><button type="button" class="danger-quiet" data-op="discard">Descartar</button></div>`:i.status==='failed'?'<div class="semantic-image-actions"><button type="button" class="quiet" data-op="again">Reintentar</button><button type="button" class="danger-quiet" data-op="discard">Quitar</button></div>':''}</div></div>`).join('');
  $$('.semantic-image [data-op]').forEach(button=>button.onclick=()=>semanticImageAction(button.closest('.semantic-image').dataset.id,button.dataset.op,button))}
async function semanticImageAction(id,op,button){const projectId=$('#semanticProject').value;button.disabled=true;
  try{if(op==='save'){const recurso=await postJson('/api/images/save',{id,nombre:button.parentElement.querySelector('.semantic-image-name').value});toast(`«${recurso.name}» guardada en tus recursos; pídela en el libreto con [IMAGEN ${recurso.name}]`);await loadSemanticProject(projectId)}
    else{await postJson(op==='again'?'/api/images/again':'/api/images/discard',{id});await loadSemanticImages(projectId)}}
  catch(e){toast(e.message);button.disabled=false}}
async function generateSemanticImage({descripcion,nombre,contexto=''}){semanticAskNotifications();
  const r=await postJson('/api/images/generate',{project_id:$('#semanticProject').value,descripcion,nombre,contexto,estilo:$('#semanticImageStyle').value,proveedor:$('#semanticImageProvider').value});
  toast(r.items.length>1?`Generando dos versiones de «${r.items[0].nombre}» (ChatGPT y Gemini); te aviso cuando estén`:`Generando «${r.items[0].nombre}» con ${r.items[0].proveedor}; te aviso cuando esté`);await loadSemanticImages($('#semanticProject').value)}

// [IMAGEN nombre] o [IMAGEN nombre "descripción"] del libreto que todavía no están en los recursos.
function semanticLibretoImages(){const salida=[];$('#semanticLibreto').value.split('\n').forEach(renglon=>{const linea=renglon.trim();if(!linea||linea.startsWith('#'))return;const texto=linea.replace(/\[[^\]]*\]/g,' ').replace(/\s+/g,' ').trim();for(const m of linea.matchAll(/\[\s*imagen\s+([^\s\]"“«]+)(?:\s+["“«]([^\]"”»]+)["”»]?)?\s*\]/gi))salida.push({nombre:m[1],descripcion:(m[2]||'').trim(),linea:texto})});return salida}
function renderSemanticMissing(){const box=$('#semanticMissingImages');const tengo=new Set(semanticAssets.filter(a=>['image','logo'].includes(a.kind)).map(a=>semanticKey(a.name)));const propuestas=new Map(semanticImages.map(i=>[semanticKey(i.nombre),i.status]));
  semanticMissing=semanticLibretoImages().filter((x,k,todas)=>!tengo.has(semanticKey(x.nombre))&&todas.findIndex(y=>semanticKey(y.nombre)===semanticKey(x.nombre))===k);box.hidden=!semanticMissing.length;if(!semanticMissing.length){box.innerHTML='';return}
  const sinPropuesta=semanticMissing.filter(x=>!['generating','ready'].includes(propuestas.get(semanticKey(x.nombre))));
  box.innerHTML=`<strong>${semanticMissing.length===1?'Falta 1 imagen':`Faltan ${semanticMissing.length} imágenes`} del libreto</strong>${semanticMissing.map((x,k)=>{const estado=propuestas.get(semanticKey(x.nombre));return `<div class="semantic-missing-row"><code>${esc(x.nombre)}</code><small>${esc(x.descripcion||x.linea)}</small>${estado==='generating'?'<span class="status processing">Generando…</span>':estado==='ready'?'<span class="status ready">Lista para aprobar</span>':`<button type="button" class="quiet" data-k="${k}">Generar con IA</button>`}</div>`}).join('')}${sinPropuesta.length>1?`<button type="button" class="quiet" id="semanticGenerateAll">Generar las ${sinPropuesta.length} con IA</button>`:''}<small>Súbelas con ese nombre o genéralas: cada propuesta aparece en «Generar imagen con IA» para que la apruebes.</small>`;
  const generar=async(x,button)=>{if(button)button.disabled=true;try{await generateSemanticImage({descripcion:x.descripcion||x.linea,nombre:x.nombre,contexto:x.linea})}catch(e){toast(e.message);if(button)button.disabled=false}};
  box.querySelectorAll('[data-k]').forEach(button=>button.onclick=()=>generar(semanticMissing[Number(button.dataset.k)],button));
  const todas=box.querySelector('#semanticGenerateAll');if(todas)todas.onclick=async()=>{todas.disabled=true;for(const x of sinPropuesta)await generar(x)}}

// --- Skills en el editor (las carga skills.js) -------------------------------------------------

const semanticSkillsLista=()=>typeof kikoSkills!=='undefined'?kikoSkills:[];
const semanticSkillIcon=id=>(semanticSkillsLista().find(s=>s.id===id)||{icono:'•'}).icono;
window.renderSemanticSkills=function(){const lista=semanticSkillsLista();const box=$('#semanticSkillsStrip');if(!lista.length)return;const director=lista.find(s=>s.id==='director');const resto=lista.filter(s=>s.id!=='director');
  box.innerHTML=`<span class="${director?.activa?'':'off'}">${director?.activa?'🧠 El Director recomendará skills para este objetivo':'🧠 Director apagado: no habrá recomendaciones'}</span>${resto.map(s=>`<span class="${s.activa?'':'off'}" title="${esc(s.nombre)}${s.activa?'':' (apagada)'}">${s.icono}</span>`).join('')}<button type="button" class="quiet" id="semanticGoSkills">Configurar skills</button>`;
  $('#semanticGoSkills').onclick=()=>showView('skills');
  const generador=lista.find(s=>s.id==='generador');if(!generador)return;
  if(!semanticImagePrefsSet){$('#semanticImageProvider').value=generador.ajustes.proveedor;$('#semanticImageStyle').value=generador.ajustes.estilo;semanticImagePrefsSet=true}
  const boton=$('#semanticImageForm button[type="submit"]');boton.disabled=!generador.activa;boton.textContent=generador.activa?'Generar imagen':'Generador desactivado en Skills'};

function semanticDirectorHtml(p){const d=p.director;
  if(!d)return `<section class="semantic-block"><div class="semantic-block-head"><h4>🧠 Director</h4></div><p class="muted">El Director estaba apagado al planificar esta edición. Actívalo en Skills y vuelve a planificar para recibir recomendaciones.</p></section>`;
  const aplicadas=new Set(d.aplicadas||[]);const hechos=d.hechos||{};
  const filas=d.recomendaciones.map((r,k)=>{const hecha=aplicadas.has(r.skill);return `<label class="director-rec ${r.usar?'':'no'}"><input type="checkbox" data-rec="${k}" ${r.cambia&&!hecha?'checked':''} ${!r.cambia||hecha?'disabled':''}><span class="skill-icon">${semanticSkillIcon(r.skill)}</span><span><strong>${esc(r.nombre)}</strong> <em class="status ${r.usar?'ready':'failed'}">${r.usar?'Usar':'No usar'}</em>${hecha?' <em class="status">Aplicada</em>':!r.cambia?' <em class="status">Ya está así</em>':''}<small>${esc(r.motivo)}</small>${r.resumen_ajustes.length?`<span class="edit-badges">${r.resumen_ajustes.map(t=>`<span>${esc(t)}</span>`).join('')}</span>`:''}</span></label>`}).join('');
  return `<section class="semantic-block director-block"><div class="semantic-block-head"><h4>🧠 Recomendación del Director</h4><span class="status ${d.fuente==='local'?'':'ready'}">${d.fuente==='local'?'Reglas locales (sin IA)':`IA: ${esc(d.fuente.replace('ia:','').replace('-cli',''))}`}</span></div>
  ${d.objetivo?`<p><strong>Tu objetivo:</strong> «${esc(d.objetivo)}»${d.objetivo_entendido?`<br><small class="muted">Lo entendió así: ${esc(d.objetivo_entendido)}</small>`:''}</p>`:'<p class="muted">No indicaste un objetivo: el Director lo dedujo del contenido.</p>'}
  <p>${esc(d.resumen)}</p><div class="actions"><button type="button" class="quiet" data-skill-chat="director">💬 Conversar con el Director sobre este video</button></div>${(hechos.observaciones||[]).length?`<div class="director-facts"><span>Lo que midió:</span>${hechos.observaciones.map(o=>`<span>${esc(o)}</span>`).join('')}</div>`:''}
  <div class="director-recs">${filas||'<div class="empty">No tiene recomendaciones para esta toma.</div>'}</div>
  ${d.recomendaciones.some(r=>r.cambia&&!aplicadas.has(r.skill))?`<div class="actions"><button type="button" class="primary" id="semanticApplyDirector" ${semanticBusy.has(p.status)?'disabled':''}>Aplicar las seleccionadas</button><button type="button" class="quiet" id="semanticOpenSkills">Ver skills</button></div>`:''}</section>`}
function semanticEditionSkillsHtml(p){const lista=(p.skills||[]).filter(s=>s.id!=='director');if(!lista.length)return '';
  return `<section class="semantic-block"><div class="semantic-block-head"><h4>Skills de esta edición</h4><button type="button" class="quiet" id="semanticSkillsRefresh" ${semanticBusy.has(p.status)?'disabled':''}>Usar la configuración actual de las skills</button></div><p class="fine">Toca una skill para conversar con ella sobre este video y pedirle cambios.</p><div class="edition-skills">${lista.map(s=>`<button type="button" data-skill-chat="${esc(s.id)}" class="${s.activa?'':'off'}" title="Conversar con ${esc(s.nombre)} · ${esc(s.detalles.join(' · ')||'Ajustes por defecto')}">${semanticSkillIcon(s.id)} ${esc(s.nombre)}${s.activa?(s.detalles.length?` · ${esc(s.detalles.slice(0,2).join(', '))}${s.detalles.length>2?'…':''}`:''):' · apagada'}</button>`).join('')}</div></section>`}
async function applyDirectorRecommendations(){const d=semantic.plan.director;const elegidas=[...$$('.director-rec input:checked')].map(i=>d.recomendaciones[Number(i.dataset.rec)]);if(!elegidas.length)return toast('Marca al menos una recomendación');
  const button=$('#semanticApplyDirector');button.disabled=true;button.textContent='Aplicando…';
  try{const cambios={...semanticChanges(),skills:Object.fromEntries(elegidas.map(r=>[r.skill,{activa:r.usar,ajustes:r.ajustes}])),recomendaciones_aplicadas:elegidas.map(r=>r.skill)};
    openSemantic(await postJson('/api/semantic/edit',{id:semantic.id,cambios}),false);toast(`${elegidas.length===1?'Recomendación aplicada':`${elegidas.length} recomendaciones aplicadas`} a esta edición; mira la vista previa`)}
  catch(e){toast(e.message);button.disabled=false;button.textContent='Aplicar las seleccionadas'}}

// --- Historial y plan ---------------------------------------------------------------------------

function renderSemanticHistory(){const items=dashboard.semantic_edits||[];$('#semanticHistory').innerHTML=items.length?items.map(item=>`<div class="provider"><span><strong>${esc(item.name)}</strong><small>${esc(semanticStatusNames[item.status]||item.status)}${item.error?` · ${esc(item.error)}`:''}</small></span><button type="button" class="quiet semantic-open" data-id="${esc(item.id)}">${item.status==='ready'?'Ver video':'Ver plan'}</button></div>`).join(''):'<div class="empty">Todavía no hay ediciones semánticas.</div>';$$('.semantic-open').forEach(button=>button.onclick=()=>loadSemantic(button.dataset.id))}
async function loadSemantic(id){try{const plan=await api(`/api/semantic/plan?id=${encodeURIComponent(id)}`);openSemantic(plan,true);if(semanticBusy.has(plan.status))watchSemantic(id,plan.status)}catch(e){toast(e.message)}}
function openSemantic(plan,scroll){semantic={id:plan.id,plan,segmentos:(plan.montaje?.segmentos||[]).map(s=>[s.desde_i,s.hasta_i]),agregar:[],ajustes:{},quitar:new Set(),textos:{},montaje:null};renderSemanticPlan();if(scroll)$('#semanticPlan').scrollIntoView({behavior:'smooth',block:'start'})}

function semanticLibretoHtml(g){if(!g)return '<p class="warning-note">Esta edición se planificó sin libreto: los cortes y gráficos son menos fiables.</p>';const pct=Math.round(g.cobertura*100);
  return `<section class="semantic-block"><div class="semantic-block-head"><h4>Libreto</h4><span class="status ${pct>=90?'ready':pct>=70?'processing':'failed'}">${pct}% dicho en las tomas</span></div><div class="semantic-meter"><span style="width:${pct}%"></span></div>
  ${g.faltan.length?`<div class="warning-note"><strong>No encontré ${g.faltan.length===1?'esta línea':'estas líneas'} en las tomas</strong>${g.faltan.map(f=>`<p>Línea ${f.n+1}: «${esc(f.texto)}»</p>`).join('')}<small>Si la dijiste con otras palabras, corrige el libreto y vuelve a planificar; si no la grabaste, el video sigue sin ella.</small></div>`:''}
  ${g.repetidas.length?`<p class="muted">Repetiste ${g.repetidas.length===1?'una línea':`${g.repetidas.length} líneas`}; se usa la última versión completa (${g.repetidas.map(r=>`línea ${r.n+1}: ${r.veces} veces`).join(', ')}).</p>`:''}
  ${g.fuera_del_libreto.length?`<details class="research-notes"><summary>Dicho fuera del libreto (${g.fuera_del_libreto.length}): queda fuera del montaje</summary>${g.fuera_del_libreto.map(f=>`<p>${seconds(f.desde)} · «${esc(f.texto)}»</p>`).join('')}</details>`:''}
  ${g.avisos.length?`<div class="warning-note">${g.avisos.map(a=>`<p>${esc(a)}</p>`).join('')}</div>`:''}</section>`}

function semanticTimelineHtml(p){const d=p.duracion||1;const pct=t=>`${Math.max(0,Math.min(100,t/d*100)).toFixed(2)}%`;const filas=[];
  const eventos=[...(p.eventos||[])].sort((a,b)=>a.inicio-b.inicio).map(e=>{let fila=filas.findIndex(fin=>fin<=e.inicio);if(fila<0){fila=filas.length;filas.push(0)}filas[fila]=e.fin+0.1;return {...e,fila}});
  const marcas=Array.from({length:Math.floor(d/5)+1},(_,i)=>i*5).map(t=>`<span style="left:${pct(t)}">${t} s</span>`).join('');
  const tramos=(p.montaje?.tramos||[]).map(t=>`<span class="toma-${(t.toma-1)%4}" style="left:${pct(t.salida)};width:${pct(t.hasta-t.desde)}" title="Toma ${t.toma}: ${esc(t.texto)}"></span>`).join('');
  return `<section class="semantic-block"><div class="semantic-block-head"><h4>Línea de tiempo</h4><small class="muted">${seconds(d)} · los colores de abajo son las tomas; toca un gráfico para editarlo</small></div>
  <div class="semantic-timeline" style="--filas:${Math.max(1,filas.length)}"><div class="semantic-ticks">${marcas}</div><div class="semantic-lane-events">${eventos.map(e=>`<button type="button" class="semantic-tl-event ${esc(e.componente)}" data-id="${esc(e.id)}" style="left:${pct(e.inicio)};width:${pct(Math.max(e.fin-e.inicio,0.35))};top:calc(${e.fila} * 30px)" title="${esc(e.nombre)} · «${esc(e.dice)}»">${esc(e.nombre.split(' · ')[0])}</button>`).join('')}</div><div class="semantic-lane-takes">${tramos}</div></div></section>`}

function semanticPlayerHtml(src,id){return `<div class="semantic-player" id="${id}"><video controls preload="metadata" playsinline src="${esc(src)}"></video><div class="semantic-safe" hidden></div></div><div class="semantic-zone-buttons" data-player="${id}"><span>Zonas seguras:</span><button type="button" class="on" data-zone="">Ninguna</button>${Object.entries(semanticZones).map(([k,z])=>`<button type="button" data-zone="${k}">${z.nombre}</button>`).join('')}</div>`}
function showSemanticZone(playerId,zona){const capa=$(`#${playerId} .semantic-safe`);const z=semanticZones[zona];capa.hidden=!z;if(z)capa.innerHTML=`<i style="top:0;left:0;right:0;height:${z.top/19.2}%"></i><i style="bottom:0;left:0;right:0;height:${z.bottom/19.2}%"></i><i style="top:${z.top/19.2}%;bottom:${z.bottom/19.2}%;right:0;width:${z.right/10.8}%"></i><i style="top:${z.top/19.2}%;bottom:${z.bottom/19.2}%;left:0;width:${z.left/10.8}%"></i><b>${esc(z.nombre)}: lo importante va en la zona clara</b>`}

// Montaje: tramos de las tomas originales; cada borde se mueve palabra a palabra y se escucha desde el original.
function semanticRangeText(a,b){const w=semantic.plan.palabras_fuente;const palabras=w.slice(a,b+1).map(x=>x[0]);return palabras.length>16?`${palabras.slice(0,7).join(' ')} … ${palabras.slice(-7).join(' ')}`:palabras.join(' ')}
function semanticMontajeHtml(p){const w=p.palabras_fuente||[];const segs=semantic.segmentos;if(!w.length||!segs.length)return '';const editado=JSON.stringify(segs)!==JSON.stringify((p.montaje.segmentos||[]).map(s=>[s.desde_i,s.hasta_i]));
  const filas=segs.map(([a,b],k)=>`<div class="semantic-seg" data-k="${k}"><span class="semantic-seg-n">${k+1}</span><div><strong>Toma ${w[a][3]+1}</strong> <small>${seconds(w[a][1])}–${seconds(w[b][2])} del original</small><p>«${esc(semanticRangeText(a,b))}»</p></div><div class="semantic-seg-tools"><span>Empieza</span><button type="button" data-op="a-" title="Una palabra antes">−</button><button type="button" data-op="a+" title="Una palabra después">+</button><span>Termina</span><button type="button" data-op="b-" title="Una palabra antes">−</button><button type="button" data-op="b+" title="Una palabra después">+</button><button type="button" class="quiet" data-op="play">▶ Escuchar</button>${segs.length>1?'<button type="button" class="danger-quiet" data-op="del" title="Quitar este tramo">Quitar</button>':''}</div></div>${k<segs.length-1?`<button type="button" class="semantic-join" data-k="${k}">▶ Escuchar el corte ${k+1} → ${k+2}</button>`:''}`).join('');
  return `<section class="semantic-block"><div class="semantic-block-head"><h4>Montaje · ${segs.length} ${segs.length===1?'tramo':'tramos'}</h4>${editado?'<span class="status processing">Cortes sin aplicar</span>':`<small class="muted">${p.montaje.eleccion==='libreto'?'Ordenado por el libreto':p.montaje.eleccion==='manual'?'Ajustado por ti':'Toma completa'}</small>`}</div>
  <div class="semantic-montaje"><video id="semanticCutPlayer" class="semantic-cut-player" preload="none" playsinline></video><div class="semantic-segs">${filas}</div></div>
  ${(p.montaje.eliminados||[]).length?`<details class="research-notes"><summary>Partes que se quitan (${p.montaje.eliminados.length})</summary>${p.montaje.eliminados.map(e=>`<p>${seconds(e.desde)}–${seconds(e.hasta)}: «${esc(e.texto.slice(0,160))}${e.texto.length>160?'…':''}»</p>`).join('')}</details>`:''}
  ${p.libreto?`<div class="actions"><button type="button" class="quiet" id="semanticMontajeLibreto">Volver al montaje del libreto</button></div>`:''}</section>`}
function moveSemanticCut(k,op){const w=semantic.plan.palabras_fuente;const segs=semantic.segmentos.map(s=>[...s]);const [a,b]=segs[k];const libre=i=>i>=0&&i<w.length&&!segs.some(([x,y],j)=>j!==k&&i>=x&&i<=y);
  if(op==='a-'&&libre(a-1)&&w[a-1][3]===w[a][3])segs[k][0]=a-1;else if(op==='a+'&&a<b)segs[k][0]=a+1;else if(op==='b-'&&b>a)segs[k][1]=b-1;else if(op==='b+'&&libre(b+1)&&w[b+1][3]===w[b][3])segs[k][1]=b+1;else if(op==='del')segs.splice(k,1);else return toast('Ese borde no puede moverse más');
  semantic.segmentos=segs;semantic.montaje=null;renderSemanticPlan()}
function playSemanticRanges(rangos){const video=$('#semanticCutPlayer');if(!video)return;let k=0;
  const paso=()=>{if(k>=rangos.length){video.ontimeupdate=null;video.pause();return}const [toma,t0,t1]=rangos[k];const url=`/media/${encodeURIComponent(semantic.plan.video_ids[toma])}/original`;video.ontimeupdate=null;
    const ir=()=>{video.currentTime=Math.max(0,t0);video.ontimeupdate=()=>{if(video.currentTime>=t1){k+=1;paso()}};video.play().catch(()=>{})};
    if(!video.src.endsWith(url)){video.src=url;video.addEventListener('loadedmetadata',ir,{once:true});video.load()}else ir()};
  paso()}
function playSemanticSegment(k){const w=semantic.plan.palabras_fuente;const [a,b]=semantic.segmentos[k];playSemanticRanges([[w[a][3],w[a][1]-0.08,w[b][2]+0.08]])}
function playSemanticJoin(k){const w=semantic.plan.palabras_fuente;const [a,b]=semantic.segmentos[k];const [c,d]=semantic.segmentos[k+1];playSemanticRanges([[w[b][3],Math.max(w[a][1],w[b][2]-2.5),w[b][2]+0.08],[w[c][3],w[c][1]-0.08,Math.min(w[d][2],w[c][1]+2.5)]])}

function semanticEventRow(e){const ajuste=semantic.ajustes[e.id]?.ajuste_inicio??e.ajuste_inicio??0;const duracion=String(semantic.ajustes[e.id]?.duracion??e.duracion_manual??'');const sonido=e.componente==='sonido';
  const opciones=[['','Automática'],...['1','1.5','2','2.5','3','4','5','6'].map(v=>[v,`${v.replace('.',',')} s`])];if(duracion&&!opciones.some(([v])=>v===duracion))opciones.push([duracion,`${duracion.replace('.',',')} s`]);
  const fuera=semantic.quitar.has(e.id);const texto=semantic.textos[e.id]??e.texto??'';
  return `<div class="semantic-event ${fuera?'off':''}" data-id="${esc(e.id)}"><label class="semantic-keep"><input type="checkbox" ${fuera?'':'checked'} data-id="${esc(e.id)}"><span>Incluir</span></label><span class="semantic-time">${seconds(e.inicio)}</span><div><strong>«${esc(e.dice)}»</strong><small>${esc(e.nombre)}${e.sonido?` · sonido ${esc(e.sonido)}`:''}${sonido?'':` · ${seconds(e.fin-e.inicio)} en pantalla`}</small>${e.texto_editable?`<input class="semantic-text" data-id="${esc(e.id)}" value="${esc(texto)}" aria-label="Texto en pantalla">`:''}
  <div class="semantic-adjust"><span>Entrada</span><button type="button" data-id="${esc(e.id)}" data-paso="-0.2">−0,2 s</button><output>${ajuste>0?'+':''}${seconds(ajuste)}</output><button type="button" data-id="${esc(e.id)}" data-paso="0.2">+0,2 s</button>${sonido?'':`<label>Duración<select class="semantic-duration" data-id="${esc(e.id)}">${opciones.map(([v,t])=>`<option value="${v}" ${v===duracion?'selected':''}>${t}</option>`).join('')}</select></label>`}</div>
  <small>${esc(e.justificacion)} <em>(${esc(semanticFuenteNames[e.fuente]||e.fuente)})</em></small>${e.verificar?`<p class="warning-note">Verificar: ${esc(e.verificar)}</p>`:''}</div></div>`}

function renderSemanticPlan(){const p=semantic.plan;if(!p){$('#semanticPlan').innerHTML='';return}const ready=p.status==='ready';const busy=semanticBusy.has(p.status);
  const head=`<div class="card-head"><div><p class="eyebrow">${ready?'PLAN APROBADO':busy?'TRABAJANDO EN SEGUNDO PLANO':'PLAN DE EDICIÓN · PENDIENTE DE TU APROBACIÓN'}</p><h3>${esc(p.name)}</h3></div><span class="status ${ready?'ready':p.status==='failed'?'failed':busy?'processing':''}">${esc(semanticStatusNames[p.status]||p.status)}</span></div>`;
  if(!p.eventos){$('#semanticPlan').innerHTML=`<article class="card semantic-plan">${head}${p.error?`<div class="error-box">${esc(p.error)}</div>`:'<p class="muted">Kiko está escuchando las tomas y comparándolas con el libreto. Puedes seguir usando el panel; te aviso cuando el plan esté listo.</p>'}</article>`;return}
  const ia=p.ia||{};const qc=p.qc?.aprobado?`<ul class="semantic-qc">${Object.entries(p.qc.aprobado).map(([k,v])=>`<li class="${v?'ok':'bad'}">${esc(semanticQcNames[k]||k)}</li>`).join('')}</ul><p class="fine">${seconds(p.qc.duracion_s)} · ${esc(String(p.qc.loudness_lufs).replace('.',','))} LUFS</p>`:'';
  const result=ready&&p.output_url?`<section class="success-box semantic-result"><strong>Video renderizado y verificado</strong><div class="semantic-result-grid"><div>${semanticPlayerHtml(`${p.output_url}?v=${encodeURIComponent(p.updated_at||'')}`,'semanticFinal')}</div><div>${qc}<div class="actions"><a class="primary link-button" href="${esc(p.output_url)}" download>Descargar MP4</a>${p.srt_url?`<a class="quiet link-button" href="${esc(p.srt_url)}" download>Subtítulos (SRT)</a>`:''}${p.miniatura_url?`<a class="quiet link-button" href="${esc(p.miniatura_url)}" download>Miniatura (JPG)</a>`:''}</div>${p.miniatura_url?`<img class="semantic-thumb" src="${esc(p.miniatura_url)}?v=${encodeURIComponent(p.updated_at||'')}" alt="Miniatura del video">`:''}<p class="fine">Si cambias el plan, vuelve a renderizar para actualizar el video.</p></div></div></section>`:'';
  const inicios=[...(p.eventos||[])].filter(e=>e.componente!=='sonido').sort((a,b)=>a.inicio-b.inicio);
  const vista=`<section class="semantic-block"><div class="semantic-block-head"><h4>Vista previa</h4><small class="muted">12 s a media resolución, en menos de un minuto</small></div><div class="semantic-preview-row"><label>Desde<select id="semanticPreviewStart"><option value="auto">La parte con más gráficos</option>${inicios.map(e=>`<option value="${Math.max(0,e.inicio-1.5).toFixed(1)}" ${p.vista_url&&Math.abs((p.vista_inicio||0)-Math.max(0,e.inicio-1.5))<0.05?'selected':''}>${seconds(e.inicio)} · ${esc(e.nombre)}</option>`).join('')}</select></label><button type="button" class="quiet" id="semanticPreview" ${busy?'disabled':''}>${p.status==='previewing'?'Preparando…':'Ver vista previa'}</button></div>${p.vista_url?`${semanticPlayerHtml(`${p.vista_url}?v=${encodeURIComponent(p.updated_at||'')}`,'semanticVista')}<p class="fine">Desde ${seconds(p.vista_inicio||0)} · incluye tu plantilla de marca</p>`:''}</section>`;
  $('#semanticPlan').innerHTML=`<article class="card semantic-plan">${head}<div class="edit-badges"><span>${seconds(p.duracion_original)} grabados → ${seconds(p.duracion)}</span><span>${esc(p.tomas)} ${p.tomas===1?'toma':'tomas'}</span><span>${esc(p.palabras)} palabras</span><span>${esc((p.eventos||[]).length)} gráficos y sonidos</span><span>Música: ${esc(p.musica?.nombre||'Apple Loops')}</span><span>IA: ${esc(ia.estado||'—')}${ia.proveedor?` (${esc(ia.proveedor)})`:''}</span></div>${p.error?`<div class="error-box">${esc(p.error)}</div>`:''}${busy?'<p class="warning-note">Kiko está trabajando en esta edición; los cambios se habilitan cuando termine.</p>':''}
  ${result}${semanticDirectorHtml(p)}${semanticEditionSkillsHtml(p)}${semanticLibretoHtml(p.libreto)}${semanticTimelineHtml(p)}${vista}${semanticMontajeHtml(p)}
  <section class="semantic-block"><div class="semantic-block-head"><h4>Gráficos y sonidos</h4><small class="muted">Desmarca lo que no quieras, ajusta la entrada o la duración y edita los textos</small></div><div class="semantic-events">${(p.eventos||[]).map(semanticEventRow).join('')||'<div class="empty">El plan no propone gráficos; puedes agregar un texto grande.</div>'}</div>
  <div class="semantic-add"><input id="semanticAddText" placeholder="Frase exacta de la toma, por ejemplo: ¿Cuántas cosas ha enterrado usted?"><button type="button" class="quiet" id="semanticAddButton">Agregar texto grande</button></div><div id="semanticPending" class="edit-badges">${semantic.agregar.map(f=>`<span>+ «${esc(f)}»</span>`).join('')}</div></section>
  ${(p.correcciones||[]).length?`<details class="research-notes"><summary>Correcciones de transcripción (${p.correcciones.length})</summary>${p.correcciones.map(c=>`<p>«${esc(c.de)}» → «${esc(c.a)}» <small class="muted">${esc(c.fuente)}${c.motivo?`: ${esc(c.motivo)}`:''}</small></p>`).join('')}</details>`:''}
  ${(p.descartados||[]).length?`<details class="research-notes"><summary>Descartados (${p.descartados.length})</summary>${p.descartados.map(d=>`<p>${seconds(d.inicio)} · ${esc(d.componente)} «${esc(d.ancla)}»: <small class="muted">${esc(d.motivo)}</small></p>`).join('')}</details>`:''}
  <div class="actions semantic-final-actions"><button type="button" class="quiet" id="semanticApply" ${busy?'disabled':''}>Aplicar cambios</button><button type="button" class="primary" id="semanticRender" ${busy?'disabled':''}>${p.status==='rendering'?'Renderizando…':ready?'Volver a renderizar':'Aprobar y renderizar'}</button></div></article>`;
  bindSemanticPlan()}

function bindSemanticPlan(){
  $$('.semantic-keep input').forEach(input=>input.onchange=()=>{input.checked?semantic.quitar.delete(input.dataset.id):semantic.quitar.add(input.dataset.id);input.closest('.semantic-event').classList.toggle('off',!input.checked)});
  $$('.semantic-text').forEach(input=>input.oninput=()=>{semantic.textos[input.dataset.id]=input.value});
  $$('.semantic-adjust button').forEach(button=>button.onclick=()=>{const id=button.dataset.id;const evento=semantic.plan.eventos.find(e=>e.id===id);const actual=semantic.ajustes[id]?.ajuste_inicio??evento.ajuste_inicio??0;const nuevo=Math.round(Math.max(-3,Math.min(3,actual+Number(button.dataset.paso)))*10)/10;semantic.ajustes[id]={...semantic.ajustes[id],ajuste_inicio:nuevo};button.parentElement.querySelector('output').textContent=`${nuevo>0?'+':''}${seconds(nuevo)}`});
  $$('.semantic-duration').forEach(select=>select.onchange=()=>{semantic.ajustes[select.dataset.id]={...semantic.ajustes[select.dataset.id],duracion:select.value?Number(select.value):0}});
  $$('.semantic-tl-event').forEach(button=>button.onclick=()=>{const fila=document.querySelector(`.semantic-event[data-id="${CSS.escape(button.dataset.id)}"]`);if(!fila)return;fila.scrollIntoView({behavior:'smooth',block:'center'});fila.classList.remove('flash');void fila.offsetWidth;fila.classList.add('flash')});
  $$('.semantic-seg-tools button').forEach(button=>button.onclick=()=>{const k=Number(button.closest('.semantic-seg').dataset.k);button.dataset.op==='play'?playSemanticSegment(k):moveSemanticCut(k,button.dataset.op)});
  $$('.semantic-join').forEach(button=>button.onclick=()=>playSemanticJoin(Number(button.dataset.k)));
  $$('.semantic-zone-buttons button').forEach(button=>button.onclick=()=>{const grupo=button.parentElement;grupo.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===button));showSemanticZone(grupo.dataset.player,button.dataset.zone)});
  const libreto=$('#semanticMontajeLibreto');if(libreto)libreto.onclick=async()=>{semantic.montaje='libreto';await applySemanticChanges(true)};
  const director=$('#semanticApplyDirector');if(director)director.onclick=applyDirectorRecommendations;
  const verSkills=$('#semanticOpenSkills');if(verSkills)verSkills.onclick=()=>showView('skills');
  $$('#semanticPlan [data-skill-chat]').forEach(button=>button.onclick=()=>window.openSkill&&openSkill(button.dataset.skillChat,{tab:'chat',edit:semantic.id}));
  const actuales=$('#semanticSkillsRefresh');if(actuales)actuales.onclick=async()=>{actuales.disabled=true;try{openSemantic(await postJson('/api/semantic/skills-refresh',{id:semantic.id}),false);toast('Esta edición usa ahora la configuración actual de las skills')}catch(e){toast(e.message);actuales.disabled=false}};
  $('#semanticAddButton').onclick=()=>{const value=$('#semanticAddText').value.trim();if(!value)return;semantic.agregar.push(value);$('#semanticAddText').value='';$('#semanticPending').innerHTML=semantic.agregar.map(f=>`<span>+ «${esc(f)}»</span>`).join('')};
  $('#semanticApply').onclick=()=>applySemanticChanges(true);
  $('#semanticPreview').onclick=()=>startSemanticRender(true);
  $('#semanticRender').onclick=()=>startSemanticRender(false)}

function semanticChanges(){const p=semantic.plan;const cambios={};const quitar=[...semantic.quitar];if(quitar.length)cambios.quitar=quitar;
  const textos={};Object.entries(semantic.textos).forEach(([id,valor])=>{const e=p.eventos.find(x=>x.id===id);if(e&&!semantic.quitar.has(id)&&valor.trim()!==(e.texto||''))textos[id]=valor.trim()});if(Object.keys(textos).length)cambios.textos=textos;
  const ajustes={};Object.entries(semantic.ajustes).forEach(([id,a])=>{const e=p.eventos.find(x=>x.id===id);if(!e||quitar.includes(id))return;const cambio={};if('ajuste_inicio' in a&&a.ajuste_inicio!==(e.ajuste_inicio||0))cambio.ajuste_inicio=a.ajuste_inicio;if('duracion' in a&&a.duracion!==(e.duracion_manual||0))cambio.duracion=a.duracion;if(Object.keys(cambio).length)ajustes[id]=cambio});if(Object.keys(ajustes).length)cambios.ajustes=ajustes;
  if(semantic.agregar.length)cambios.agregar_textos=[...semantic.agregar];
  if(semantic.montaje)cambios.montaje=semantic.montaje;else if(JSON.stringify(semantic.segmentos)!==JSON.stringify((p.montaje?.segmentos||[]).map(s=>[s.desde_i,s.hasta_i])))cambios.montaje=semantic.segmentos;
  return cambios}

async function applySemanticChanges(announce){const cambios=semanticChanges();if(!Object.keys(cambios).length){if(announce)toast('No hay cambios pendientes');return true}const button=$('#semanticApply');button.disabled=true;button.textContent='Recalculando el plan…';
  try{openSemantic(await postJson('/api/semantic/edit',{id:semantic.id,cambios}),false);if(announce)toast('Plan actualizado; mira la vista previa antes de renderizar');return true}
  catch(e){toast(e.message);button.disabled=false;button.textContent='Aplicar cambios';return false}}

async function startSemanticRender(preview){if(!await applySemanticChanges(false))return;semanticAskNotifications();
  try{const item=await postJson('/api/semantic/render',{id:semantic.id,preview,inicio:preview?$('#semanticPreviewStart').value:undefined});
    semantic.plan={...semantic.plan,...item};renderSemanticPlan();semanticProgressFor=item.id;
    setSemanticProgress({percent:2,stage:'audio',message:preview?'Preparando 12 s de vista previa…':'Preparando el render completo…'});
    watchSemantic(item.id,item.status);toast(preview?'Preparando la vista previa; te aviso cuando esté':'Renderizando en segundo plano; te aviso cuando el video esté listo');refresh()}
  catch(e){toast(e.message)}}

// --- Formularios --------------------------------------------------------------------------------

$('#semanticProject').onchange=()=>{semanticSelected=[];renderSemanticTakes();loadSemanticProject($('#semanticProject').value)};
$('#semanticLibreto').oninput=updateSemanticLibreto;
$('#semanticObjetivo').oninput=()=>{try{localStorage.setItem(`kiko-objetivo-${$('#semanticProject').value}`,$('#semanticObjetivo').value)}catch{}};
$('#semanticLibretoFile').onchange=async()=>{const input=$('#semanticLibretoFile');const file=input.files[0];if(!file)return;const form=new FormData();form.append('libreto',file);
  try{const r=await api('/api/semantic/libreto',{method:'POST',body:form});$('#semanticLibreto').value=r.texto;updateSemanticLibreto();toast(`Libreto «${r.nombre}» cargado; revísalo antes de planificar`)}catch(e){toast(e.message)}finally{input.value=''}};
$('#semanticAssetKind').onchange=()=>{$('#semanticAssetFile').accept=semanticAccept[$('#semanticAssetKind').value]};
$('#semanticAssetLicense').onchange=()=>{$('#semanticAssetLicenseOther').hidden=$('#semanticAssetLicense').value!=='otra'};
$('#semanticAssetForm').onsubmit=async event=>{event.preventDefault();const file=$('#semanticAssetFile').files[0];const kind=$('#semanticAssetKind').value;const elegida=$('#semanticAssetLicense').value;const license=elegida==='otra'?$('#semanticAssetLicenseOther').value.trim():elegida;
  if(!file)return toast('Elige el archivo del recurso');if(!license)return toast('Escribe la licencia y la fuente del recurso');if(!$('#semanticAssetRights').checked)return toast('Confirma que tienes derecho a usar el recurso');
  if(['image','sound'].includes(kind)&&semanticAssets.some(a=>['image','sound'].includes(a.kind)&&semanticKey(a.name)===semanticKey(file.name)))return toast(`Ya hay un recurso llamado «${file.name}»; renómbralo para que el libreto los distinga`);
  const button=event.submitter||$('#semanticAssetForm button');button.disabled=true;const form=new FormData();form.append('project_id',$('#semanticProject').value);form.append('kind',kind);form.append('license',license);form.append('asset',file);
  try{await api('/api/assets/import',{method:'POST',body:form});toast(`${semanticKindNames[kind]} «${file.name}» guardada en el proyecto`);$('#semanticAssetForm').reset();$('#semanticAssetLicenseOther').hidden=true;$('#semanticAssetFile').accept=semanticAccept.image;await loadSemanticProject($('#semanticProject').value)}catch(e){toast(e.message)}finally{button.disabled=false}};
$('#semanticBrandForm').onsubmit=async event=>{event.preventDefault();const projectId=$('#semanticProject').value;
  try{fillSemanticBrand(await postJson('/api/semantic/brand',{project_id:projectId,colores:{morado:$('#semanticColorMorado').value,violeta:$('#semanticColorVioleta').value,amarillo:$('#semanticColorAmarillo').value},logo_asset_id:$('#semanticBrandLogo').value||null,marca_de_agua:$('#semanticBrandWatermark').checked,cierre:{texto:$('#semanticBrandClosing').value,duracion:Number($('#semanticBrandClosingSeconds').value)}}));toast('Plantilla guardada; se aplica en la vista previa y en el render')}catch(e){toast(e.message)}};
$('#semanticForm').onsubmit=async event=>{event.preventDefault();const button=$('#semanticPlanButton');const files=[...$('#semanticFile').files];const libreto=$('#semanticLibreto').value.trim();
  if(!semanticSelected.length&&!files.length)return toast('Marca al menos una toma o sube una nueva');
  if(semanticLibretoStats().palabras<5){$('#semanticLibreto').focus();return toast('El libreto es obligatorio: pega o carga el texto que dices en las tomas')}
  if(semanticSelected.some(id=>semanticChecks.get(id)?.revision?.some(x=>x.nivel==='error')))return toast('Una de las tomas no tiene audio: desmárcala o vuelve a grabarla');
  if(semanticMissing.length&&!confirm(`El libreto pide ${semanticMissing.length===1?'una imagen que no está':`${semanticMissing.length} imágenes que no están`} en tus recursos (${semanticMissing.map(x=>x.nombre).join(', ')}). ¿Planificar sin ${semanticMissing.length===1?'ella':'ellas'}?`))return;
  semanticAskNotifications();button.disabled=true;
  try{let ids=[...semanticSelected];
    if(files.length){button.textContent='Subiendo tomas…';setSemanticProgress({percent:3,stage:'queued',message:'Guardando una copia intacta de las tomas…'});const form=new FormData();form.append('project_id',$('#semanticProject').value);files.forEach(file=>form.append('video',file));const subidas=await api('/api/video/import',{method:'POST',body:form});ids=[...ids,...(subidas.items||[subidas]).map(v=>v.id)];semanticSelected=ids;$('#semanticFile').value=''}
    button.textContent='Planificando…';const item=await postJson('/api/semantic/plan',{video_ids:ids,libreto,ia:$('#semanticIa').value,objetivo:$('#semanticObjetivo').value.trim()});
    semanticProgressFor=item.id;setSemanticProgress({percent:5,stage:'transcribing',message:'Escuchando las tomas palabra por palabra…'});openSemantic(item,true);watchSemantic(item.id,'planning');
    toast('Planificando en segundo plano; te aviso cuando el plan esté listo');await refresh()}
  catch(e){setSemanticProgress({percent:0,stage:'failed',message:e.message,status:'failed'});toast(e.message)}
  finally{button.disabled=false;button.textContent='Planificar edición'}};
$('#semanticImageForm').onsubmit=async event=>{event.preventDefault();const descripcion=$('#semanticImageText').value.trim();if(descripcion.split(/\s+/).length<2)return toast('Describe la imagen con algunas palabras');
  const button=event.submitter||$('#semanticImageForm button[type="submit"]');button.disabled=true;
  try{await generateSemanticImage({descripcion,nombre:$('#semanticImageName').value.trim()||descripcion.split(/\s+/).slice(0,4).join('-')});$('#semanticImageText').value='';$('#semanticImageName').value=''}catch(e){toast(e.message)}finally{button.disabled=false}};
$('#semanticAssetFile').accept=semanticAccept.image;
