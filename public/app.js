const $ = id => document.getElementById(id);
let token=sessionStorage.getItem('admin-token') || '', watches=[], accounts=[], destinations=[], deliveries=[], monitor=null, qrTimer;
const id=()=>crypto.randomUUID();
const checkedAtFormatter=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function formatCheckedAt(value){if(!value)return 'Ainda não consultada';const date=new Date(`${value.replace(' ','T')}Z`);return Number.isNaN(date.getTime())?'Horário da consulta indisponível':`Consultado em ${checkedAtFormatter.format(date)} (Brasília)`;}
function updateCountdown(){
 if(!monitor?.next_run_at){$('next-run').textContent='—';$('schedule-message').textContent='Sem agendamento confirmado';return;}
 if(monitor.running){$('next-run').textContent='Em curso';$('schedule-message').textContent='Monitoramento em execução';return;}
 const remaining=new Date(monitor.next_run_at).getTime()-Date.now();
 if(!Number.isFinite(remaining)){$('next-run').textContent='—';return;}
 const seconds=Math.max(0,Math.ceil(remaining/1000));
 $('next-run').textContent=remaining<=0?'Aguardando':`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
 $('schedule-message').textContent='Até a próxima execução agendada';
}
updateCountdown();setInterval(updateCountdown,1000);
function notify(message){$('notice').textContent=message;$('notice').classList.add('show');clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('notice').classList.remove('show'),5000);}
async function api(path,method='GET',body){const response=await fetch(`/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error || 'Não foi possível concluir');return data;}
function element(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function row(title,description,tail){const r=element('div','list-row'), left=element('div');left.append(element('strong','',title),element('small','',description));r.append(left);if(tail)r.append(tail);return r;}
function options(select,items,label){select.replaceChildren();if(!items.length){select.append(new Option('Nenhuma opção disponível',''));return;}for(const item of items)select.add(new Option(label(item),item.id));}
function render(){
 if(monitor){
  for(const label of ['pending','failed','sent','obsolete'])$('delivery-'+label).textContent=monitor.deliveries?.[label]??0;
  const s=monitor.last_summary;
  const recent=monitor.last_finished_at?formatCheckedAt(monitor.last_finished_at):'Ainda não há execução concluída';
  const detail=s?` · ${s.checked} consultas, ${s.queryErrors} erros, ${s.sent} envios, ${s.deliveryErrors} falhas de entrega`:'';
  $('monitor-summary').textContent=`${monitor.running?'Monitor em execução. ':''}${monitor.last_error?'Último ciclo apresentou falha geral. ':''}${recent}${detail}.`;
 }
 updateCountdown();
 $('delivery-history').replaceChildren();
 if(!deliveries.length)$('delivery-history').append(element('div','empty','Nenhuma entrega registrada.'));
 for(const d of deliveries.slice(0,12)){
  const state={pending:'Aguardando',failed:'Falhou',sent:'Enviada',obsolete:'Descartada'}[d.status]||d.status;
  const badge=element('span',`delivery-badge ${d.status}`,state);
  const detail=`${d.kind} · Turma ${d.class_code} · ${d.attempts} tentativa(s) · ${formatCheckedAt(d.created_at)}`;
  let tail=badge;
  if(d.status==='failed'){
   const retry=element('button','ghost','Tentar novamente');
   retry.type='button';
   retry.onclick=async()=>{retry.disabled=true;try{await api('/deliveries/retry','POST',{id:d.id});await refresh();notify('Entrega preparada para uma nova tentativa na próxima execução.');}catch(e){notify(e.message);retry.disabled=false;}};
   tail=element('div','delivery-actions');tail.append(badge,retry);
  }
  const item=row(d.subject,detail,tail);
  if(d.last_error)item.title=d.last_error;
  $('delivery-history').append(item);
 }
 $('count-all').textContent=watches.length;$('count-open').textContent=watches.filter(x=>x.state==='open'&&!x.last_error).length;$('count-errors').textContent=watches.filter(x=>x.last_error).length;$('account-count').textContent=`${accounts.length} ${accounts.length===1?'conta':'contas'}`;
 $('watches').replaceChildren();if(!watches.length)$('watches').append(element('div','empty','Nenhuma turma cadastrada. Adicione uma conta para começar.'));
 for(const w of watches){const state=w.last_error?'error':w.state||'pending';const badge=element('span',`state ${state}`,({open:'Vaga disponível',closed:'Sem vaga',error:'Erro na consulta',pending:'Aguardando consulta'})[state]);const remove=element('button','ghost danger','Remover');remove.type='button';remove.setAttribute('aria-label',`Remover acompanhamento de ${w.subject}, turma ${w.class_code}`);remove.onclick=async()=>{if(!confirm(`Remover o acompanhamento de ${w.subject} · Turma ${w.class_code}? O histórico de notificações desta turma também será excluído.`))return;remove.disabled=true;try{await api(`/watches/${encodeURIComponent(w.id)}`,'DELETE');await refresh();notify('Turma removida do acompanhamento.');}catch(e){notify(e.message);remove.disabled=false;}};const actions=element('div','watch-actions');actions.append(badge,remove);const r=row(`${w.subject} · Turma ${w.class_code}`,`${w.subject_code}  •  ${w.account_id}  •  ${formatCheckedAt(w.checked_at)}`,actions);r.className='watch-row';$('watches').append(r);}
 $('accounts').replaceChildren();if(!accounts.length)$('accounts').append(element('div','empty','Nenhuma conta adicionada.'));for(const a of accounts)$('accounts').append(row(a.id,'Conta cadastrada'));
 $('destinations').replaceChildren();if(!destinations.length)$('destinations').append(element('div','empty','Nenhum destino configurado.'));for(const d of destinations){const button=element('button','ghost','Testar');button.type='button';button.onclick=async()=>{button.disabled=true;try{await api('/destinations/test','POST',{id:d.id});notify('Notificação de teste enviada.');}catch(e){notify(e.message);}finally{button.disabled=false;}};const remove=element('button','ghost danger','Excluir');remove.type='button';remove.onclick=async()=>{if(!confirm('Excluir este destino e o histórico de entregas associado?'))return;remove.disabled=true;try{await api(`/destinations/${encodeURIComponent(d.id)}`,'DELETE');await refresh();notify('Destino excluído.');}catch(e){notify(e.message);remove.disabled=false;}};const actions=element('div','section-actions');actions.append(button,remove);const account=accounts.find(x=>x.id===d.account_id);const description=account?`Conta ${account.id} · todas as matérias monitoradas`:'Conta não vinculada';if(!d.account_id&&accounts.length){const select=document.createElement('select');for(const a of accounts)select.add(new Option(a.id,a.id));const assign=element('button','ghost','Vincular conta');assign.type='button';assign.onclick=async()=>{assign.disabled=true;try{await api('/destinations/assign','POST',{id:d.id,account_id:select.value});await refresh();notify('Destino vinculado à conta.');}catch(e){notify(e.message);assign.disabled=false;}};actions.prepend(select,assign);}$('destinations').append(row(({discord:'Discord',phone:'Telefone · ntfy',whatsapp:'WhatsApp'})[d.kind],description,actions));}
 options($('account-select'),accounts,a=>a.id);options($('destination-account-select'),accounts,a=>a.id);
}
async function refresh(){[watches,accounts,destinations,monitor,deliveries]=await Promise.all([api('/watches'),api('/accounts'),api('/destinations'),api('/status'),api('/deliveries')]);render();}
async function enter(){await refresh();$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=false;sessionStorage.setItem('admin-token',token);}
$('login-form').onsubmit=async e=>{e.preventDefault();token=$('token').value;try{await enter();$('token').value='';}catch(e){token='';notify(e.message);}};
$('logout').onclick=()=>{token='';sessionStorage.removeItem('admin-token');$('dashboard').hidden=true;$('login').hidden=false;$('logout').hidden=true;clearInterval(qrTimer);};
$('refresh').onclick=()=>refresh().catch(e=>notify(e.message));
$('force-track').onclick=async()=>{const button=$('force-track');button.disabled=true;button.textContent='Consultando…';try{const result=await api('/run','POST');await refresh();if(result.queryErrors)notify(`Consulta concluída com erro em ${result.queryErrors} turma(s). Confira o estado no painel.`);else if(result.deliveryErrors)notify(`${result.deliveryErrors} notificação(ões) falharam no envio e serão tentadas novamente.`);else if(result.sent)notify(`Rastreamento concluído: ${result.sent} notificação(ões) enviada(s), incluindo eventuais reenvios pendentes.`);else if(!result.changed)notify('Rastreamento concluído: nenhuma nova abertura foi identificada.');else if(!result.queued)notify(`A disponibilidade mudou em ${result.changed} turma(s), mas não há canal configurado para receber o aviso.`);else notify(`Foram detectadas vagas em ${result.changed} turma(s); ${result.queued} aviso(s) enfileirado(s).`);}catch(e){notify(e.message);}finally{button.disabled=false;button.textContent='Rastrear agora';}};
$('account-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const f=new FormData(form);try{await api('/accounts','POST',Object.fromEntries(f));form.reset();form.closest('details').open=false;await refresh();notify('Conta salva.');}catch(err){notify(err.message);}};
$('watch-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const f=Object.fromEntries(new FormData(form));try{await api('/watches','POST',{...f,id:id()});form.reset();form.closest('details').open=false;await refresh();notify('Turma adicionada.');}catch(err){notify(err.message);}};
const labels={discord:['URL do webhook Discord','Crie um webhook no canal do Discord e cole a URL acima.'],phone:['Tópico do ntfy','Instale o app ntfy e assine este mesmo tópico. Use letras, números, _ ou -, de 1 a 64 caracteres; escolha um nome difícil de adivinhar.'],whatsapp:['Número de destino','Informe DDI, DDD e número, somente dígitos. Conecte o WhatsApp abaixo.']};
$('kind').onchange=()=>{const [label,help]=labels[$('kind').value];$('config-label').firstChild.textContent=label;$('channel-help').textContent=help;$('destination-value').value='';};
$('destination-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const f=Object.fromEntries(new FormData(form));const config=f.kind==='discord'?{webhook:f.value}:f.kind==='phone'?{topic:f.value}:{phone:f.value};try{await api('/destinations','POST',{id:id(),account_id:f.account_id,kind:f.kind,config});form.reset();$('kind').onchange();form.closest('details').open=false;await refresh();notify('Destino salvo para todas as matérias da conta.');}catch(err){notify(err.message);}};
async function status(){const data=await api('/whatsapp/status');$('wa-status').textContent=({connected:'Conectado ao WhatsApp.',connecting:'Preparando conexão…',qr:'Escaneie no WhatsApp em Aparelhos conectados.',disconnected:'Desconectado. Clique em conectar.'})[data.state]||'Estado indisponível';$('wa-qr').hidden=!data.qr;if(data.qr)$('wa-qr').src=data.qr;if(data.state==='connected')clearInterval(qrTimer);}
$('wa-connect').onclick=async()=>{try{await api('/whatsapp/connect','POST');await status();clearInterval(qrTimer);qrTimer=setInterval(()=>status().catch(()=>{clearInterval(qrTimer);notify('Serviço WhatsApp indisponível.');}),3000);}catch(e){notify(e.message);}};
if(token)enter().catch(()=>{token='';sessionStorage.removeItem('admin-token');});


setInterval(()=>{if(token && !$('dashboard').hidden && document.visibilityState==='visible')refresh().catch(()=>{});},30000);
window.addEventListener('focus',()=>{if(token && !$('dashboard').hidden)refresh().catch(()=>{});});
