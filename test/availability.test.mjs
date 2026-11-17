import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseAvailability} from '../src/availability.mjs';
const page = (offered, occupied) => `<div><b>Disciplina:</b> FEN03-05787 Mecânica Técnica &nbsp;&nbsp; <a href="#">Ementa</a></div>
<div><b>TURMA: </b> 4 <table><caption>Vagas Atualizadas da Turma</caption><caption></caption><tr><td>Tipo de Vaga</td><td>Oferecidas</td><td>Ocupadas</td></tr><tr><td>UERJ</td><td>${offered}</td><td>${occupied}</td></tr><tr><td>Vestibular</td><td>0</td><td>0</td></tr></table>
<table><caption>Vagas para Solicitação de Inscrição</caption><tr><td>UERJ</td><td>30</td><td>60</td></tr></table></div><div><b>TURMA: </b> 5</div>`;
test('identifica vaga UERJ pelas vagas atualizadas, sem confundir solicitações', () => {
  assert.deepEqual(parseAvailability(page(30,30),'FEN03-05787','4'),{status:'closed',offered:30,occupied:30});
  assert.deepEqual(parseAvailability(page(30,29),'FEN03-05787','4'),{status:'open',offered:30,occupied:29});
});
test('página inesperada e dados incompletos geram erro', () => {
  assert.throws(() => parseAvailability(page(30,30),'FEN03-99999','4'));
  assert.throws(() => parseAvailability(page(30,30),'FEN03-05787','6'));
  assert.throws(() => parseAvailability(page(30,'?'),'FEN03-05787','4'));
  assert.throws(() => parseAvailability('<html>Login</html>','FEN03-05787','4'));
  assert.throws(() => parseAvailability(page(30,30).replace('Vagas Atualizadas da Turma','Outra tabela'),'FEN03-05787','4'));
});

// Situação observada na UERJ: duas tabelas na turma, nenhuma com <caption>.
// A segunda tabela é de solicitações e não pode substituir a de vagas atuais.
const withoutCaptions = (offered, occupied) => `<div><b>Disciplina:</b> QUI07-03865 Química <a>Ementa</a></div>
<div><b>TURMA:</b> 4
<table><tr><td>Tipo de Vaga</td><td>Oferecidas</td><td>Ocupadas</td></tr>
<tr><td>UERJ</td><td>${offered}</td><td>${occupied}</td></tr><tr><td>Vestibular</td><td>5</td><td>5</td></tr></table>
<table><tr><td>Vagas para Solicitação de Inscrição</td></tr>
<tr><td>UERJ</td><td>30</td><td>50</td></tr></table></div><div><b>TURMA:</b> 5</div>`;
test('aceita duas tabelas sem legenda quando uma só possui a estrutura de vagas atualizadas', () => {
  assert.deepEqual(parseAvailability(withoutCaptions(30, 29), 'QUI07-03865', '4'), {status:'open', offered:30, occupied:29});
  assert.deepEqual(parseAvailability(withoutCaptions(30, 30), 'QUI07-03865', '4'), {status:'closed', offered:30, occupied:30});
});
test('não confunde solicitação de inscrição com vagas atualizadas quando a segunda tabela tem legenda', () => {
  const html = withoutCaptions(30, 29).replace('<table><tr><td>Vagas para Solicitação', '<table><caption>Vagas para Solicitação de Inscrição</caption><tr><td>Vagas para Solicitação');
  assert.equal(parseAvailability(html, 'QUI07-03865', '4').status, 'open');
});
test('sem legenda, duas tabelas com estrutura válida são ambíguas e não geram alerta', () => {
  const second = '<table><tr><td>Tipo de Vaga</td><td>Oferecidas</td><td>Ocupadas</td></tr><tr><td>UERJ</td><td>40</td><td>39</td></tr></table>';
  const html = withoutCaptions(30, 30).replace('<table><tr><td>Vagas para Solicitação de Inscrição</td></tr>\n<tr><td>UERJ</td><td>30</td><td>50</td></tr></table>', second);
  assert.throws(() => parseAvailability(html, 'QUI07-03865', '4'), /ausente ou ambígua/);
});
test('tabela sem legenda com números inválidos não é aceita', () => {
  assert.throws(() => parseAvailability(withoutCaptions(30, '?'), 'QUI07-03865', '4'));
});
