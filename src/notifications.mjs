import {bridgeFetch} from './bridge.mjs';
function required(condition, message) { if (!condition) throw new Error(message); }
function base64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
export async function deliver(kind, config, watch, env, send = fetch) {
  const available = watch.availability === 'open';
  const message = watch.test
    ? `Teste de notificação para ${watch.subject}, turma ${watch.class_code}.`
    : `${available ? 'Vaga disponível' : 'Vaga indisponível'} em ${watch.subject}, turma ${watch.class_code}. Confira no Aluno Online: https://www.alunoonline.uerj.br/`;
  let image;
  if (watch.availability === 'open' || watch.availability === 'closed') {
    const response = await env.ASSETS.fetch(new Request(`https://assets.local/status-${watch.availability}.jpg`));
    if (!response.ok) throw new Error('Imagem de disponibilidade não encontrada');
    image = new Uint8Array(await response.arrayBuffer());
  }
  let url, options;
  if (kind === 'discord') {
    const parsed = new URL(config.webhook);
    required(parsed.protocol === 'https:' && parsed.hostname === 'discord.com' && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(parsed.pathname) && !parsed.search, 'Webhook Discord inválido');
    url = parsed.href;
    if (image) {
      const payload = {content: message, allowed_mentions: {parse: []}, embeds: [{image:{url:'attachment://disponibilidade.jpg'}}]};
      const form = new FormData();
      form.set('payload_json', JSON.stringify(payload));
      form.set('files[0]', new Blob([image], {type:'image/jpeg'}), 'disponibilidade.jpg');
      options = {method:'POST', body:form};
    } else {
      options = { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({content: message, allowed_mentions: {parse: []}}) };
    }
  } else if (kind === 'phone') {
    required(typeof config.topic === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(config.topic), 'Tópico ntfy inválido');
    url = `https://ntfy.sh/${config.topic}`;
    options = image
      ? {method:'POST', headers:{'Content-Type':'image/jpeg','Filename':'disponibilidade.jpg','X-Title':available?'Vaga disponível':'Vaga indisponível','X-Message':message}, body:image}
      : {method: 'POST', headers: {'Content-Type': 'text/plain; charset=utf-8'}, body: message};
  } else if (kind === 'whatsapp') {
    required(/^\d{8,15}$/.test(config.phone || ''), 'Número WhatsApp inválido');
    await bridgeFetch(env, '/send', 'POST', {phone:config.phone, text:message, image:image?.byteLength ? base64(image) : undefined});
    return;
  } else throw new Error('Canal desconhecido');
  const response = await send(url, options);
  if (!response.ok) throw new Error(`Falha de entrega ${kind}: HTTP ${response.status}`);
}


