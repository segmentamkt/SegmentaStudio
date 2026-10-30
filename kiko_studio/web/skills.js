// Skills de edición: conversar con cada una, activarlas, cambiar sus instrucciones y ajustes, y cargarles recursos.
// Usa $, $$, api, esc, toast y showView de app.js; semantic.js lee kikoSkills y abre el chat de una skill con openSkill.
let kikoSkills=[];
const skillLicencias=[['Propia','Propia (la hice yo)'],['Comprada con licencia','Comprada con licencia'],['Libre de derechos (CC0)','Libre de derechos (CC0)'],['otra','Otra…']];
const skillUso={director:'El Director las lee antes de analizar cada toma y recomendar skills.',generador:'Se añaden a cada imagen que generes con ChatGPT o Gemini.'};
const skillPost=(path,body)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

async function loadSkills(){try{kikoSkills=(await api('/api/skills')).items;renderSkills();if(window.renderSemanticSkills)renderSemanticSkills()}catch(e){toast(e.message)}}
function replaceSkill(skill){kikoSkills=kikoSkills.map(s=>s.id===skill.id?skill:s);renderSkills();if(window.renderSemanticSkills)renderSemanticSkills()}

function skillValorTexto(s,p){const v=s.ajustes[p.clave];if(p.tipo==='bool')return `${p.etiqueta}: ${v?'sí':'no'}`;if(p.tipo==='opcion')return `${p.etiqueta}: ${(p.opciones.find(o=>o[0]===v)||[v,v])[1]}`;if(p.tipo==='multiple')return `${p.etiqueta}: ${v.length} de ${p.opciones.length}`;if(p.tipo==='recurso')return `${p.etiqueta}: ${(s.recursos_cargados.find(r=>r.id===v)||{nombre:p.vacio||'por defecto'}).nombre}`;return `${p.etiqueta}: ${String(v).replace('.',',')}${p.unidad||''}`}
function skillCambios(s){return s.parametros.filter(p=>JSON.stringify(s.ajustes[p.clave])!==JSON.stringify(p.defecto)).map(p=>skillValorTexto(s,p))}
function skillSwitch(s){return `<label class="skill-switch" title="${s.activa?'Desactivar':'Activar'} ${esc(s.nombre)}"><input type="checkbox" ${s.activa?'checked':''} data-toggle="${esc(s.id)}" aria-label="${esc(s.nombre)} activa"><span></span></label>`}
function skillBadges(s){return `<div class="edit-badges">${s.personalizada?'<span>Personalizada</span>':''}${s.recursos_cargados.length?`<span>${s.recursos_cargados.length} ${s.recursos_cargados.length===1?'recurso':'recursos'}</span>`:''}${skillCambios(s).slice(0,3).map(t=>`<span>${esc(t)}</span>`).join('')}</div>`}

function renderSkills(){const director=kikoSkills.find(s=>s.id==='director');const resto=kikoSkills.filter(s=>s.id!=='director');
  $('#skillsStatus').textContent=`${resto.filter(s=>s.activa).length} de ${resto.length} activas`;$('#skillsStatus').className='status ready';
  $('#skillsDirector').innerHTML=director?`<article class="card skill-director ${director.activa?'':'off'}"><div class="skill-card-head"><span class="skill-icon">${director.icono}</span><div><p class="eyebrow">ORQUESTADOR</p><h3>${esc(director.nombre)}</h3></div>${skillSwitch(director)}</div><p>${esc(director.descripcion)}</p><div class="skill-director-team">${resto.map(s=>`<span class="${s.activa?'':'off'}" title="${esc(s.nombre)}${s.activa?'':' (inactiva)'}">${s.icono} ${esc(s.nombre)}</span>`).join('')}</div>${skillBadges(director)}<div class="skill-card-actions"><button type="button" class="primary" data-chat="director">💬 Conversar con el Director</button><button type="button" class="quiet" data-open="director">Configurar</button></div></article>`:'';
  $('#skillsGrid').innerHTML=resto.map(s=>`<article class="card skill-card ${s.activa?'':'off'}"><div class="skill-card-head"><span class="skill-icon">${s.icono}</span><div><h3>${esc(s.nombre)}</h3><small>${esc(s.momento)}</small></div>${skillSwitch(s)}</div><p>${esc(s.descripcion)}</p>${skillBadges(s)}<div class="skill-card-actions"><button type="button" class="quiet" data-chat="${esc(s.id)}">💬 Conversar</button><button type="button" class="quiet" data-open="${esc(s.id)}">Configurar</button></div></article>`).join('');
  $$('#skills [data-toggle]').forEach(input=>input.onchange=()=>toggleSkill(input.dataset.toggle,input.checked));
  $$('#skills [data-open]').forEach(button=>button.onclick=()=>openSkill(button.dataset.open,{tab:'config'}));
  $$('#skills [data-chat]').forEach(button=>button.onclick=()=>openSkill(button.dataset.chat,{tab:'chat'}))}
