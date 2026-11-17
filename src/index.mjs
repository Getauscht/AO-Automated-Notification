import {seal, unseal} from './crypto.mjs';
import {transition} from './transition.mjs';
import {observeUerj, createUerjSession} from './uerj.mjs';
import {deliver} from './notifications.mjs';
import {bridgeFetch} from './bridge.mjs';

const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store'}});
const activeRuns = new WeakMap();
const MAX_ATTEMPTS = 6;
const MAX_ACCOUNTS_PARALLEL = 3;
const MAX_DELIVERIES_PARALLEL = 8;
function authorized(request, secret) {
  const a = new TextEncoder().encode(request.headers.get('Authorization') || '');
  const b = new TextEncoder().encode(`Bearer ${secret || ''}`);
  if (!secret || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
const str = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const queue = (db, destinationId, watchId) => db.prepare(
  "INSERT INTO deliveries(id,destination_id,watch_id,availability,created_at,next_attempt_at) VALUES (?,?,?,'open',datetime('now'),datetime('now'))"
).bind(crypto.randomUUID(), destinationId, watchId);

async function queueCurrentOpen(db, accountId, destinationId) {
  const {results} = await db.prepare("SELECT id FROM watches WHERE account_id=? AND state='open' AND last_error IS NULL AND checked_at IS NOT NULL").bind(accountId).all();
  return results.map(w => queue(db, destinationId, w.id));
}
async function monitorStatus(env) {
  const [status, counts] = await Promise.all([
    env.DB.prepare('SELECT started_at, finished_at, last_error, last_summary FROM monitor_status WHERE id=1').first(),
    env.DB.prepare(`SELECT
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='obsolete' THEN 1 ELSE 0 END) AS obsolete
      FROM deliveries`).first()
  ]);
  return {
    running:activeRuns.has(env.DB),
    last_started_at:status?.started_at || null,
    last_finished_at:status?.finished_at || null,
    last_error:status?.last_error || null,
    last_summary:status?.last_summary ? JSON.parse(status.last_summary) : null,
    next_run_at:env.MONITOR_SCHEDULE?.nextAt || null,
    deliveries:Object.fromEntries(Object.entries(counts || {}).map(([k,v]) => [k, v || 0]))
  };
}
async function api(request, env) {
  if (!authorized(request, env.ADMIN_TOKEN)) return json({error:'Não autorizado'}, 401);
  const path = new URL(request.url).pathname.replace(/^\/api(?=\/)/, '');
  if (request.method === 'GET' && path === '/status') return json(await monitorStatus(env));
  if (request.method === 'GET' && path === '/accounts') {
    const {results} = await env.DB.prepare('SELECT id FROM accounts ORDER BY id').all();
    return json(results);
  }
  if (request.method === 'GET' && path === '/destinations') {
    const {results} = await env.DB.prepare('SELECT id, account_id, kind FROM destinations ORDER BY id').all();
    return json(results);
  }
  if (request.method === 'GET' && path === '/deliveries') {
    const {results} = await env.DB.prepare(`SELECT d.id, t.kind, d.watch_id, w.subject, w.class_code,
      d.status, d.attempts, d.last_error, d.created_at, d.next_attempt_at
      FROM deliveries d JOIN destinations t ON t.id=d.destination_id
      JOIN watches w ON w.id=d.watch_id
      ORDER BY d.created_at DESC, d.rowid DESC LIMIT 50`).all();
    return json(results);
  }
  if (request.method === 'GET' && path === '/whatsapp/status') return json(await bridgeFetch(env, '/status'));
  if (request.method === 'POST' && path === '/whatsapp/connect') return json(await bridgeFetch(env, '/connect', 'POST'));
  if (request.method === 'GET' && path === '/watches') {
    const {results} = await env.DB.prepare('SELECT id, account_id, subject, subject_code, class_code, state, last_error, checked_at FROM watches ORDER BY id').all();
    return json(results);
  }
  if (request.method === 'DELETE' && path.startsWith('/destinations/')) {
    let id;
    try { id = decodeURIComponent(path.slice('/destinations/'.length)); } catch { return json({error:'Destino inválido'}, 400); }
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
  let data;
  try { data = await request.json(); } catch { return json({error:'JSON inválido'}, 400); }
  if (!validObject(data)) return json({error:'Corpo JSON deve ser um objeto'}, 400);
  if (path === '/deliveries/retry') {
    if (!str(data.id)) return json({error:'Entrega inválida'},400);
    const item = await env.DB.prepare(`SELECT d.status,w.state,w.last_error,t.account_id,w.account_id AS watch_account
      FROM deliveries d JOIN watches w ON w.id=d.watch_id
      JOIN destinations t ON t.id=d.destination_id WHERE d.id=?`).bind(data.id).first();
    if (!item) return json({error:'Entrega não encontrada'},404);
    if (item.status !== 'failed' || item.state !== 'open' || item.last_error || item.account_id !== item.watch_account) {
      return json({error:'Somente entregas falhadas de turmas atualmente abertas podem ser reenviadas'},409);
    }
    await env.DB.prepare("UPDATE deliveries SET status='pending',attempts=0,last_error=NULL,next_attempt_at=datetime('now') WHERE id=?").bind(data.id).run();
    return json({ok:true});
  }
  if (path === '/accounts') {
    if (!str(data.id, 100) || !/^\d{12}$/.test(data.username || '') || !str(data.password, 500)) return json({error:'Informe id, username e password'}, 400);
    const credentials = await seal({username:data.username, password:data.password}, env.ENCRYPTION_KEY);
    await env.DB.prepare('INSERT INTO accounts (id, credentials) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET credentials=excluded.credentials').bind(data.id, credentials).run();
    return json({ok:true}, 201);
  }
  if (path === '/watches') {
    if (![data.id,data.account_id,data.subject,data.subject_code,data.class_code].every(value => str(value)) ||
      !/^[A-Z]{3}\d{2}-\d{5}$/i.test(data.subject_code || '') || !/^\d{1,4}$/.test(data.class_code || '')) {
      return json({error:'Informe id, account_id, subject, subject_code e class_code'}, 400);
    }
    const account = await env.DB.prepare('SELECT id FROM accounts WHERE id=?').bind(data.account_id).first();
    if (!account) return json({error:'Conta de aluno não encontrada'}, 404);
    const subjectCode = data.subject_code.toUpperCase();
    const classCode = String(Number(data.class_code));
    const duplicate = await env.DB.prepare("SELECT id FROM watches WHERE account_id=? AND UPPER(subject_code)=? AND COALESCE(NULLIF(LTRIM(class_code, '0'), ''), '0')=?").bind(data.account_id,subjectCode,classCode).first();
    if (duplicate) return json({error:'Esta turma já está sendo monitorada nesta conta'}, 409);
    try {
      await env.DB.prepare('INSERT INTO watches (id, account_id, subject, subject_code, class_code) VALUES (?, ?, ?, ?, ?)').bind(data.id,data.account_id,data.subject,subjectCode,classCode).run();
    } catch (error) {
      if (/UNIQUE constraint failed/i.test(error?.message || '')) return json({error:'Esta turma já está sendo monitorada'},409);
      throw error;
    }
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
    const item = await env.DB.prepare('SELECT id, account_id FROM destinations WHERE id=?').bind(data.id).first();
    if (!item) return json({error:'Destino não encontrado'}, 404);
    if (item.account_id !== data.account_id) {
      await env.DB.batch([
        env.DB.prepare("UPDATE deliveries SET status='obsolete', last_error='Destino transferido', next_attempt_at=NULL WHERE destination_id=? AND status='pending'").bind(data.id),
        env.DB.prepare('UPDATE destinations SET account_id=? WHERE id=?').bind(data.account_id,data.id),
        ...await queueCurrentOpen(env.DB,data.account_id,data.id)
      ]);
    }
    return json({ok:true});
  }
  if (path === '/destinations') {
    if (!str(data.id) || !str(data.account_id) || !['discord','phone','whatsapp'].includes(data.kind) || !validObject(data.config)) return json({error:'Selecione uma conta e informe um destino válido'}, 400);
    const account = await env.DB.prepare('SELECT id FROM accounts WHERE id=?').bind(data.account_id).first();
    if (!account) return json({error:'Conta de aluno não encontrada'}, 404);
    if (data.kind === 'discord') {
      try {
        const url = new URL(data.config.webhook);
        if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) throw new Error();
      } catch { return json({error:'Webhook Discord inválido'}, 400); }
    }
    if (data.kind === 'phone') {
      if (typeof data.config.topic !== 'string') return json({error:'Tópico ntfy inválido'}, 400);
      data.config.topic = data.config.topic.trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(data.config.topic)) return json({error:'Tópico ntfy inválido'}, 400);
    }
    if (data.kind === 'whatsapp' && !/^\d{8,15}$/.test(data.config.phone || '')) return json({error:'Número WhatsApp inválido'}, 400);
    const config = await seal(data.config, env.ENCRYPTION_KEY);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO destinations (id, account_id, kind, config) VALUES (?, ?, ?, ?)').bind(data.id,data.account_id,data.kind,config),
      ...await queueCurrentOpen(env.DB,data.account_id,data.id)
    ]);
    return json({ok:true}, 201);
  }
  return json({error:'Não encontrado'}, 404);
}

