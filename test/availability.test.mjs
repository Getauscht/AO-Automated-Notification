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