async function toggleSkill(id,activa){try{const skill=await skillPost('/api/skills/save',{id,activa});replaceSkill(skill);toast(`${skill.nombre} ${activa?'activada':'desactivada'}`)}catch(e){toast(e.message);renderSkills()}}

// --- Diálogo de una skill: pestañas Conversar y Configuración ----------------------------------

let skillTab='chat';

function skillField(s,p,v){const tipos=Object.fromEntries(s.tipos_recurso);
  if(p.tipo==='bool')return `<label class="skill-check"><input type="checkbox" data-clave="${esc(p.clave)}" ${v?'checked':''}><span>${esc(p.etiqueta)}</span></label>`;
  if(p.tipo==='rango')return `<label>${esc(p.etiqueta)}<span class="skill-range"><input type="range" data-clave="${esc(p.clave)}" min="${p.min}" max="${p.max}" step="${p.paso||1}" value="${v}"><output>${String(v).replace('.',',')}${esc(p.unidad||'')}</output></span></label>`;
  if(p.tipo==='opcion')return `<label>${esc(p.etiqueta)}<select data-clave="${esc(p.clave)}">${p.opciones.map(([valor,texto])=>`<option value="${esc(valor)}" ${valor===v?'selected':''}>${esc(texto)}</option>`).join('')}</select></label>`;
  if(p.tipo==='multiple')return `<fieldset class="skill-multiple" data-clave="${esc(p.clave)}"><legend>${esc(p.etiqueta)}</legend>${p.opciones.map(([valor,texto])=>`<label class="skill-check"><input type="checkbox" value="${esc(valor)}" ${v.includes(valor)?'checked':''}><span>${esc(texto)}</span></label>`).join('')}</fieldset>`;
  if(p.tipo==='color')return `<label>${esc(p.etiqueta)}<input type="color" data-clave="${esc(p.clave)}" value="${esc(v)}"></label>`;
  if(p.tipo==='texto')return `<label>${esc(p.etiqueta)}<input data-clave="${esc(p.clave)}" maxlength="${p.max||120}" value="${esc(v)}"></label>`;
  const opciones=s.recursos_cargados.filter(r=>r.tipo===p.recurso_tipo);
  return `<label>${esc(p.etiqueta)}<select data-clave="${esc(p.clave)}"><option value="">${esc(p.vacio||'Por defecto')}</option>${opciones.map(r=>`<option value="${esc(r.id)}" ${r.id===v?'selected':''}>${esc(r.nombre)}</option>`).join('')}</select>${opciones.length?'':`<small>Sube abajo un recurso de tipo «${esc(tipos[p.recurso_tipo]||p.recurso_tipo)}» para elegirlo aquí.</small>`}</label>`}

function readSkillForm(){const form=$('#skillPanelConfig');const ajustes={};
  form.querySelectorAll('[data-clave]').forEach(el=>{const clave=el.dataset.clave;if(el.tagName==='FIELDSET')ajustes[clave]=[...el.querySelectorAll('input:checked')].map(i=>i.value);else if(el.type==='checkbox')ajustes[clave]=el.checked;else if(el.type==='range')ajustes[clave]=Number(el.value);else ajustes[clave]=el.value});
  return {activa:$('#skillActiva').checked,instrucciones:$('#skillInstrucciones').value,ajustes,director_ajusta:$('#skillDirectorAjusta')?$('#skillDirectorAjusta').checked:true}}