async function executeRun(env, observe, sender) {
  const summary = {checked:0, queryErrors:0, changed:0, queued:0, sent:0, deliveryErrors:0, obsolete:0, exhausted:0};
  await env.DB.prepare("INSERT INTO monitor_status(id,started_at,finished_at,last_error) VALUES (1,datetime('now'),NULL,NULL) ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at, finished_at=NULL, last_error=NULL").run();
  try {
    const {results:watches} = await env.DB.prepare('SELECT w.*, a.credentials FROM watches w JOIN accounts a ON a.id=w.account_id ORDER BY w.account_id,w.subject_code,w.class_code').all();
    const groups = new Map();
    for (const watch of watches) {
      if (!groups.has(watch.account_id)) groups.set(watch.account_id, []);
      groups.get(watch.account_id).push(watch);
    }
    async function recordError(watch, error) {
      summary.queryErrors++;
      console.error('[rastreamento] Falha ao consultar turma', {subject_code:watch.subject_code,class_code:watch.class_code,error:error?.message || String(error)});
      await env.DB.prepare("UPDATE watches SET last_error='Falha na consulta; verifique integração e credenciais UERJ', checked_at=datetime('now') WHERE id=?").bind(watch.id).run();
    }
    async function processGroup(group) {
      let session;
      try {
        const credentials = await unseal(group[0].credentials, env.ENCRYPTION_KEY);
        session = observe === observeUerj ? await createUerjSession(credentials) : {observe:watch => observe(credentials,watch)};
      } catch (error) {
        for (const watch of group) await recordError(watch,error);
        return;
      }
      for (const watch of group) {
        try {
          const observation = await session.observe(watch);
          if (observation.status === 'error') throw new Error('Falha na consulta UERJ');
          const result = transition(watch.state, observation);
          const commands = [env.DB.prepare("UPDATE watches SET state=?, last_error=NULL, checked_at=datetime('now') WHERE id=?").bind(result.state, watch.id)];
          if (result.state !== 'open') {
            const previousPending = await env.DB.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE watch_id=? AND status='pending'").bind(watch.id).first();
            summary.obsolete += previousPending.count;
            commands.push(env.DB.prepare("UPDATE deliveries SET status='obsolete', last_error='Estado superado', next_attempt_at=NULL WHERE watch_id=? AND status='pending'").bind(watch.id));
          }
          let count = 0;
          if (result.notify) {
            const {results:destinations} = await env.DB.prepare('SELECT id FROM destinations WHERE account_id=?').bind(watch.account_id).all();
            for (const destination of destinations) commands.push(queue(env.DB,destination.id,watch.id));
            count = destinations.length;
          }
          await env.DB.batch(commands);
          summary.checked++;
          if (result.notify) summary.changed++;
          summary.queued += count;
        } catch (error) { await recordError(watch,error); }
      }
    }
    const groupList = [...groups.values()];
    let nextGroup = 0;
    await Promise.all(Array.from({length:Math.min(MAX_ACCOUNTS_PARALLEL, groupList.length)}, async () => {
      while (nextGroup < groupList.length) await processGroup(groupList[nextGroup++]);
    }));

    // Proteção adicional para filas antigas, alterações de conta e tentativas órfãs.
    const stale = await env.DB.prepare(`UPDATE deliveries SET status='obsolete',last_error='Estado superado',next_attempt_at=NULL
      WHERE status='pending' AND (availability IS NOT 'open' OR NOT EXISTS (
        SELECT 1 FROM watches w JOIN destinations t ON t.id=deliveries.destination_id
        WHERE w.id=deliveries.watch_id AND w.state='open' AND t.account_id=w.account_id))`).run();
    summary.obsolete += stale.changes;
    const {results:pending} = await env.DB.prepare(`SELECT d.id, d.destination_id, d.availability, d.attempts,
      t.kind, t.config, w.subject, w.class_code
      FROM deliveries d JOIN destinations t ON t.id=d.destination_id JOIN watches w ON w.id=d.watch_id
      WHERE d.status='pending' AND d.availability='open' AND w.state='open'
        AND w.last_error IS NULL AND t.account_id=w.account_id
        AND datetime(d.next_attempt_at) <= datetime('now')
      ORDER BY d.created_at ASC, d.rowid ASC LIMIT 100`).all();
    // A rede não deve bloquear a rodada inteira: até oito entregas com timeout por requisição.
    let nextDelivery = 0;
    await Promise.all(Array.from({length:Math.min(MAX_DELIVERIES_PARALLEL,pending.length)}, async () => {
      while (nextDelivery < pending.length) {
        const item = pending[nextDelivery++];
        try {
          await sender(item.kind, await unseal(item.config, env.ENCRYPTION_KEY), item, env);
          await env.DB.prepare("UPDATE deliveries SET status='sent',attempts=attempts+1,last_error=NULL,next_attempt_at=NULL WHERE id=?").bind(item.id).run();
          summary.sent++;
        } catch (error) {
          summary.deliveryErrors++;
          console.error('[notificações] Falha ao enviar entrega', {kind:item.kind,delivery_id:item.id,error:error?.message || String(error)});
          const attempts = item.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            summary.exhausted++;
            await env.DB.prepare("UPDATE deliveries SET status='failed',attempts=?,last_error='Limite de tentativas atingido',next_attempt_at=NULL WHERE id=?").bind(attempts,item.id).run();
          } else {
            const minutes = Math.min(15 * 2 ** (attempts - 1), 240);
            await env.DB.prepare("UPDATE deliveries SET attempts=?,last_error='Falha na entrega; nova tentativa agendada',next_attempt_at=datetime('now', ?) WHERE id=?").bind(attempts,`+${minutes} minutes`,item.id).run();
          }
        }
      }
    }));
    await env.DB.prepare("UPDATE monitor_status SET finished_at=datetime('now'), last_error=NULL, last_summary=? WHERE id=1").bind(JSON.stringify(summary)).run();
    return summary;
  } catch (error) {
    await env.DB.prepare("UPDATE monitor_status SET finished_at=datetime('now'),last_error='Falha geral no monitoramento' WHERE id=1").run();
    throw error;
  }
}
export async function run(env, observe = observeUerj, sender = deliver) {
  if (activeRuns.has(env.DB)) return activeRuns.get(env.DB);
  const promise = executeRun(env, observe, sender);
  activeRuns.set(env.DB, promise);
  try { return await promise; }
  finally { activeRuns.delete(env.DB); }
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
