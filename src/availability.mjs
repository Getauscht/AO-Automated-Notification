// Parser restrito ao HTML observado na consulta de disciplina da UERJ.
// Mudanças na página, dados ambíguos e disciplina/turma ausente são erros.
const plain = value => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;|\u00a0/gi, ' ').replace(/\s+/g, ' ').trim();
export function parseAvailability(html, subjectCode, classCode) {
  if (typeof html !== 'string' || !/^[A-Z]{3}\d{2}-\d{5}$/i.test(subjectCode) || !/^\d+$/.test(String(classCode))) throw new Error('Identificação inválida');
  const heading = html.match(/<b[^>]*>\s*Disciplina\s*:\s*<\/b>([\s\S]*?)(?:<a\b|<\/div>)/i);
  if (!heading || !plain(heading[1]).toUpperCase().startsWith(subjectCode.toUpperCase() + ' ')) throw new Error('Disciplina não identificada');
  const starts = [...html.matchAll(/<b[^>]*>\s*TURMA\s*:\s*<\/b>\s*(\d+)\b/gi)];
  const matching = starts.filter(m => Number(m[1]) === Number(classCode));
  if (matching.length !== 1) throw new Error('Turma ausente ou ambígua');
  const start = matching[0];
  const pos = starts.indexOf(start);
  const section = html.slice(start.index, starts[pos + 1]?.index ?? html.length);
  const tableMatches = [...section.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)];
  const rowsFor = html => [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(m => [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(c => plain(c[1])));
  // A UERJ também devolve páginas sem <caption>. Nesse caso, a tabela de
  // vagas atualizadas deve ser reconhecida pelo cabeçalho e pela linha UERJ.
  // Nunca interpretar uma tabela explicitamente identificada com outro nome
  // (por exemplo, vagas para solicitação de inscrição) como a tabela atual.
  const captionsFor = table => [...table[1].matchAll(/<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/gi)]
    .map(m => plain(m[1])).filter(Boolean);
  const isUpdatedCaption = caption => /^Vagas Atualizadas da Turma$/i.test(caption);
  const hasAvailabilityShape = rows => {
    const header = rows.some(r => r.length === 3 && /^Tipo de Vaga$/i.test(r[0]) && /^Oferecidas$/i.test(r[1]) && /^Ocupadas$/i.test(r[2]));
    const uerj = rows.filter(r => r.length === 3 && /^UERJ$/i.test(r[0]));
    return header && uerj.length === 1 && /^\d+$/.test(uerj[0][1]) && /^\d+$/.test(uerj[0][2]);
  };
  const named = tableMatches.filter(table => captionsFor(table).some(isUpdatedCaption));
  const tables = named.length ? named : tableMatches.filter(table =>
    captionsFor(table).length === 0 && hasAvailabilityShape(rowsFor(table[1]))
  );
  if (tables.length !== 1) {
    const captions = [...section.matchAll(/<caption\b[^>]*>([\s\S]*?)<\/caption\s*>/gi)]
      .map(m => plain(m[1])).filter(Boolean).slice(0, 8).map(value => value.slice(0, 80));
    const tableCount = [...section.matchAll(/<table\b/gi)].length;
    throw new Error(`Tabela de vagas atualizadas ausente ou ambígua (turma=${classCode}; tabelas=${tableCount}; legendas=${JSON.stringify(captions)})`);
  }
  const rows = rowsFor(tables[0][1]);
  const header = rows.find(r => r.length === 3 && /^Tipo de Vaga$/i.test(r[0]) && /^Oferecidas$/i.test(r[1]) && /^Ocupadas$/i.test(r[2]));
  const uerj = rows.filter(r => r.length === 3 && /^UERJ$/i.test(r[0]));
  if (!header || uerj.length !== 1 || !/^\d+$/.test(uerj[0][1]) || !/^\d+$/.test(uerj[0][2])) throw new Error('Dados de vagas UERJ inválidos');
  const offered = Number(uerj[0][1]);
  const occupied = Number(uerj[0][2]);
  if (!Number.isSafeInteger(offered) || !Number.isSafeInteger(occupied)) throw new Error('Quantidade inválida');
  return {status: offered > occupied ? 'open' : 'closed', offered, occupied};
}