function renderSkillDialog(s,borrador){
  $('#skillForm').innerHTML=`<div class="skill-dialog-head"><span class="skill-icon">${s.icono}</span><div><p class="eyebrow">${s.id==='director'?'ORQUESTADOR':'SKILL'} · ${esc(s.momento.toUpperCase())}</p><h3 id="skillDialogTitle">${esc(s.nombre)}</h3></div><label class="skill-switch" title="Activa"><input type="checkbox" id="skillActiva" ${(borrador||s).activa?'checked':''} aria-label="Activa"><span></span></label><button type="button" class="skill-close" aria-label="Cerrar">×</button></div>
  <div class="skill-tabs" role="tablist"><button type="button" role="tab" data-tab="chat" aria-selected="${skillTab==='chat'}">💬 Conversar</button><button type="button" role="tab" data-tab="config" aria-selected="${skillTab==='config'}">⚙️ Configuración</button></div>
  <div id="skillPanelChat" class="skill-chat" role="tabpanel" ${skillTab==='chat'?'':'hidden'}></div>
  <div id="skillPanelConfig" class="skill-config" role="tabpanel" ${skillTab==='config'?'':'hidden'}></div>`;
  $('#skillForm .skill-close').onclick=()=>$('#skillDialog').close();
  $$('#skillForm [data-tab]').forEach(tab=>tab.onclick=()=>{skillTab=tab.dataset.tab;$$('#skillForm [data-tab]').forEach(t=>t.setAttribute('aria-selected',t===tab));$('#skillPanelChat').hidden=skillTab!=='chat';$('#skillPanelConfig').hidden=skillTab!=='config';if(skillTab==='chat')loadSkillChat(s)});
  renderSkillConfig(s,borrador);
  if(skillTab==='chat')loadSkillChat(s)}

function renderSkillConfig(s,borrador){const d=borrador||{activa:s.activa,instrucciones:s.instrucciones,ajustes:s.ajustes,director_ajusta:s.director_ajusta};
  $('#skillPanelConfig').innerHTML=`<p class="muted">${esc(s.descripcion)}</p>
  <label>Instrucciones<textarea id="skillInstrucciones" rows="6">${esc(d.instrucciones)}</textarea><small>${esc(skillUso[s.id]||'El Director las tiene en cuenta al recomendar los ajustes de esta skill en cada video.')}</small></label>
  <div class="actions"><button type="button" class="quiet" id="skillResetPrompt">Restablecer instrucciones</button></div>
  <h4>Ajustes</h4><div class="skill-fields">${s.parametros.map(p=>skillField(s,p,d.ajustes[p.clave])).join('')}</div>
  ${s.id==='director'?'':`<label class="skill-check"><input type="checkbox" id="skillDirectorAjusta" ${d.director_ajusta?'checked':''}><span>El Director puede recomendar cambios en esta skill</span></label>`}
  <h4>Recursos</h4><p class="fine">${esc(s.ayuda_recursos)}</p>
  <div class="skill-resources">${s.recursos_cargados.length?s.recursos_cargados.map(r=>`<div class="skill-resource"><span class="semantic-kind">${esc(r.tipo_nombre)}</span><div><a href="${esc(r.url)}" target="_blank">${esc(r.nombre)}</a><small>${esc(r.licencia)}</small></div><button type="button" class="danger-quiet" data-borrar="${esc(r.id)}">Quitar</button></div>`).join(''):'<div class="empty">Esta skill todavía no tiene recursos.</div>'}</div>
  <div class="skill-upload"><div class="form-row"><label>Tipo<select id="skillRecursoTipo">${s.tipos_recurso.map(([valor,texto])=>`<option value="${esc(valor)}">${esc(texto)}</option>`).join('')}</select></label><label>Licencia<select id="skillRecursoLicencia">${skillLicencias.map(([valor,texto])=>`<option value="${esc(valor)}">${esc(texto)}</option>`).join('')}</select></label></div>
  <input id="skillRecursoOtra" hidden placeholder="Licencia y fuente, por ejemplo: Pixabay License, pixabay.com/…"><label>Archivo<input id="skillRecursoArchivo" type="file"></label>
  <label class="skill-check"><input id="skillRecursoDerechos" type="checkbox"><span>Confirmo que tengo derecho a usar este recurso.</span></label><button type="button" class="quiet" id="skillRecursoSubir">Subir recurso</button></div>
  <div class="actions skill-dialog-actions"><button type="button" class="danger-quiet" id="skillResetAll">Restablecer todo</button><span></span><button type="button" class="quiet" id="skillCerrar">Cerrar</button><button type="button" class="primary" id="skillGuardar">Guardar</button></div>`;
  const form=$('#skillPanelConfig');
  form.querySelectorAll('input[type="range"]').forEach(input=>input.oninput=()=>{const p=s.parametros.find(x=>x.clave===input.dataset.clave);input.nextElementSibling.textContent=`${String(input.value).replace('.',',')}${p.unidad||''}`});
  $('#skillCerrar').onclick=()=>$('#skillDialog').close();
  $('#skillResetPrompt').onclick=()=>{$('#skillInstrucciones').value=s.instrucciones_por_defecto};
  $('#skillRecursoLicencia').onchange=()=>{$('#skillRecursoOtra').hidden=$('#skillRecursoLicencia').value!=='otra'};
  $('#skillRecursoSubir').onclick=()=>uploadSkillResource(s);
  form.querySelectorAll('[data-borrar]').forEach(button=>button.onclick=async()=>{if(!confirm('¿Quitar este recurso de la skill?'))return;const borrador=readSkillForm();try{const skill=await skillPost('/api/skills/resource/delete',{id:button.dataset.borrar});replaceSkill(skill);renderSkillConfig(skill,{...borrador,ajustes:{...borrador.ajustes,...Object.fromEntries(skill.parametros.filter(p=>p.tipo==='recurso').map(p=>[p.clave,skill.ajustes[p.clave]]))}})}catch(e){toast(e.message)}});
  $('#skillResetAll').onclick=async()=>{if(!confirm(`¿Volver ${s.nombre} a sus instrucciones y ajustes originales? Los recursos se conservan.`))return;try{const skill=await skillPost('/api/skills/reset',{id:s.id});replaceSkill(skill);renderSkillConfig(skill);$('#skillActiva').checked=skill.activa;toast('Skill restablecida')}catch(e){toast(e.message)}};
  $('#skillGuardar').onclick=async()=>{const button=$('#skillGuardar');button.disabled=true;try{const skill=await skillPost('/api/skills/save',{id:s.id,...readSkillForm()});replaceSkill(skill);$('#skillDialog').close();toast(`${skill.nombre} guardada; se usa en las próximas ediciones`)}catch(e){toast(e.message)}finally{button.disabled=false}}}

