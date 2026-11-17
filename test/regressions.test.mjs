import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Database} from '../src/database.mjs';
import worker, {run} from '../src/index.mjs';
import {validateEncryptionKey} from '../src/crypto.mjs';
import {deliver} from '../src/notifications.mjs';
import {createUerjSession} from '../src/uerj.mjs';

const key = btoa(String.fromCharCode(...new Uint8Array(32)));
const auth = {'Authorization':'Bearer secret','Content-Type':'application/json'};
const env = () => ({DB:new Database(':memory:'), ADMIN_TOKEN:'secret', ENCRYPTION_KEY:key});
async function call(e, path, method='GET', body) {
  const options = {method,headers:auth};
  if (body !== undefined) options.body=JSON.stringify(body);
  return worker.fetch(new Request(`http://localhost/api${path}`,options),e);
}
async function account(e) {assert.equal((await call(e,'/accounts','POST',{id:'A',username:'123456789012',password:'senha'})).status,201);}
async function watch(e,id='W',classCode='4') {
  return call(e,'/watches','POST',{id,account_id:'A',subject:'Mecânica Técnica',subject_code:'FEN03-05787',class_code:classCode});
}
async function destination(e,id='D') {
  return call(e,'/destinations','POST',{id,account_id:'A',kind:'phone',config:{topic:'topico-longo-aleatorio-123456'}});
}
const open = async () => ({status:'open'});
const closed = async () => ({status:'closed'});

test('JSON null ou array retorna 400, conta inexistente retorna 404 e turma duplicada retorna 409', async () => {
  const e=env();
  assert.equal((await call(e,'/accounts','POST',null)).status,400);
  assert.equal((await call(e,'/accounts','POST',[])).status,400);
  assert.equal((await watch(e)).status,404);
  await account(e);
  assert.equal((await watch(e)).status,201);
  assert.equal((await watch(e,'W2','004')).status,409);
  const duplicate = await call(e,'/watches','POST',{id:'W3',account_id:'A',subject:'Mecânica Técnica',subject_code:'fen03-05787',class_code:'4'});
  assert.equal(duplicate.status,409);
});

test('destino novo recebe estado aberto preexistente sem repetir na próxima consulta', async () => {
  const e=env();await account(e);assert.equal((await watch(e)).status,201);
  const first=await run(e,open,async()=>{throw Error('não deveria enviar sem destino');});
  assert.equal(first.changed,1);assert.equal(first.queued,0);
  assert.equal((await destination(e)).status,201);
  let sent=0;
  const next=await run(e,open,async()=>{sent++;});
  assert.equal(sent,1);assert.equal(next.sent,1);assert.equal(next.changed,0);
  const again=await run(e,open,async()=>{sent++;});
  assert.equal(again.queued,0);assert.equal(sent,1);
});

test('alerta de abertura com erro de entrega vira obsoleto quando turma fecha', async () => {
  const e=env();await account(e);await watch(e);await destination(e);
  const fail=await run(e,open,async()=>{throw Error('503 simulado');});
  assert.equal(fail.deliveryErrors,1);
  assert.equal((await e.DB.prepare("SELECT status FROM deliveries WHERE watch_id='W'").first()).status,'pending');
  let sent=0;
  const close=await run(e,closed,async()=>{sent++;});
  assert.equal(close.changed,0);assert.equal(sent,0);
  assert.equal((await e.DB.prepare("SELECT status FROM deliveries WHERE watch_id='W'").first()).status,'obsolete');
  const reopen=await run(e,open,async()=>{sent++;});
  assert.equal(reopen.sent,1);assert.equal(sent,1);
  const statuses=(await e.DB.prepare('SELECT status FROM deliveries ORDER BY rowid').all()).results.map(x=>x.status);
  assert.deepEqual(statuses,['obsolete','sent']);
});

test('erro de consulta não libera envio até nova observação válida', async () => {
  const e=env();await account(e);await watch(e);await destination(e);
  await run(e,open,async()=>{throw Error('indisponível');});
  let sent=0;
  const error=await run(e,async()=>{throw Error('UERJ fora');},async()=>{sent++;});
  assert.equal(error.queryErrors,1);assert.equal(sent,0);
  await e.DB.prepare("UPDATE deliveries SET next_attempt_at=datetime('now','-1 minute') WHERE status='pending'").run();
  const recovered=await run(e,open,async()=>{sent++;});
  assert.equal(recovered.sent,1);assert.equal(sent,1);
});

