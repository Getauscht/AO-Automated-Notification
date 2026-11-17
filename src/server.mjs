import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Database} from './database.mjs';
import {validateEncryptionKey} from './crypto.mjs';
import worker, {run} from './index.mjs';
const required=['ADMIN_TOKEN','ENCRYPTION_KEY','WHATSAPP_BRIDGE_TOKEN'];
for (const key of required) if (!process.env[key]) throw new Error(`Defina ${key}`);
if (process.env.ADMIN_TOKEN.length < 32 || process.env.WHATSAPP_BRIDGE_TOKEN.length < 32) throw new Error('Use tokens aleatórios de pelo menos 32 caracteres');
validateEncryptionKey(process.env.ENCRYPTION_KEY);
const assets = {'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/status-open.jpg':'status-open.jpg','/status-closed.jpg':'status-closed.jpg'};
const types = {html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',jpg:'image/jpeg'};
const env={...process.env, DB:new Database(process.env.DB_PATH || './data/vagas.sqlite'), ASSETS:{async fetch(request) {
  const path=new URL(request.url).pathname, file=assets[path]; if(!file) return new Response('Não encontrado',{status:404});
  return new Response(await readFile(new URL(`../public/${file}`,import.meta.url)),{headers:{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'",'Referrer-Policy':'no-referrer'}});
}}};
createServer(async (req,res)=>{
  try {
    const chunks=[]; let size=0; for await (const chunk of req) {size+=chunk.length;if(size>65536){res.writeHead(413);return res.end();}chunks.push(chunk);}
    const url=`http://localhost${req.url}`, init={method:req.method,headers:req.headers};
    if (!['GET','HEAD'].includes(req.method)) init.body=Buffer.concat(chunks);
    const response=await worker.fetch(new Request(url,init),env);
    res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[http] Falha ao processar requisição', {method:req.method,path:new URL(req.url,'http://localhost').pathname,error:error?.stack || error?.message || String(error)});
    res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"Erro interno"}');
  }
}).listen(Number(process.env.PORT || 3000),'0.0.0.0',()=>console.log('Painel iniciado'));
let running=false;
async function tick(){
  if(running)return;
  running=true;
  try{await run(env);}catch(error){console.error('[agendador] Falha na verificação agendada',error);}
  finally{running=false;}
}
function scheduleNext(){
  const interval=15*60*1000;
  const next=Math.floor(Date.now()/interval+1)*interval;
  env.MONITOR_SCHEDULE={nextAt:new Date(next).toISOString()};
  setTimeout(()=>{scheduleNext();void tick();},Math.max(0,next-Date.now()));
}
scheduleNext();
