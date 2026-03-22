import { Hono } from "hono";
import type { AppEnv } from "../app";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";
import { storeChallenge, consumeChallenge } from "../lib/auth-challenge";
import {
  createSession,
  validateSession,
  getSessionToken,
  setSessionCookie,
} from "../lib/auth-session";
import { verifyAccessJwt } from "../lib/access-jwt";
import { base64UrlEncode } from "../lib/access-jwt";
import { forbidden, unauthorized, notFound } from "../lib/errors";

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const a8 = new Uint8Array(sigA);
  const b8 = new Uint8Array(sigB);
  let diff = 0;
  for (let i = 0; i < a8.length; i++) diff |= a8[i] ^ b8[i];
  return diff === 0;
}

const auth = new Hono<AppEnv>();

// GET /status — unauthenticated, checks auth state independently
auth.get("/status", async (c) => {
  const db = c.env.DB;
  const credCount = await db
    .prepare("SELECT COUNT(*) as count FROM passkey_credentials")
    .first<{ count: number }>();
  const registered = (credCount?.count ?? 0) > 0;

  let authenticated = false;
  const sessionToken = getSessionToken(c);
  if (sessionToken) {
    const userId = await validateSession(db, sessionToken);
    authenticated = !!userId;
  }
  if (!authenticated) {
    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (jwt && c.env.CF_ACCESS_AUD) {
      const result = await verifyAccessJwt(
        jwt,
        c.env.CF_ACCESS_AUD,
        c.env.CF_ACCESS_TEAM,
      );
      authenticated = !!result;
    }
  }
  return c.json({ registered, authenticated });
});

// POST /bootstrap/options — generate registration options for first-time setup
auth.post("/bootstrap/options", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ setupToken: string; email: string }>();

  // Validate setup token
  if (
    !c.env.SETUP_TOKEN ||
    !(await constantTimeEqual(body.setupToken, c.env.SETUP_TOKEN))
  ) {
    return forbidden("Invalid setup token");
  }

  // Check no credentials exist
  const credCount = await db
    .prepare("SELECT COUNT(*) as count FROM passkey_credentials")
    .first<{ count: number }>();
  if ((credCount?.count ?? 0) > 0) {
    return forbidden("Credentials already registered");
  }

  // Look up user by email
  const user = await db
    .prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(body.email)
    .first<{ id: string; email: string }>();
  if (!user) {
    return notFound("User");
  }

  // Generate webauthnUserId
  const webauthnUserId = crypto.getRandomValues(new Uint8Array(64));

  const options = await generateRegistrationOptions({
    rpName: "Wine Cellar",
    rpID: c.env.RP_ID,
    userName: user.email,
    userID: webauthnUserId,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });

  // Store challenge
  const challengeId = await storeChallenge(db, options.challenge, "bootstrap");

  // Encode webauthnUserId to base64url
  const encodedUserId = base64UrlEncode(webauthnUserId.buffer);

  return c.json({ challengeId, options, webauthnUserId: encodedUserId });
});

// POST /bootstrap — verify registration and create first credential
auth.post("/bootstrap", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    setupToken: string;
    email: string;
    challengeId: string;
    credential: any;
    webauthnUserId: string;
  }>();

  // Validate setup token
  if (
    !c.env.SETUP_TOKEN ||
    !(await constantTimeEqual(body.setupToken, c.env.SETUP_TOKEN))
  ) {
    return forbidden("Invalid setup token");
  }

  // Check no credentials exist
  const credCount = await db
    .prepare("SELECT COUNT(*) as count FROM passkey_credentials")
    .first<{ count: number }>();
  if ((credCount?.count ?? 0) > 0) {
    return forbidden("Credentials already registered");
  }

  // Look up user by email
  const user = await db
    .prepare("SELECT id, email FROM users WHERE email = ?")
    .bind(body.email)
    .first<{ id: string; email: string }>();
  if (!user) {
    return notFound("User");
  }

  // Consume challenge
  const challengeData = await consumeChallenge(
    db,
    body.challengeId,
    "bootstrap",
  );
  if (!challengeData) {
    return unauthorized("Challenge expired or invalid");
  }

  // Verify registration response
  const verification = await verifyRegistrationResponse({
    response: body.credential,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: c.env.RP_ORIGIN,
    expectedRPID: c.env.RP_ID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return unauthorized("Registration verification failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  // Store credential
  await db
    .prepare(
      `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      credential.id,
      user.id,
      credential.publicKey as unknown as ArrayBuffer,
      body.webauthnUserId,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
    )
    .run();

  // Create session
  const secure = c.env.RP_ORIGIN.startsWith("https://");
  const { token } = await createSession(db, user.id);
  setSessionCookie(c, token, secure);

  return c.json({ status: "ok" });
});

// POST /login/options — generate authentication options for passkey login
auth.post("/login/options", async (c) => {
  const db = c.env.DB;

  const options = await generateAuthenticationOptions({
    rpID: c.env.RP_ID,
    userVerification: "required",
    allowCredentials: [],
  });

  const challengeId = await storeChallenge(db, options.challenge, "login");

  return c.json({ challengeId, options });
});

// POST /login — verify authentication response and create session
auth.post("/login", async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ challengeId: string; credential: any }>();

  // Consume challenge
  const challengeData = await consumeChallenge(db, body.challengeId, "login");
  if (!challengeData) {
    return unauthorized("Invalid or expired challenge");
  }

  // Look up credential by ID
  const storedCred = await db
    .prepare(
      "SELECT id, user_id, public_key, sign_count, transports FROM passkey_credentials WHERE id = ?",
    )
    .bind(body.credential.id)
    .first<{
      id: string;
      user_id: string;
      public_key: ArrayBuffer;
      sign_count: number;
      transports: string | null;
    }>();

  if (!storedCred) {
    return unauthorized("Credential not found");
  }

  const pubKeyUint8 = new Uint8Array(storedCred.public_key as ArrayBuffer);
  const transports: AuthenticatorTransportFuture[] = JSON.parse(
    storedCred.transports || "[]",
  );

  // Verify authentication response
  const verification = await verifyAuthenticationResponse({
    response: body.credential,
    expectedChallenge: challengeData.challenge,
    expectedOrigin: c.env.RP_ORIGIN,
    expectedRPID: c.env.RP_ID,
    credential: {
      id: storedCred.id,
      publicKey: pubKeyUint8,
      counter: storedCred.sign_count,
      transports,
    },
  });

  if (!verification.verified) {
    return unauthorized("Verification failed");
  }

  // Update sign count with safety check (counter should not go backward)
  const newCount = verification.authenticationInfo.newCounter;
  const result = await db
    .prepare(
      `UPDATE passkey_credentials
       SET sign_count = ?, last_used_at = datetime('now')
       WHERE id = ? AND (sign_count = 0 OR sign_count < ?)`,
    )
    .bind(newCount, storedCred.id, newCount)
    .run();

  if ((result.meta?.changes ?? 0) === 0 && storedCred.sign_count > 0) {
    return unauthorized("Credential counter went backward");
  }

  // Create session and set cookie
  const secure = c.env.RP_ORIGIN.startsWith("https://");
  const { token } = await createSession(db, storedCred.user_id);
  setSessionCookie(c, token, secure);

  return c.json({ status: "ok" });
});

export default auth;