test('backoff crescente e limite de seis tentativas deixam entrega failed', async () => {
  const e=env();await account(e);await watch(e);await destination(e);
  for(let i=1;i<=6;i++) {
    const result=await run(e,open,async()=>{throw Error('serviço indisponível');});
    assert.equal(result.deliveryErrors,1);
    const item=await e.DB.prepare('SELECT attempts,status,next_attempt_at FROM deliveries').first();
    assert.equal(item.attempts,i);
    assert.equal(item.status,i===6?'failed':'pending');
    if(i<6) {
      assert.ok(item.next_attempt_at);
      await e.DB.prepare("UPDATE deliveries SET next_attempt_at=datetime('now','-1 minute') WHERE status='pending'").run();
    } else assert.equal(item.next_attempt_at,null);
  }
  let attempts=0;
  const done=await run(e,open,async()=>{attempts++;});
  assert.equal(attempts,0);assert.equal(done.sent,0);
  const status=await (await call(e,'/status')).json();
  assert.equal(status.deliveries.failed,1);
  assert.equal(status.last_summary.deliveryErrors,0);
  assert.ok(status.last_finished_at);
  const log=await (await call(e,'/deliveries')).json();
  assert.equal(log[0].status,'failed');
  assert.ok(!JSON.stringify(log).includes('topico-longo'));
});

test('destino reassociado invalida mensagens anteriores e enfileira estado da conta nova', async()=>{
  const e=env();await account(e);await watch(e);
  await call(e,'/accounts','POST',{id:'B',username:'123456789012',password:'senha'});
  await call(e,'/watches','POST',{id:'WB',account_id:'B',subject:'Análise',subject_code:'FEN03-05788',class_code:'6'});
  await destination(e);
  await run(e,async(_,w)=> w.id==='WB'?{status:'open'}:{status:'closed'},async()=>{});
  const r=await call(e,'/destinations/assign','POST',{id:'D',account_id:'B'});
  assert.equal(r.status,200);
  const pending=await e.DB.prepare("SELECT d.status,d.watch_id FROM deliveries d WHERE d.destination_id='D'").all();
  assert.deepEqual(pending.results.map(x=>[x.watch_id,x.status]),[['WB','pending']]);
});

