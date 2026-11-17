import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import worker from '../src/index.mjs';
import {Database} from '../src/database.mjs';
const key=btoa(String.fromCharCode(...new Uint8Array(32)));
test('API protege dados, cadastra e lista conta, turma e destino sem revelar segredos', async () => {
  const env={DB:new Database(':memory:'), ADMIN_TOKEN:'secret', ENCRYPTION_KEY:key};
  const call=(path,method='GET',body,auth='secret')=>worker.fetch(new Request(`http://localhost/api${path}`,{method,headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
  assert.equal((await call('/accounts','GET',null,'wrong')).status,401);
  assert.equal((await call('/accounts','POST',{id:'A',username:'123456789012',password:'senha-ficticia'})).status,201);
  assert.equal((await call('/watches','POST',{id:'W',account_id:'A',subject:'Mecânica Técnica',subject_code:'FEN03-05787',class_code:'4'})).status,201);
  assert.equal((await call('/destinations','POST',{id:'D',account_id:'A',kind:'discord',config:{webhook:'https://discord.com/api/webhooks/123/token'}})).status,201);
  assert.equal((await call('/destinations','POST',{id:'bad',account_id:'A',kind:'discord',config:{webhook:'https://evil.example/'}})).status,400);
  assert.deepEqual(await (await call('/accounts')).json(),[{id:'A'}]);
  assert.deepEqual(await (await call('/destinations')).json(),[{id:'D',account_id:'A',kind:'discord'}]);
  assert.ok(!JSON.stringify(env.DB.db.prepare('SELECT * FROM accounts').get()).includes('senha-ficticia'));
});
