export async function bridgeFetch(env, path, method='GET', body) {
  const url = new URL(env.WHATSAPP_BRIDGE_URL || '');
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'whatsapp')) || url.username || url.password || url.search || url.hash || !env.WHATSAPP_BRIDGE_TOKEN) throw new Error('Serviço WhatsApp não configurado');
  const response = await fetch(new URL(path,url.origin), {method,headers:{Authorization:`Bearer ${env.WHATSAPP_BRIDGE_TOKEN}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});
  if (!response.ok) throw new Error('Serviço WhatsApp indisponível');
  return response.json();
}