test('migração preserva histórico e consolida turmas previamente duplicadas',()=>{
  const dir=mkdtempSync(join(tmpdir(),'uerj-vagas-'));
  const path=join(dir,'vagas.sqlite');
  try {
    const old=new DatabaseSync(path);
    old.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,credentials TEXT NOT NULL);
      CREATE TABLE watches(id TEXT PRIMARY KEY,account_id TEXT,subject TEXT,subject_code TEXT,class_code TEXT,state TEXT,last_error TEXT,checked_at TEXT);
      CREATE TABLE destinations(id TEXT PRIMARY KEY,account_id TEXT,kind TEXT,config TEXT);
      CREATE TABLE deliveries(id TEXT PRIMARY KEY,destination_id TEXT,watch_id TEXT,availability TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,last_error TEXT,created_at TEXT);`);
    old.exec(`INSERT INTO accounts VALUES ('A','cipher');
      INSERT INTO watches VALUES('W1','A','Disciplina','FEN03-05787','4','closed',NULL,'2026-11-01 00:00:00');
      INSERT INTO watches VALUES('W2','A','Disciplina','fen03-05787','04','open',NULL,'2026-11-02 00:00:00');
      INSERT INTO destinations VALUES ('D','A','phone','cipher');
      INSERT INTO deliveries VALUES('E','D','W1','open','sent',1,NULL,'2026-11-01 00:00:00');`);
    old.close();
    const db=new Database(path);
    const watches=db.db.prepare('SELECT id,state FROM watches').all();
    assert.deepEqual(watches.map(w=>({id:w.id,state:w.state})),[{id:'W2',state:'open'}]);
    assert.equal(db.db.prepare("SELECT watch_id FROM deliveries WHERE id='E'").get().watch_id,'W2');
    assert.equal(db.db.prepare('PRAGMA foreign_key_check').all().length,0);
    db.db.close();
    const again=new Database(path);
    assert.equal(again.db.prepare('SELECT COUNT(*) AS count FROM watches').get().count,1);
    again.db.close();
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('chave de criptografia rejeita formato inválido antes da inicialização',()=>{
  assert.equal(validateEncryptionKey(key).length,32);
  assert.throws(()=>validateEncryptionKey('x'.repeat(44)));
  assert.throws(()=>validateEncryptionKey('curta'));
});

test('ntfy usa cabeçalhos ASCII válidos para texto em português e timeout na requisição',async()=>{
  let options;
  const assets={fetch:async()=>new Response(Uint8Array.from([255,216,255,0]),{status:200})};
  await deliver('phone',{topic:'topico-seguro'}, {subject:'Mecânica Técnica',class_code:'4',availability:'open'}, {ASSETS:assets},async(_url,o)=>{options=o;return new Response('ok');});
  assert.match(options.headers['X-Title'],/^=\?UTF-8\?B\?/);
  assert.match(options.headers['X-Message'],/^=\?UTF-8\?B\?/);
  assert.ok([...options.headers['X-Message']].every(c=>c.charCodeAt(0)<=127));
  assert.ok(options.signal instanceof AbortSignal);
});

test('UERJ aceita redirecionamento interno e bloqueia redirecionamento externo',async()=>{
  let requests=0;
  const redirect=()=>new Response('',{status:302,headers:{location:'/requisicaoaluno/'}});
  await assert.rejects(createUerjSession({username:'123456789012',password:'senha'},async(url)=>{
    requests++;
    if(requests===1)return redirect();
    return new Response('sem form',{headers:{'content-type':'text/html; charset=utf-8'}});
  }), /Formulário/);
  assert.equal(requests,3);
  let externalRequests=0;
  await assert.rejects(createUerjSession({username:'123456789012',password:'senha'},async()=>{
    externalRequests++;
    return new Response('',{status:302,headers:{location:'https://attacker.example/steal'}});
  }),/externo bloqueado/);
  assert.equal(externalRequests,1);
});

test('reenvio manual só libera entrega failed quando a vaga ainda está aberta',async()=>{
  const e=env();await account(e);await watch(e);await destination(e);
  await run(e,open,async()=>{throw Error('simular falha');});
  const {id}=await e.DB.prepare('SELECT id FROM deliveries').first();
  assert.equal((await call(e,'/deliveries/retry','POST',{id})).status,409);
  await e.DB.prepare("UPDATE deliveries SET status='failed',attempts=6,next_attempt_at=NULL WHERE id=?").bind(id).run();
  assert.equal((await call(e,'/deliveries/retry','POST',{id})).status,200);
  assert.equal((await e.DB.prepare('SELECT status,attempts FROM deliveries WHERE id=?').bind(id).first()).attempts,0);
  await run(e,closed,async()=>{});
  assert.equal((await call(e,'/deliveries/retry','POST',{id})).status,409);
});

test('várias turmas reutilizam um único login e uma listagem por conta',async()=>{
  const h=(name,value)=>`<input type="hidden" name="${name}" value="${value}">`;
  const body=html=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});
  const page=(code,number)=>`<div><b>Disciplina:</b> ${code} Nome <a>Ementa</a></div><div><b>TURMA:</b> ${number}<table><tr><td>Tipo de Vaga</td><td>Oferecidas</td><td>Ocupadas</td></tr><tr><td>UERJ</td><td>30</td><td>29</td></tr></table><table><tr><td>Vagas para Solicitação de Inscrição</td></tr><tr><td>UERJ</td><td>30</td><td>60</td></tr></table></div>`;
  const responses=[
    'home',
    `<form name="form">${h('_token','t')}${h('requisicao','login')}</form>`,
    `<form name="formulario">${h('_token','t')}</form><a onclick="executaMenu(0, 'abcd1234', 0, '', this);">Disciplinas do Currículo/A Cursar</a>`,
    `<form name="output">${h('_token','t')}${h('requisicao','list')}</form><a onclick="consultarDisciplina(output, 5787);">FEN03-05787 Nome</a><a onclick="consultarDisciplina(output, 5788);">FEN03-05788 Nome</a>`,
    page('FEN03-05787','4'),
    page('FEN03-05788','5')
  ];
  let calls=0;
  const session=await createUerjSession({username:'123456789012',password:'senha'},async()=>{calls++;return body(responses.shift());});
  const first=await session.observe({subject_code:'FEN03-05787',class_code:'4'});
  const second=await session.observe({subject_code:'FEN03-05788',class_code:'5'});
  assert.equal(first.status,'open');assert.equal(second.status,'open');
  assert.equal(calls,6,'4 requisições de autenticação/listagem + 2 detalhes');
});
