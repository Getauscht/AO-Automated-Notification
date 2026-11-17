import {parseAvailability} from './availability.mjs';

const ORIGIN = 'https://www.alunoonline.uerj.br';
const URL_LOGIN = `${ORIGIN}/requisicaoaluno/`;
const clean = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
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

// Reutiliza sessão/cookies e listagem para todas as turmas de uma mesma conta.
// Redirecionamentos são permitidos somente dentro do domínio HTTPS da UERJ.
export async function createUerjSession(credentials, request = fetch) {
  if (!credentials || !/^\d{12}$/.test(credentials.username) || !credentials.password) throw new Error('Credenciais inválidas');
  const cookies = new Map();
  const loginDeadline = AbortSignal.timeout(45000);
  async function send(url, fields, signal) {
    let target = new URL(url);
    let postFields = fields;
    for (let hop = 0; hop <= 5; hop++) {
      if (target.origin !== ORIGIN || target.protocol !== 'https:' || target.username || target.password) throw new Error('Redirecionamento externo bloqueado');
      const headers = {'User-Agent':'Mozilla/5.0', Referer:`${ORIGIN}/`};
      if (cookies.size) headers.Cookie = [...cookies].map(([key,value]) => `${key}=${value}`).join('; ');
      const options = {headers, redirect:'manual', signal:AbortSignal.any([signal || AbortSignal.timeout(20000), AbortSignal.timeout(15000)])};
      if (postFields) {
        options.method = 'POST';
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        options.body = new URLSearchParams(postFields).toString();
      }
      const response = await request(target.href, options);
      const setCookies = response.headers.getSetCookie?.() ?? (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
      for (const cookie of setCookies) {
        const pair = cookie.split(';', 1)[0]; const eq = pair.indexOf('=');
        if (eq > 0) cookies.set(pair.slice(0,eq), pair.slice(eq + 1));
      }
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirecionamento UERJ sem destino');
        target = new URL(location, target);
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && postFields)) postFields = undefined;
        continue;
      }
      if (!response.ok) throw new Error(`Resposta HTTP ${response.status} da UERJ`);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > 3_000_000) throw new Error('Resposta excessiva da UERJ');
      const charset = response.headers.get('content-type')?.match(/charset\s*=\s*([^;\s]+)/i)?.[1] || 'windows-1252';
      return new TextDecoder(charset).decode(buffer);
    }
    throw new Error('Muitos redirecionamentos da UERJ');
  }
  await send(`${ORIGIN}/`, undefined, loginDeadline);
  const login = await send(URL_LOGIN, undefined, loginDeadline);
  const loginFields = form(login, 'form');
  if (!('_token' in loginFields) || !('requisicao' in loginFields)) throw new Error('Login UERJ mudou');
  const home = await send(URL_LOGIN, {...loginFields, matricula:credentials.username, senha:credentials.password}, loginDeadline);
  const requestCode = menuRequest(home);
  const menuFields = form(home, 'formulario');
  if (!('_token' in menuFields)) throw new Error('Sessão UERJ inválida');
  const listing = await send(URL_LOGIN, {...menuFields, target:'0', hRef:'', requisicao:requestCode}, loginDeadline);
  const listingFields = form(listing, 'output');
  if (!('_token' in listingFields) || !('requisicao' in listingFields)) throw new Error('Consulta UERJ mudou');
  return {
    async observe(watch) {
      const id = disciplineId(listing, watch.subject_code);
      const detail = await send(URL_LOGIN, {...listingFields, 'disciplinas[0]':id});
      return parseAvailability(detail, watch.subject_code, watch.class_code);
    }
  };
}
export async function observeUerj(credentials, watch, request = fetch) {
  return (await createUerjSession(credentials, request)).observe(watch);
}