async function uploadSkillResource(s){const archivo=$('#skillRecursoArchivo').files[0];const elegida=$('#skillRecursoLicencia').value;const licencia=elegida==='otra'?$('#skillRecursoOtra').value.trim():elegida;
  if(!archivo)return toast('Elige el archivo del recurso');if(!licencia)return toast('Escribe la licencia y la fuente del recurso');if(!$('#skillRecursoDerechos').checked)return toast('Confirma que tienes derecho a usar el recurso');
  const borrador=readSkillForm();const form=new FormData();form.append('skill_id',s.id);form.append('kind',$('#skillRecursoTipo').value);form.append('license',licencia);form.append('archivo',archivo);
  const button=$('#skillRecursoSubir');button.disabled=true;
  try{const skill=await api('/api/skills/resource',{method:'POST',body:form});replaceSkill(skill);renderSkillConfig(skill,borrador);toast(`«${archivo.name}» agregado a ${skill.nombre}`)}catch(e){toast(e.message);button.disabled=false}}

// --- Chat con la skill --------------------------------------------------------------------------

const skillChat={skill:null,edit:null,timer:null,borrador:'',videos:[]};
const skillIA={'claude-cli':'Claude','codex-cli':'ChatGPT','gemini-cli':'Gemini'};
const skillSugerencias={director:['¿Qué skills recomiendas para este video y por qué?','Revisa el video completo y dime qué mejorarías'],sonido:['¿Cómo quedó la voz?','Baja un poco la música en este video'],efectos:['¿Qué gráficos pusiste y por qué?','Quita los gráficos que no aporten'],recortes:['¿Qué cortaste y por qué?','¿Hay alguna frase repetida que convenga quitar?'],edicion:['¿Dónde hay acercamientos?','Pon un acercamiento en la frase más importante'],filtros:['¿Qué look le queda mejor a esta toma?'],generador:['¿Qué imágenes harían falta en este video?'],superposiciones:['¿Cómo se ve la marca en este video?'],audio_fx:['¿Qué sonidos pusiste?','Quita los sonidos que distraigan'],subtitulos:['¿Hay palabras mal escritas en los subtítulos?'],retoques:['¿Cómo se ve la imagen? ¿Hace falta más brillo?']};
const skillTexto=t=>esc(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');

async function loadSkillChat(s){clearTimeout(skillChat.timer);
  if(skillChat.skill!==s.id){skillChat.skill=s.id;skillChat.borrador=''}
  try{let data=await api(`/api/skills/chat?skill=${encodeURIComponent(s.id)}&edit=${encodeURIComponent(skillChat.edit||'')}`);
    if(skillChat.edit===null){skillChat.edit=data.videos[0]?.id||'';if(skillChat.edit)data=await api(`/api/skills/chat?skill=${encodeURIComponent(s.id)}&edit=${encodeURIComponent(skillChat.edit)}`)}
    if(skillChat.skill!==s.id||!$('#skillPanelChat'))return;
    renderSkillChat(s,data);
    if(data.ocupada&&$('#skillDialog').open)skillChat.timer=setTimeout(()=>loadSkillChat(s),2000)}
  catch(e){$('#skillPanelChat').innerHTML=`<div class="empty">${esc(e.message)}</div>`}}

function skillMessageHtml(s,m){
  if(m.rol==='usuario')return `<div class="chat-msg user"><p>${skillTexto(m.texto)}</p></div>`;
  if(m.estado==='pensando')return `<div class="chat-msg skill thinking"><span class="skill-icon">${s.icono}</span><p><span>Pensando<span class="skill-dots"></span></span><small>Puede tardar hasta un minuto.</small></p></div>`;
  const d=m.detalle||{};const acciones=m.acciones||[];const lista=m.estado==='lista';const validas=acciones.filter(a=>a.valida).length;
  const estado={lista:['Propuesta','',''],aplicada:['Aplicada','ready',''],deshecha:['Deshecha','','']}[m.estado]||['','',''];
  const botones=lista&&validas?`<button type="button" class="primary" data-aplicar="${esc(m.id)}">Aplicar</button>`:m.estado==='aplicada'?`${m.deshacible?`<button type="button" class="quiet" data-deshacer="${esc(m.id)}">Deshacer</button>`:''}${d.deshacer?.plan?`<button type="button" class="quiet" data-vista="${esc(m.id)}" data-inicio="${d.inicio_vista??'auto'}">Ver vista previa</button>`:''}`:'';
  const tarjeta=acciones.length?`<div class="skill-proposal ${esc(m.estado)}" data-msg="${esc(m.id)}"><div class="skill-proposal-head"><strong>${validas===1?'1 cambio':`${validas} cambios`}${validas<acciones.length?` · ${acciones.length-validas} no se puede${acciones.length-validas===1?'':'n'} hacer`:''}</strong>${estado[0]?`<span class="status ${estado[1]}">${estado[0]}</span>`:''}</div>
    <ul>${acciones.map((a,k)=>`<li class="${a.valida?'':'invalid'}"><label class="skill-check"><input type="checkbox" data-accion="${k}" ${a.valida&&(!d.aplicadas||d.aplicadas.includes(k))?'checked':''} ${!a.valida||!lista?'disabled':''}><span>${esc(a.descripcion)}</span></label>${a.error?`<small class="skill-proposal-error">No se puede: ${esc(a.error)}</small>`:''}${a.texto_completo?`<details><summary>Ver las instrucciones nuevas</summary><pre>${esc(a.texto_completo)}</pre></details>`:''}</li>`).join('')}</ul>
    ${(d.resultado||[]).length?`<div class="skill-proposal-result"><span>Así queda el video:</span>${d.resultado.map(r=>`<span>${esc(r)}</span>`).join('')}</div>`:''}
    ${(d.avisos||[]).map(a=>`<p class="skill-proposal-warn">⚠️ ${esc(a)}</p>`).join('')}${d.aviso?`<p class="skill-proposal-warn">⚠️ ${esc(d.aviso)}</p>`:''}
    ${(d.imagenes||[]).length?`<p class="muted">Generando ${d.imagenes.length===1?'1 imagen':`${d.imagenes.length} imágenes`}: aparecen en el generador del editor para que las apruebes.</p>`:''}
    ${botones?`<div class="actions">${botones}</div>`:''}<div class="skill-proposal-preview" id="skillVista-${esc(m.id)}"></div></div>`:'';
  return `<div class="chat-msg skill ${m.estado==='error'?'error':''}"><span class="skill-icon">${s.icono}</span><div><p>${skillTexto(m.texto)}</p>${tarjeta}${d.proveedor?`<small class="muted">${esc(skillIA[d.proveedor]||d.proveedor)} · ${String(d.segundos).replace('.',',')} s</small>`:''}</div></div>`}

function renderSkillChat(s,data){const panel=$('#skillPanelChat');if(data.videos)skillChat.videos=data.videos;const videos=skillChat.videos;const entrada=$('#skillChatInput');if(entrada)skillChat.borrador=entrada.value;
  const fecha=v=>new Date(v.created_at.replace(' ','T')+(v.created_at.includes('T')?'':'Z')).toLocaleDateString('es',{day:'numeric',month:'short'});
  const estados=typeof semanticStatusNames!=='undefined'?semanticStatusNames:{};
  const vacio=`<div class="skill-chat-empty"><p>${skillChat.edit?'Pregúntale qué hizo en este video o pídele un cambio.':'Sin video, la skill solo habla de su configuración.'} Nada se aplica sin tu aprobación.</p><div class="skill-chat-suggest">${(skillSugerencias[s.id]||[]).concat(['¿Qué puedes hacer?']).map(t=>`<button type="button" class="quiet" data-sugerencia="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
  panel.innerHTML=`<div class="skill-chat-top"><label>Video<select id="skillChatVideo"><option value="">Sin video (solo su configuración)</option>${videos.map(v=>`<option value="${esc(v.id)}" ${v.id===skillChat.edit?'selected':''}>${esc(v.name)} · ${esc(estados[v.status]||v.status)} · ${fecha(v)}</option>`).join('')}</select></label>
    <details class="skill-chat-tools"><summary>Lo que puede hacer (${data.herramientas.length})</summary><ul>${data.herramientas.map(h=>`<li><strong>${esc(h.nombre.replaceAll('_',' '))}</strong> · ${esc(h.descripcion)}</li>`).join('')}</ul></details></div>
  <div class="skill-chat-log" id="skillChatLog" aria-live="polite">${data.items.length?data.items.map(m=>skillMessageHtml(s,m)).join(''):vacio}</div>
  <div class="skill-chat-compose"><textarea id="skillChatInput" rows="2" placeholder="Escríbele a ${esc(s.nombre)}…" ${data.ocupada?'disabled':''}>${esc(skillChat.borrador)}</textarea><button type="button" class="primary" id="skillChatSend" ${data.ocupada?'disabled':''}>Enviar</button></div>
  <div class="skill-chat-foot"><small class="muted">Enter envía · Mayúsculas + Enter hace un salto de línea</small>${data.items.length?'<button type="button" class="quiet" id="skillChatClear">Nueva conversación</button>':''}</div>`;
  const log=$('#skillChatLog');log.scrollTop=log.scrollHeight;
  $('#skillChatVideo').onchange=()=>{skillChat.edit=$('#skillChatVideo').value;loadSkillChat(s)};
  const enviar=texto=>sendSkillMessage(s,texto);
  $('#skillChatSend').onclick=()=>enviar($('#skillChatInput').value);
  $('#skillChatInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();enviar($('#skillChatInput').value)}};
  panel.querySelectorAll('[data-sugerencia]').forEach(b=>b.onclick=()=>enviar(b.dataset.sugerencia));
  const limpiar=$('#skillChatClear');if(limpiar)limpiar.onclick=async()=>{if(!confirm('¿Empezar una conversación nueva? Esta se borra; los cambios aplicados se quedan.'))return;try{renderSkillChat(s,await skillPost('/api/skills/chat/clear',{skill:s.id,edit:skillChat.edit}))}catch(e){toast(e.message)}};
  panel.querySelectorAll('[data-aplicar]').forEach(b=>b.onclick=()=>applySkillProposal(s,b));
  panel.querySelectorAll('[data-deshacer]').forEach(b=>b.onclick=()=>undoSkillProposal(s,b));
  panel.querySelectorAll('[data-vista]').forEach(b=>b.onclick=()=>previewSkillChange(b))}

async function sendSkillMessage(s,texto){texto=texto.trim();if(!texto)return;
  $('#skillChatSend').disabled=true;
  try{const data=await skillPost('/api/skills/chat',{skill:s.id,edit:skillChat.edit,texto});$('#skillChatInput').value='';skillChat.borrador='';renderSkillChat(s,data);clearTimeout(skillChat.timer);skillChat.timer=setTimeout(()=>loadSkillChat(s),2000)}
  catch(e){toast(e.message);$('#skillChatSend').disabled=false}}

// Después de aplicar o deshacer: la configuración y el editor muestran lo nuevo.
async function afterSkillChange(s){await loadSkills();const actual=kikoSkills.find(x=>x.id===s.id);if(actual&&$('#skillPanelConfig')){renderSkillConfig(actual);$('#skillActiva').checked=actual.activa}
  if(typeof semantic!=='undefined'&&semantic.id&&semantic.id===skillChat.edit&&typeof loadSemantic==='function')loadSemantic(semantic.id)}

async function applySkillProposal(s,button){const tarjeta=button.closest('.skill-proposal');const indices=[...tarjeta.querySelectorAll('[data-accion]:checked')].map(i=>Number(i.dataset.accion));
  if(!indices.length)return toast('Marca al menos un cambio');
  button.disabled=true;button.textContent='Aplicando…';
  try{const data=await skillPost('/api/skills/chat/apply',{id:tarjeta.dataset.msg,indices});renderSkillChat(s,data);await afterSkillChange(s);toast(skillChat.edit?'Cambios aplicados; mira la vista previa antes de renderizar':'Cambios guardados en la skill')}
  catch(e){toast(e.message);button.disabled=false;button.textContent='Aplicar'}}

async function undoSkillProposal(s,button){if(!confirm('¿Deshacer este cambio? El video y la skill vuelven a como estaban antes.'))return;
  button.disabled=true;
  try{const data=await skillPost('/api/skills/chat/undo',{id:button.dataset.deshacer});renderSkillChat(s,data);await afterSkillChange(s);toast('Cambio deshecho')}
  catch(e){toast(e.message);button.disabled=false}}

async function previewSkillChange(button){const caja=$(`#skillVista-${CSS.escape(button.dataset.vista)}`);const edit=skillChat.edit;
  button.disabled=true;caja.innerHTML='<p class="muted">Preparando 12 s de vista previa (menos de un minuto)…</p>';
  try{await skillPost('/api/semantic/render',{id:edit,preview:true,inicio:button.dataset.inicio});
    for(let intento=0;intento<120;intento++){await new Promise(r=>setTimeout(r,2000));const plan=await api(`/api/semantic/plan?id=${encodeURIComponent(edit)}`);
      if(plan.status==='failed')throw new Error(plan.error||'No se pudo preparar la vista previa');
      if(!['planning','previewing','rendering'].includes(plan.status)){if(!plan.vista_url)throw new Error('La vista previa no quedó lista');caja.innerHTML=`<video controls autoplay playsinline src="${esc(plan.vista_url)}?t=${Date.now()}"></video>`;if(typeof semantic!=='undefined'&&semantic.id===edit&&typeof loadSemantic==='function')loadSemantic(edit);return}}
    throw new Error('La vista previa está tardando; revísala en el editor')}
  catch(e){caja.innerHTML=`<p class="skill-proposal-error">${esc(e.message)}</p>`;button.disabled=false}}

// El diálogo vive fuera de las vistas para abrirse también desde el editor.
function openSkill(id,opciones={}){const skill=kikoSkills.find(s=>s.id===id);if(!skill)return;
  skillTab=opciones.tab||'config';if(opciones.edit!==undefined)skillChat.edit=opciones.edit;
  renderSkillDialog(skill);$('#skillDialog').showModal();$('#skillDialog').appendChild($('#toast'))}
window.openSkill=openSkill;
document.body.appendChild($('#skillDialog'));
// Los avisos se ven encima del diálogo mientras está abierto.
$('#skillDialog').addEventListener('close',()=>{clearTimeout(skillChat.timer);document.body.appendChild($('#toast'))});
loadSkills();
