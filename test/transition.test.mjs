import { test } from 'node:test';
import { deepStrictEqual, throws } from 'node:assert';
import { transition } from '../src/transition.mjs';

test('avisa ao detectar vaga inicialmente ou depois de fechada', () => {
  deepStrictEqual(transition(null, {status:'open'}), {state:'open', notify:true});
  deepStrictEqual(transition('closed', {status:'open'}), {state:'open', notify:true});
});
test('não repete avisos enquanto a vaga permanecer aberta', () => {
  deepStrictEqual(transition('open', {status:'open'}), {state:'open', notify:false});
});
test('erro preserva estado e não inventa mudança', () => {
  deepStrictEqual(transition('open', {status:'error'}), {state:'open', notify:false});
  deepStrictEqual(transition('closed', {status:'error'}), {state:'closed', notify:false});
});
test('fechamento permite novo aviso na próxima abertura', () => {
  deepStrictEqual(transition('open', {status:'closed'}), {state:'closed', notify:false});
  throws(() => transition('open', {status:'unknown'}));
});
