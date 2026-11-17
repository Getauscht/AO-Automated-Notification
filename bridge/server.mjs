import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import makeWASocket, {DisconnectReason, useMultiFileAuthState} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
const token = process.env.BRIDGE_TOKEN;
if (!token || token.length < 32) throw new Error('Configure BRIDGE_TOKEN com ao menos 32 caracteres aleatórios');
let socket, state = 'disconnected', qr = null, connecting = null, retryTimer = null;
function authorized(value) {
  const a=Buffer.from(value || ''), b=Buffer.from(`Bearer ${token}`);
  return a.length===b.length && timingSafeEqual(a,b);
}
async function connect() {
  if (state === 'connected' || connecting || socket) return;
  connecting = (async () => {
    state='connecting'; qr=null;
    const {state: auth, saveCreds} = await useMultiFileAuthState(process.env.AUTH_DIR || './auth');
    const current = makeWASocket({auth, logger:pino({level:'silent'})}); socket=current;
    current.ev.on('creds.update', saveCreds);
    current.ev.on('connection.update', async update => {
      if (update.qr) {qr=await QRCode.toDataURL(update.qr, {width:300,margin:2}); state='qr';}
      if (update.connection === 'open') {state='connected'; qr=null;}
      if (update.connection === 'close') {
        if (socket !== current) return;
        socket=null; qr=null; state='disconnected';
        const code=update.lastDisconnect?.error?.output?.statusCode;
        if (code !== DisconnectReason.loggedOut) retryTimer=setTimeout(() => connect().catch(()=>{}), 5000);
      }
    });
  })();
  try {await connecting;} catch(e) {state='disconnected';socket=null;throw e;} finally {connecting=null;}
}
function reply(res,status,body) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
createServer(async (req,res) => {
  if (!authorized(req.headers.authorization)) return reply(res,401,{error:'Não autorizado'});
  try {
    if (req.method==='GET' && req.url==='/status') return reply(res,200,{state,qr});
    if (req.method==='POST' && req.url==='/connect') {clearTimeout(retryTimer);await connect();return reply(res,200,{state,qr});}
    if (req.method==='POST' && req.url==='/send') {
      let body=''; for await (const chunk of req) {body+=chunk;if (body.length>1048576) return reply(res,413,{error:'Mensagem muito grande'});}
      const {phone,text,image}=JSON.parse(body);
      if (!/^\d{8,15}$/.test(phone || '') || typeof text!=='string' || text.length>1000 || !text || (image !== undefined && (typeof image !== 'string' || image.length>900000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)))) return reply(res,400,{error:'Mensagem inválida'});
      if (state!=='connected' || !socket) return reply(res,503,{error:'WhatsApp desconectado'});
      if (image) {
        const buffer=Buffer.from(image,'base64');
        if (buffer.length>655360 || buffer.toString('base64')!==image || buffer[0]!==0xff || buffer[1]!==0xd8 || buffer[2]!==0xff) return reply(res,400,{error:'Imagem inválida'});
        await socket.sendMessage(`${phone}@s.whatsapp.net`,{image:buffer,caption:text});
      } else await socket.sendMessage(`${phone}@s.whatsapp.net`,{text});
      return reply(res,200,{ok:true});
    }
    return reply(res,404,{error:'Não encontrado'});
  } catch {return reply(res,500,{error:'Falha no serviço WhatsApp'});}
}).listen(Number(process.env.PORT || 3001),'0.0.0.0',()=>console.log('Serviço WhatsApp iniciado'));
connect().catch(()=>console.error('Não foi possível iniciar a conexão'));

