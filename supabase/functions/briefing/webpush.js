// Web Push sans dépendance : chiffrement aes128gcm (RFC 8291) + signature VAPID (RFC 8292), WebCrypto seul.
// Marche sous Deno (fonction Supabase) et Node 20+ (test local).
const enc = new TextEncoder();
const b64u = {
  enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)),
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
async function hkdf(salt, ikm, info, octets) {
  const cle = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, cle, octets * 8));
}

// Chiffre le message pour un abonnement {p256dh, auth} (base64url). Renvoie le corps binaire de la requête.
export async function chiffrer(message, p256dh, authSecret) {
  const uaPublic = b64u.dec(p256dh);
  const auth = b64u.dec(authSecret);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaCle = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaCle }, eph.privateKey, 256));
  const ikm = await hkdf(auth, partage, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sel, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const cleAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const clair = concat(enc.encode(message), new Uint8Array([2])); // 2 = dernier (et unique) enregistrement
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cleAes, clair));
  const entete = new Uint8Array(21);
  new DataView(entete.buffer).setUint32(16, 4096);
  entete.set(sel, 0);
  entete[20] = asPublic.length;
  return concat(entete, asPublic, chiffre);
}

// En-tête Authorization VAPID pour l'origine du service de push. clePriveeJwk : JWK EC P-256 (avec d).
export async function vapid(endpoint, clePriveeJwk, sujet) {
  const aud = new URL(endpoint).origin;
  const cle = await crypto.subtle.importKey('jwk', clePriveeJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const corps = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) + '.'
    + b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: sujet })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, enc.encode(corps));
  const publique = b64u.enc(concat(new Uint8Array([4]), b64u.dec(clePriveeJwk.x), b64u.dec(clePriveeJwk.y)));
  return `vapid t=${corps}.${b64u.enc(sig)}, k=${publique}`;
}

// Envoie une notification. Renvoie le code HTTP (201 = ok, 404/410 = abonnement mort).
export async function envoyer(abonnement, message, clePriveeJwk, sujet) {
  const corps = await chiffrer(message, abonnement.p256dh, abonnement.auth);
  const r = await fetch(abonnement.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapid(abonnement.endpoint, clePriveeJwk, sujet),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '3600',
      Urgency: 'high',
    },
    body: corps,
  });
  return r.status;
}

export const _interne = { b64u };
