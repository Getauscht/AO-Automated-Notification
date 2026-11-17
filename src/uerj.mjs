import {parseAvailability} from './availability.mjs';
const ORIGIN = 'https://www.alunoonline.uerj.br';
const URL_LOGIN = `${ORIGIN}/requisicaoaluno/`;
const clean = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g,' ').trim();
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}
function form(html, name) {
  const match = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)].find(m => attrs(m[1]).name === name);
  if (!match) throw new Error('Formulário UERJ não encontrado');
  const fields = {};
  for (const m of match[2].matchAll(/<input\b([^>]*)>/gi)) {
    const a = attrs(m[1]);
    if (a.name && a.type?.toLowerCase() === 'hidden') fields[a.name] = a.value ?? '';
  }
  return fields;
}
function menuRequest(html) {
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    if (!/Disciplinas do Curr[ií]culo\s*\/\s*A Cursar/i.test(clean(m[2]))) continue;
    const onclick = attrs(m[1]).onclick || '';
    const call = onclick.match(/executaMenu\(\s*0\s*,\s*['"]([a-f\d]+)['"]\s*,\s*0\s*,/i);
    if (call) return call[1];
  }
  throw new Error('Menu de disciplinas ausente');
}
function disciplineId(html, subjectCode) {
  if (!/^[A-Z]{3}\d{2}-\d{5}$/i.test(subjectCode)) throw new Error('Código da disciplina inválido');
  const matches = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    if (!clean(m[2]).toUpperCase().startsWith(subjectCode.toUpperCase() + ' ')) continue;
    const call = (attrs(m[1]).onclick || '').match(/consultarDisciplina\s*\(\s*output\s*,\s*(\d+)\s*\)/i);
    if (call) matches.push(call[1]);
  }
  if (new Set(matches).size !== 1) throw new Error('Disciplina ausente ou ambígua no currículo');
  return matches[0];
}
export async function observeUerj(credentials, watch, request = fetch) {
  if (!/^\d{12}$/.test(credentials.username) || !credentials.password) throw new Error('Credenciais inválidas');
  const cookies = new Map();
  async function send(url, fields) {
    const headers = {'User-Agent':'Mozilla/5.0', 'Referer':`${ORIGIN}/`};
    if (cookies.size) headers.Cookie = [...cookies].map(([k,v])=>`${k}=${v}`).join('; ');
    const options = {headers, redirect:'manual', signal:AbortSignal.timeout(20000)};
    if (fields) { options.method='POST'; headers['Content-Type']='application/x-www-form-urlencoded'; options.body=new URLSearchParams(fields).toString(); }
    const response = await request(url, options);
    if (!response.ok) throw new Error('Resposta HTTP inesperada da UERJ');
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';', 1)[0]; const eq = pair.indexOf('=');
      if (eq > 0) cookies.set(pair.slice(0,eq),pair.slice(eq+1));
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 3_000_000) throw new Error('Resposta excessiva da UERJ');
    const charset = response.headers.get('content-type')?.match(/charset\s*=\s*([^;\s]+)/i)?.[1] || 'windows-1252';
    return new TextDecoder(charset).decode(buffer);
  }
  await send(`${ORIGIN}/`);
  const login = await send(URL_LOGIN);
  const loginFields = form(login,'form');
  if (!('_token' in loginFields) || !('requisicao' in loginFields)) throw new Error('Login UERJ mudou');
  const home = await send(URL_LOGIN, {...loginFields, matricula:credentials.username, senha:credentials.password});
  const requestCode = menuRequest(home);
  const menuFields = form(home,'formulario');
  if (!('_token' in menuFields)) throw new Error('Sessão UERJ inválida');
  const listing = await send(URL_LOGIN, {...menuFields,target:'0',hRef:'',requisicao:requestCode});
  const id = disciplineId(listing,watch.subject_code);
  const listingFields = form(listing,'output');
  if (!('_token' in listingFields) || !('requisicao' in listingFields)) throw new Error('Consulta UERJ mudou');
  const detail = await send(URL_LOGIN, {...listingFields,'disciplinas[0]':id});
  return parseAvailability(detail,watch.subject_code,watch.class_code);
}
