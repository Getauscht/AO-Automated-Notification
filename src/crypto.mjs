const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function bytes(value) { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export function validateEncryptionKey(secret) {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(secret)) throw new Error('ENCRYPTION_KEY deve conter exatamente 32 bytes em base64');
  const raw = bytes(secret);
  if (raw.length !== 32 || base64(raw) !== secret) throw new Error('ENCRYPTION_KEY inválida');
  return raw;
}
async function key(secret) {
  const raw = validateEncryptionKey(secret);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(value, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), encoder.encode(JSON.stringify(value)));
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
export async function unseal(value, secret) {
  const [iv, ciphertext] = value.split('.');
  return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv) }, await key(secret), bytes(ciphertext))));
}
