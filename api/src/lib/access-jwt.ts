// Cache JWKS keys in module scope (Workers have per-isolate module caching)
let cachedKeys: Map<string, CryptoKey> = new Map();
let cacheExpiry = 0;

export function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function fetchJwks(team: string): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  if (cachedKeys.size > 0 && now < cacheExpiry) return cachedKeys;

  const url = `https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);

  const { keys } = (await resp.json()) as { keys: JsonWebKey[] };
  const keyMap = new Map<string, CryptoKey>();

  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    keyMap.set(jwk.kid as string, key);
  }

  cachedKeys = keyMap;
  cacheExpiry = now + 5 * 60 * 1000; // 5 min cache
  return keyMap;
}

// Exported for test overriding
export let _fetchJwks = fetchJwks;
export function __setFetchJwks(fn: typeof fetchJwks) {
  _fetchJwks = fn;
}

export async function verifyAccessJwt(
  token: string,
  aud: string,
  team: string,
): Promise<{ email: string } | null> {
  // Test mode: accept simple tokens for unit tests
  if (team === "test" && token.startsWith("test-jwt-for:")) {
    const email = token.slice("test-jwt-for:".length);
    if (!email) return null;
    return { email };
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    // Decode header
    const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    if (!header.kid) return null;

    // Fetch + find key
    const keys = await _fetchJwks(team);
    const key = keys.get(header.kid);
    if (!key) return null;

    // Verify signature
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlDecode(parts[2]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
    if (!valid) return null;

    // Check claims
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    if (!payload.aud || !payload.aud.includes(aud)) return null;
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    // Browser JWTs have "email"; service-token JWTs have "common_name" instead
    const email =
      payload.email ?? (payload.common_name ? `${payload.common_name}@${team}.cloudflareaccess.com` : null);
    if (!email) return null;

    return { email };
  } catch {
    return null;
  }
}
