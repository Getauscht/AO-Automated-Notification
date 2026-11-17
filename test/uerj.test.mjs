import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {observeUerj} from '../src/uerj.mjs';
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${value}">`;
const page = body => new Response(body,{headers:{'content-type':'text/html; charset=utf-8','set-cookie':'PHPSESSID=test; Path=/'}});
test('executa a navegação observada, preserva cookies e lê vagas atualizadas', async () => {
  const replies = [
    'entrada',
    `<form name='form'>${hidden('_token','token1')}${hidden('requisicao','login')}</form>`,
    `<form name='formulario'>${hidden('_token','token2')}${hidden('flg_logado','1')}</form><a onclick="executaMenu(0, 'abcd1234', 0, '', this);">Disciplinas do Currículo/A Cursar</a>`,
    `<form name='output'>${hidden('_token','token3')}${hidden('requisicao','consulta')}${hidden('matricula','123456789012')}</form><a onclick="consultarDisciplina(output, 5787);">FEN03-05787 Mecânica Técnica</a>`,
    `<div><b>Disciplina:</b> FEN03-05787 Mecânica Técnica <a>Ementa</a></div><div><b>TURMA:</b> 4<table><caption>Vagas Atualizadas da Turma</caption><tr><td>Tipo de Vaga</td><td>Oferecidas</td><td>Ocupadas</td></tr><tr><td>UERJ</td><td>30</td><td>29</td></tr></table></div>`
  ];
  const calls = [];
  const result = await observeUerj({username:'123456789012',password:'senha fictícia'}, {subject_code:'FEN03-05787',class_code:'4'}, async (url, options) => {calls.push({url,options}); return page(replies.shift());});
  assert.deepEqual(result,{status:'open',offered:30,occupied:29});
  assert.equal(calls.length,5);
  assert.match(calls[1].options.headers.Cookie,/PHPSESSID=test/);
  assert.equal(new URLSearchParams(calls[2].options.body).get('senha'),'senha fictícia');
  assert.equal(new URLSearchParams(calls[3].options.body).get('requisicao'),'abcd1234');
  assert.equal(new URLSearchParams(calls[4].options.body).get('disciplinas[0]'),'5787');
});
test('login mal sucedido não se converte em turma fechada', async () => {
  let i=0;
  await assert.rejects(observeUerj({username:'123456789012',password:'invalida'}, {subject_code:'FEN03-05787',class_code:'4'}, async () => page(['home',`<form name='form'>${hidden('_token','x')}${hidden('requisicao','x')}</form>`,'senha incorreta'][i++])));
});
