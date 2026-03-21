import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  verifyAccessJwt,
  base64UrlEncode,
  base64UrlDecode,
  __setFetchJwks,
  _fetchJwks,
} from "../src/lib/access-jwt";

const TEST_AUD = "test-audience-tag";
const TEST_TEAM = "test-team";
const TEST_KID = "test-key-1";

let publicKey: CryptoKey;
let privateKey: CryptoKey;
let originalFetchJwks: typeof _fetchJwks;

async function createJwt(
  payload: Record<string, unknown>,
  kid: string = TEST_KID,
): Promise<string> {
  const header = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid })),
  );
  const body = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const data = new TextEncoder().encode(`${header}.${body}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);
  return `${header}.${body}.${base64UrlEncode(sig)}`;
}

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  publicKey = keyPair.publicKey;
  privateKey = keyPair.privateKey;

  // Save original so we can restore
  originalFetchJwks = _fetchJwks;

  // Override JWKS fetch to return our test key
  __setFetchJwks(async () => {
    const map = new Map<string, CryptoKey>();
    map.set(TEST_KID, publicKey);
    return map;
  });
});

afterEach(() => {
  // Keep the test override — restored in afterAll if needed
});

describe("verifyAccessJwt", () => {
  it("returns null for malformed tokens", async () => {
    const result = await verifyAccessJwt("not.a.jwt", TEST_AUD, TEST_TEAM);
    expect(result).toBeNull();
  });

  it("returns null for completely invalid strings", async () => {
    expect(await verifyAccessJwt("", TEST_AUD, TEST_TEAM)).toBeNull();
    expect(await verifyAccessJwt("abc", TEST_AUD, TEST_TEAM)).toBeNull();
  });

  it("returns email for valid token", async () => {
    const token = await createJwt({
      email: "test@example.com",
      aud: [TEST_AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, TEST_AUD, TEST_TEAM);
    expect(result).toEqual({ kind: "user", email: "test@example.com" });
  });

  it("returns service-token result for token with common_name", async () => {
    const token = await createJwt({
      common_name: "abc123.access",
      aud: [TEST_AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, TEST_AUD, TEST_TEAM);
    expect(result).toEqual({ kind: "service-token", clientId: "abc123.access" });
  });

  it("returns null for expired tokens", async () => {
    const token = await createJwt({
      email: "test@example.com",
      aud: [TEST_AUD],
      exp: Math.floor(Date.now() / 1000) - 60, // expired 60s ago
    });
    const result = await verifyAccessJwt(token, TEST_AUD, TEST_TEAM);
    expect(result).toBeNull();
  });

  it("returns null when aud does not match", async () => {
    const token = await createJwt({
      email: "test@example.com",
      aud: ["wrong-audience"],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, TEST_AUD, TEST_TEAM);
    expect(result).toBeNull();
  });

  it("returns null when kid does not match any key", async () => {
    const token = await createJwt(
      {
        email: "test@example.com",
        aud: [TEST_AUD],
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      "unknown-kid",
    );
    const result = await verifyAccessJwt(token, TEST_AUD, TEST_TEAM);
    expect(result).toBeNull();
  });

  it("returns null when neither email nor common_name present", async () => {
    const token = await createJwt({
      aud: [TEST_AUD],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const result = await verifyAccessJwt(token, TEST_AUD, TEST_TEAM);
    expect(result).toBeNull();
  });

  it("test mode: accepts test-jwt-for: tokens", async () => {
    const result = await verifyAccessJwt("test-jwt-for:alice@example.com", "any", "test");
    expect(result).toEqual({ kind: "user", email: "alice@example.com" });
  });

  it("test mode: accepts test service tokens", async () => {
    const result = await verifyAccessJwt("test-jwt-for:st:my-client-id", "any", "test");
    expect(result).toEqual({ kind: "service-token", clientId: "my-client-id" });
  });

  it("test mode: rejects empty email", async () => {
    const result = await verifyAccessJwt("test-jwt-for:", "any", "test");
    expect(result).toBeNull();
  });

  it("test mode: rejects empty service token client id", async () => {
    const result = await verifyAccessJwt("test-jwt-for:st:", "any", "test");
    expect(result).toBeNull();
  });
});

describe("base64Url", () => {
  it("round-trips data", () => {
    const original = new TextEncoder().encode("hello world");
    const encoded = base64UrlEncode(original.buffer);
    const decoded = base64UrlDecode(encoded);
    expect(new TextDecoder().decode(decoded)).toBe("hello world");
  });
});
