import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {seal, unseal} from '../src/crypto.mjs';
import {deliver} from '../src/notifications.mjs';

test('dados cifrados podem ser lidos apenas com a chave correta', async () => {
  const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const other = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const value = await seal({password:'teste'}, key);
  assert.ok(!value.includes('teste'));
  assert.deepEqual(await unseal(value,key), {password:'teste'});
  await assert.rejects(unseal(value, other));
});
test('Discord recebe mensagem sem menções e URLs arbitrárias são rejeitadas', async () => {
  let body;
  await deliver('discord', {webhook:'https://discord.com/api/webhooks/123/abc'}, {subject:'Cálculo', class_code:'01'}, {}, async (_url, options) => {body=JSON.parse(options.body); return {ok:true};});
  assert.deepEqual(body.allowed_mentions, {parse:[]});
  assert.match(body.content, /Cálculo/);
  await assert.rejects(deliver('discord', {webhook:'https://example.org/api/webhooks/123/abc'}, {}, {}, async () => ({ok:true})));
});
test('falha de entrega é propagada para nova tentativa', async () => {
  await assert.rejects(deliver('phone', {topic:'abcdefgh12345678'}, {subject:'A', class_code:'1'}, {}, async () => ({ok:false,status:503})), /503/);
});
