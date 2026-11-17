// A falha da consulta nunca é interpretada como ausência de vagas.
export function transition(previous, observation) {
  if (observation.status === 'error') {
    return { state: previous, notify: false };
  }
  if (observation.status !== 'open' && observation.status !== 'closed') {
    throw new Error('Observação inválida');
  }
  return {
    state: observation.status,
    notify: observation.status !== previous,
  };
}
