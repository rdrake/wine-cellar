/**
 * RFC 8291 Web Push encryption + VAPID auth for Cloudflare Workers.
 * Uses crypto.subtle — no npm dependencies.
 */

export interface PushSubscription {
  endpoint: string;
  keys_p256dh: string; // base64url — subscriber's ECDH public key (65 bytes raw)
  keys_auth: string; // base64url — subscriber's auth secret (16 bytes)
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  type: string;
  alertId: string;
  [key: string]: unknown;
}

// --- Base64url helpers ---

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// --- VAPID JWT (ES256) ---

async function createVapidJwt(
  audience: string,
  subject: string,
  publicKeyRaw: Uint8Array,
  privateKeyD: Uint8Array,
): Promise<{ authorization: string; cryptoKey: string }> {
  // Import the private key as JWK for signing
  const x = b64url(publicKeyRaw.slice(1, 33));
  const y = b64url(publicKeyRaw.slice(33, 65));
  const d = b64url(privateKeyD);

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x, y, d },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );

  const header = b64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    new TextEncoder().encode(JSON.stringify({ aud: audience, exp: now + 86400, sub: subject })),
  );

  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data));

  // crypto.subtle returns DER-encoded ECDSA signature — convert to raw r||s (64 bytes)
  let rawSig: Uint8Array;
  if (sig.length === 64) {
    rawSig = sig;
  } else {
    // Parse DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
    rawSig = new Uint8Array(64);
    let offset = 2; // skip 0x30 <total_len>
    offset += 1; // 0x02
    const rLen = sig[offset++];
    const r = sig.slice(offset, offset + rLen);
    offset += rLen;
    offset += 1; // 0x02
    const sLen = sig[offset++];
    const s = sig.slice(offset, offset + sLen);
    // Right-align r and s into 32-byte slots
    rawSig.set(r.length <= 32 ? r : r.slice(r.length - 32), 32 - Math.min(r.length, 32));
    rawSig.set(s.length <= 32 ? s : s.slice(s.length - 32), 64 - Math.min(s.length, 32));
  }

  const token = `${header}.${payload}.${b64url(rawSig)}`;
  const cryptoKeyHeader = b64url(publicKeyRaw);

  return {
    authorization: `vapid t=${token}, k=${cryptoKeyHeader}`,
    cryptoKey: cryptoKeyHeader,
  };
}

// --- HKDF (RFC 5869) ---

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, salt.length > 0 ? salt : ikm));
  // Actually: HKDF-Extract(salt, IKM) = HMAC-Hash(salt, IKM)
  const prkKey = await crypto.subtle.importKey(
    "raw",
    salt.length > 0
      ? new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            await crypto.subtle.importKey(
              "raw",
              salt,
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign"],
            ),
            ikm,
          ),
        )
      : prk,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  // HKDF-Expand: T(1) = HMAC-Hash(PRK, info || 0x01)
  const infoWithCounter = new Uint8Array(info.length + 1);
  infoWithCounter.set(info);
  infoWithCounter[info.length] = 1;
  const okm = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, infoWithCounter));
  return okm.slice(0, length);
}

// --- RFC 8291 payload encryption ---

function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function createInfo(
  type: string,
  clientPublicKey: Uint8Array,
  serverPublicKey: Uint8Array,
): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);
  // "Content-Encoding: <type>\0" || "P-256\0" || client_key_length || client_key || server_key_length || server_key
  const header = encoder.encode("Content-Encoding: ");
  const nul = new Uint8Array([0]);
  const p256 = encoder.encode("P-256");
  const clientLen = new Uint8Array(2);
  new DataView(clientLen.buffer).setUint16(0, clientPublicKey.length);
  const serverLen = new Uint8Array(2);
  new DataView(serverLen.buffer).setUint16(0, serverPublicKey.length);

  return concat(header, typeBytes, nul, p256, nul, clientLen, clientPublicKey, serverLen, serverPublicKey);
}

async function encrypt(
  plaintext: Uint8Array,
  subscriberPubKey: Uint8Array, // 65 bytes raw
  authSecret: Uint8Array, // 16 bytes
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  // Generate ephemeral ECDH key pair
  const serverKeyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;

  // Export server public key (raw 65 bytes)
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  // Import subscriber's public key
  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    subscriberPubKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // ECDH shared secret
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberKey },
      serverKeyPair.privateKey,
      256,
    ),
  );

  // Generate 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // IKM = HKDF(auth_secret, shared_secret, "Content-Encoding: auth\0", 32)
  const authInfo = new TextEncoder().encode("Content-Encoding: auth\0");
  const ikm = await hkdf(authSecret, sharedSecret, authInfo, 32);

  // Content encryption key = HKDF(salt, IKM, cek_info, 16)
  const cekInfo = createInfo("aes128gcm", subscriberPubKey, serverPubRaw);
  const cek = await hkdf(salt, ikm, cekInfo, 16);

  // Nonce = HKDF(salt, IKM, nonce_info, 12)
  const nonceInfo = createInfo("nonce", subscriberPubKey, serverPubRaw);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  // Pad plaintext: add delimiter 0x02 (single record, last record)
  const padded = concat(plaintext, new Uint8Array([2]));

  // AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded),
  );

  return { ciphertext: encrypted, salt, serverPublicKey: serverPubRaw };
}

function buildAes128gcmBody(
  salt: Uint8Array,
  serverPublicKey: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array {
  // Header: salt (16) || rs (4, uint32 BE) || idlen (1) || keyid (65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, ciphertext.length + 86); // record size (doesn't matter much for single record, just needs to be >= ciphertext + header)
  const idlen = new Uint8Array([serverPublicKey.length]);
  return concat(salt, rs, idlen, serverPublicKey, ciphertext);
}

// --- Public API ---

async function sendPush(
  sub: PushSubscription,
  payload: PushPayload,
  vapidPublicKeyRaw: Uint8Array,
  vapidPrivateKeyD: Uint8Array,
): Promise<{ ok: boolean; status: number; gone: boolean }> {
  try {
    const subscriberPubKey = unb64url(sub.keys_p256dh);
    const authSecret = unb64url(sub.keys_auth);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    // Encrypt payload per RFC 8291
    const { ciphertext, salt, serverPublicKey } = await encrypt(
      plaintext,
      subscriberPubKey,
      authSecret,
    );
    const body = buildAes128gcmBody(salt, serverPublicKey, ciphertext);

    // VAPID auth
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const vapid = await createVapidJwt(audience, "mailto:noreply@drake.zone", vapidPublicKeyRaw, vapidPrivateKeyD);

    const resp = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapid.authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        TTL: "86400",
      },
      body,
    });

    return {
      ok: resp.status === 201,
      status: resp.status,
      gone: resp.status === 404 || resp.status === 410,
    };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}

/**
 * Send push to all subscriptions for a user. Cleans up expired subscriptions.
 * vapidPublicKey: base64url of raw 65-byte uncompressed EC public key
 * vapidPrivateKey: base64url of 32-byte private scalar (d)
 */
export async function sendPushToUser(
  db: D1Database,
  userId: string,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<void> {
  const subs = await db
    .prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?")
    .bind(userId)
    .all<PushSubscription>();

  if (subs.results.length === 0) return;

  const pubRaw = unb64url(vapidPublicKey);
  const privD = unb64url(vapidPrivateKey);

  for (const sub of subs.results) {
    const result = await sendPush(sub, payload, pubRaw, privD);
    if (result.gone) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
    }
  }
}
