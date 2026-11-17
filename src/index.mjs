import { seal, unseal } from './crypto.mjs';
import { transition } from './transition.mjs';
import { observeUerj } from './uerj.mjs';
import { deliver } from './notifications.mjs';
import { bridgeFetch } from './bridge.mjs';

const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
let activeRun;
function authorized(request, secret) {
  const a = new TextEncoder().encode(request.headers.get('Authorization') || '');
  const b = new TextEncoder().encode(`Bearer ${secret || ''}`);
  if (!secret || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function str(value, max = 200) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
async function api(request, env) {
  if (!authorized(request, env.ADMIN_TOKEN)) return json({error:'Não autorizado'}, 401);
  const path = new URL(request.url).pathname.replace(/^\/api(?=\/)/, '');
  if (request.method === 'GET' && path === '/accounts') { const r = await env.DB.prepare('SELECT id FROM accounts ORDER BY id').all(); return json(r.results); }
  if (request.method === 'GET' && path === '/destinations') { const r = await env.DB.prepare('SELECT id, account_id, kind FROM destinations ORDER BY id').all(); return json(r.results); }
  if (request.method === 'GET' && path === '/whatsapp/status') return json(await bridgeFetch(env, '/status'));
  if (request.method === 'POST' && path === '/whatsapp/connect') return json(await bridgeFetch(env, '/connect', 'POST')); 
  if (request.method === 'GET' && path === '/watches') {
    const result = await env.DB.prepare('SELECT id, account_id, subject, subject_code, class_code, state, last_error, checked_at FROM watches ORDER BY id').all();
    return json(result.results);
  }
  if (request.method === 'DELETE' && path.startsWith('/destinations/')) {
    const id = decodeURIComponent(path.slice('/destinations/'.length));
    if (!str(id)) return json({error:'Destino inválido'}, 400);
    const item = await env.DB.prepare('SELECT id FROM destinations WHERE id=?').bind(id).first();
    if (!item) return json({error:'Destino não encontrado'}, 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM deliveries WHERE destination_id=?').bind(id),
      env.DB.prepare('DELETE FROM destinations WHERE id=?').bind(id)
    ]);
    return json({ok:true});
  }
  if (request.method === 'DELETE' && path.startsWith('/watches/')) {
    let id;
    try { id = decodeURIComponent(path.slice('/watches/'.length)); } catch { return json({error:'Turma inválida'}, 400); }
    if (!str(id)) return json({error:'Turma inválida'}, 400);
    const item = await env.DB.prepare('SELECT id FROM watches WHERE id=?').bind(id).first();
    if (!item) return json({error:'Turma não encontrada'}, 404);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM deliveries WHERE watch_id=?').bind(id),
      env.DB.prepare('DELETE FROM watches WHERE id=?').bind(id)
    ]);
    return json({ok:true});
  }
  if (request.method === 'POST' && path === '/run') return json({ok:true, ...await run(env)});
  if (request.method !== 'POST') return json({error:'Não encontrado'}, 404);
  let data; try { data = await request.json(); } catch { return json({error:'JSON inválido'}, 400); }
  if (path === '/accounts') {
    if (!str(data.id, 100) || !/^\d{12}$/.test(data.username || '') || !str(data.password, 500)) return json({error:'Informe id, username e password'}, 400);
    const credentials = await seal({username:data.username, password:data.password}, env.ENCRYPTION_KEY);
    await env.DB.prepare('INSERT INTO accounts (id, credentials) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET credentials=excluded.credentials').bind(data.id, credentials).run();
    return json({ok:true}, 201);
  }
  if (path === '/watches') {
    if (![data.id,data.account_id,data.subject,data.subject_code,data.class_code].every(v => str(v)) || !/^[A-Z]{3}\d{2}-\d{5}$/i.test(data.subject_code || '') || !/^\d+$/.test(data.class_code || '')) return json({error:'Informe id, account_id, subject, subject_code e class_code'}, 400);
    await env.DB.prepare('INSERT INTO watches (id, account_id, subject, subject_code, class_code) VALUES (?, ?, ?, ?, ?)').bind(data.id,data.account_id,data.subject,data.subject_code,data.class_code).run();
    return json({ok:true}, 201);
  }
  if (path === '/destinations/test') {
    if (!str(data.id)) return json({error:'Destino inválido'}, 400);
    const item = await env.DB.prepare('SELECT kind, config, account_id FROM destinations WHERE id=?').bind(data.id).first();
    if (!item) return json({error:'Destino não encontrado'}, 404);
    await deliver(item.kind, await unseal(item.config, env.ENCRYPTION_KEY), {subject:`${item.account_id || 'Conta não vinculada'} · todas as matérias`,class_code:'teste',test:true}, env);
    return json({ok:true});
  }
  if (path === '/destinations/assign') {
    if (!str(data.id) || !str(data.account_id)) return json({error:'Selecione uma conta de aluno'}, 400);
    const account = await env.DB.prepare('SELECT id FROM accounts WHERE id=?').bind(data.account_id).first();
    if (!account) return json({error:'Conta de aluno não encontrada'}, 404);
    const result = await env.DB.prepare('UPDATE destinations SET account_id=? WHERE id=?').bind(data.account_id,data.id).run();
    if (!result.changes) return json({error:'Destino não encontrado'}, 404);
    return json({ok:true});
  }
  if (path === '/destinations') {
    if (!str(data.id) || !str(data.account_id) || !['discord','phone','whatsapp'].includes(data.kind) || !data.config || typeof data.config !== 'object') return json({error:'Selecione uma conta e informe um destino válido'}, 400);
    const account = await env.DB.prepare('SELECT id FROM accounts WHERE id=?').bind(data.account_id).first();
    if (!account) return json({error:'Conta de aluno não encontrada'}, 404);
    if (data.kind === 'discord') {
      try { const u = new URL(data.config.webhook); if (u.protocol !== 'https:' || u.hostname !== 'discord.com' || u.port || u.username || u.password || u.search || u.hash || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname)) throw new Error(); } catch { return json({error:'Webhook Discord inválido'}, 400); }
    }
    if (data.kind === 'phone') {
      if (typeof data.config.topic !== 'string') return json({error:'Tópico ntfy inválido'}, 400);
      data.config.topic = data.config.topic.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(data.config.topic)) return json({error:'Tópico ntfy inválido'}, 400);
    }
    if (data.kind === 'whatsapp' && !/^\d{8,15}$/.test(data.config.phone || '')) return json({error:'Número WhatsApp inválido'}, 400);
    const config = await seal(data.config, env.ENCRYPTION_KEY);
    await env.DB.prepare('INSERT INTO destinations (id, account_id, kind, config) VALUES (?, ?, ?, ?)').bind(data.id,data.account_id,data.kind,config).run();
    return json({ok:true}, 201);
  }
  return json({error:'Não encontrado'}, 404);
}
async function executeRun(env, observe) {
  const summary = {checked:0, queryErrors:0, changed:0, queued:0, sent:0, deliveryErrors:0};
  const watches = await env.DB.prepare('SELECT w.*, a.credentials FROM watches w JOIN accounts a ON a.id=w.account_id').all();
  for (const watch of watches.results) {
    try {
      const observation = await observe(await unseal(watch.credentials, env.ENCRYPTION_KEY), watch);
      const result = transition(watch.state, observation);
      if (observation.status === 'error') throw new Error('Falha na consulta UERJ');
      let queuedForWatch = 0;
      const commands = [env.DB.prepare("UPDATE watches SET state=?, last_error=NULL, checked_at=datetime('now') WHERE id=?").bind(result.state, watch.id)];
      if (result.notify) {
        const destinations = await env.DB.prepare('SELECT id FROM destinations WHERE account_id=?').bind(watch.account_id).all();
        for (const dest of destinations.results) commands.push(env.DB.prepare("INSERT INTO deliveries (id,destination_id,watch_id,availability,created_at) VALUES (?,?,?,?,datetime('now'))").bind(crypto.randomUUID(),dest.id,watch.id,result.state));
        queuedForWatch = destinations.results.length;
      }
      await env.DB.batch(commands);
      summary.checked++;
      if (result.notify) summary.changed++;
      summary.queued += queuedForWatch;
    } catch (error) {
      summary.queryErrors++;
      console.error('[rastreamento] Falha ao consultar turma', {subject_code:watch.subject_code,class_code:watch.class_code,error:error?.message || String(error)});
      await env.DB.prepare("UPDATE watches SET last_error='Falha na consulta; consulte a configuração e a integração UERJ', checked_at=datetime('now') WHERE id=?").bind(watch.id).run();
    }
  }
  const pending = await env.DB.prepare("SELECT d.id, d.destination_id, d.availability, t.kind, t.config, w.subject, w.class_code FROM deliveries d JOIN destinations t ON t.id=d.destination_id JOIN watches w ON w.id=d.watch_id WHERE d.status='pending' LIMIT 100").all();
  for (const item of pending.results) {
    try {
      await deliver(item.kind, await unseal(item.config, env.ENCRYPTION_KEY), item, env);
      await env.DB.prepare("UPDATE deliveries SET status='sent', attempts=attempts+1, last_error=NULL WHERE id=?").bind(item.id).run();
      summary.sent++;
    } catch (error) {
      summary.deliveryErrors++;
      console.error('[notificações] Falha ao enviar entrega', {kind:item.kind,delivery_id:item.id,error:error?.message || String(error)});
      await env.DB.prepare("UPDATE deliveries SET attempts=attempts+1, last_error='Falha no envio' WHERE id=?").bind(item.id).run();
    }
  }
  return summary;
}
export async function run(env, observe = observeUerj) {
  if (activeRun) return activeRun;
  activeRun = executeRun(env, observe);
  try { return await activeRun; }
  finally { activeRun = undefined; }
}
export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try { return await api(request, env); }
    catch (error) {
      console.error('[api] Falha ao atender requisição', {method:request.method,path:new URL(request.url).pathname,error:error?.stack || error?.message || String(error)});
      return json({error:'Operação indisponível. Verifique a configuração.'}, 500);
    }
  },
  async scheduled(_event, env, context) { context.waitUntil(run(env)); }
};





