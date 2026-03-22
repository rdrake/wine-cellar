import { Hono } from "hono";
import type { AppEnv } from "../app";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { GitHub } from "arctic";
import { storeChallenge, consumeChallenge } from "../lib/auth-challenge";
import {
  createSession,
  deleteSession,
  validateSession,
  getSessionToken,
  setSessionCookie,
  clearSessionCookie,
} from "../lib/auth-session";
import { base64UrlEncode, base64UrlDecode } from "../lib/encoding";
import { forbidden, unauthorized, notFound } from "../lib/errors";
import { createApiKey, listApiKeys, deleteApiKey } from "../lib/api-keys";

const auth = new Hono<AppEnv>();

// GET /status — unauthenticated, checks auth state
auth.get("/status", async (c) => {
  const token = getSessionToken(c);
  if (token) {
    const userId = await validateSession(c.env.DB, token);
    if (userId) {
      const user = await c.env.DB
        .prepare(
          "SELECT id, email, name, avatar_url, onboarded FROM users WHERE id = ?",
        )
        .bind(userId)
        .first<{
          id: string;
          email: string;
          name: string | null;
          avatar_url: string | null;
          onboarded: number;
        }>();
      if (user) {
        return c.json({
          authenticated: true,
          isNewUser: user.onboarded === 0,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatar_url,
          },
        });
      }
    }
  }
  return c.json({ authenticated: false });
});

// GET /settings — public endpoint, returns registration settings
auth.get("/settings", async (c) => {
  const row = await c.env.DB
    .prepare("SELECT value FROM settings WHERE key = 'registrations_open'")
    .first<{ value: string }>();
  return c.json({ registrationsOpen: row?.value === "true" });
});

// GET /github — OAuth initiation: redirects to GitHub
auth.get("/github", async (c) => {
  const github = new GitHub(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    null,
  );
  const state = crypto.randomUUID();
  // Store the state as both the id and challenge so consumeChallenge(db, state, "oauth") works
  await c.env.DB
    .prepare(
      "INSERT INTO auth_challenges (id, challenge, type, expires_at) VALUES (?, ?, 'oauth', datetime('now', '+10 minutes'))",
    )
    .bind(state, state)
    .run();
  const url = github.createAuthorizationURL(state, [
    "read:user",
    "user:email",
  ]);
  return c.redirect(url.toString());
});

// GET /github/callback — OAuth callback: exchange code, create/find user, create session
auth.get("/github/callback", async (c) => {
  const db = c.env.DB;
  const stateParam = c.req.query("state");
  const code = c.req.query("code");

  // Validate state
  if (!stateParam || !code) {
    return c.redirect("/login?error=invalid_state");
  }
  const challengeData = await consumeChallenge(db, stateParam, "oauth");
  if (!challengeData) {
    return c.redirect("/login?error=invalid_state");
  }

  // Exchange code for token
  const github = new GitHub(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    null,
  );
  let tokens;
  try {
    tokens = await github.validateAuthorizationCode(code);
  } catch {
    return c.redirect("/login?error=github_error");
  }

  // Fetch GitHub user profile
  let ghUser: {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
  try {
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokens.accessToken()}`,
        Accept: "application/json",
        "User-Agent": "wine-cellar",
      },
    });
    if (!userRes.ok) {
      return c.redirect("/login?error=github_error");
    }
    ghUser = (await userRes.json()) as typeof ghUser;
  } catch {
    return c.redirect("/login?error=github_error");
  }

  // If email is null, fetch from /user/emails
  let email = ghUser.email;
  if (!email) {
    try {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: {
          Authorization: `Bearer ${tokens.accessToken()}`,
          Accept: "application/json",
          "User-Agent": "wine-cellar",
        },
      });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as Array<{
          email: string;
          primary: boolean;
          verified: boolean;
        }>;
        const primary = emails.find((e) => e.primary && e.verified);
        email = primary?.email ?? null;
      }
    } catch {
      // Fall through — email stays null
    }
  }

  if (!email) {
    return c.redirect("/login?error=email_required");
  }

  const githubId = String(ghUser.id);
  const displayName = ghUser.name ?? ghUser.login;
  const avatarUrl = ghUser.avatar_url ?? null;
  const secure = c.env.RP_ORIGIN.startsWith("https://");

  // Look up oauth_accounts by (provider='github', provider_user_id=githubId)
  const oauthAccount = await db
    .prepare(
      "SELECT user_id FROM oauth_accounts WHERE provider = 'github' AND provider_user_id = ?",
    )
    .bind(githubId)
    .first<{ user_id: string }>();

  if (oauthAccount) {
    // Existing OAuth link — update profile info and create session
    await db
      .prepare(
        "UPDATE oauth_accounts SET email = ?, name = ?, avatar_url = ? WHERE provider = 'github' AND provider_user_id = ?",
      )
      .bind(email, displayName, avatarUrl, githubId)
      .run();
    await db
      .prepare("UPDATE users SET name = ?, avatar_url = ? WHERE id = ?")
      .bind(displayName, avatarUrl, oauthAccount.user_id)
      .run();

    const { token } = await createSession(db, oauthAccount.user_id);
    setSessionCookie(c, token, secure);
    return c.redirect("/");
  }

  // No OAuth link — check if user exists by email
  const existingUser = await db
    .prepare("SELECT id FROM users WHERE email = ?")
    .bind(email)
    .first<{ id: string }>();

  if (existingUser) {
    // Link OAuth account to existing user
    await db
      .prepare(
        "INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, name, avatar_url) VALUES ('github', ?, ?, ?, ?, ?)",
      )
      .bind(githubId, existingUser.id, email, displayName, avatarUrl)
      .run();

    const { token } = await createSession(db, existingUser.id);
    setSessionCookie(c, token, secure);
    return c.redirect("/");
  }

  // No user — check if registrations are open
  const regSetting = await db
    .prepare("SELECT value FROM settings WHERE key = 'registrations_open'")
    .first<{ value: string }>();
  if (regSetting?.value !== "true") {
    return c.redirect("/login?error=registrations_closed");
  }

  // Create new user (onboarded=0)
  const newUserId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO users (id, email, name, avatar_url, onboarded) VALUES (?, ?, ?, ?, 0)",
    )
    .bind(newUserId, email, displayName, avatarUrl)
    .run();

  // Create OAuth account link
  await db
    .prepare(
      "INSERT INTO oauth_accounts (provider, provider_user_id, user_id, email, name, avatar_url) VALUES ('github', ?, ?, ?, ?, ?)",
    )
    .bind(githubId, newUserId, email, displayName, avatarUrl)
    .run();

  const { token } = await createSession(db, newUserId);
  setSessionCookie(c, token, secure);
  return c.redirect("/welcome");
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

// POST /register/options — generate registration options for adding a passkey (requires session)
auth.post("/register/options", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");

  // Look up existing webauthn_user_id and credential IDs for this user
  const existingCreds = await db
    .prepare(
      "SELECT id, webauthn_user_id, transports FROM passkey_credentials WHERE user_id = ?",
    )
    .bind(user.id)
    .all<{
      id: string;
      webauthn_user_id: string;
      transports: string | null;
    }>();

  // Determine webauthn_user_id — reuse existing or generate new
  let webauthnUserId: Uint8Array;
  if (existingCreds.results.length > 0) {
    const encodedUserId = existingCreds.results[0].webauthn_user_id;
    webauthnUserId = base64UrlDecode(encodedUserId);
  } else {
    webauthnUserId = crypto.getRandomValues(new Uint8Array(64));
  }

  // Build excludeCredentials list
  const excludeCredentials = existingCreds.results.map((cred) => ({
    id: cred.id,
    transports: JSON.parse(
      cred.transports || "[]",
    ) as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName: "Wine Cellar",
    rpID: c.env.RP_ID,
    userName: user.email,
    userID: new Uint8Array(webauthnUserId) as Uint8Array<ArrayBuffer>,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials,
  });

  const challengeId = await storeChallenge(
    db,
    options.challenge,
    "register",
    user.id,
  );

  return c.json({ challengeId, options });
});

// POST /register — verify registration and store new credential (requires session)
auth.post("/register", async (c) => {
  const db = c.env.DB;
  const user = c.get("user");
  const body = await c.req.json<{ challengeId: string; credential: any; name?: string }>();

  // Consume challenge
  const challengeData = await consumeChallenge(
    db,
    body.challengeId,
    "register",
  );
  if (!challengeData) {
    return unauthorized("Challenge expired or invalid");
  }

  // Verify challenge was issued for this user
  if (challengeData.userId !== user.id) {
    return forbidden("Challenge user mismatch");
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

  // Look up existing webauthn_user_id for consistency
  const existingCred = await db
    .prepare(
      "SELECT webauthn_user_id FROM passkey_credentials WHERE user_id = ? LIMIT 1",
    )
    .bind(user.id)
    .first<{ webauthn_user_id: string }>();

  const webauthnUserId =
    existingCred?.webauthn_user_id ??
    base64UrlEncode(crypto.getRandomValues(new Uint8Array(64)).buffer);

  const credentialName = body.name && typeof body.name === "string" ? body.name.trim().slice(0, 100) : null;

  // Store credential
  await db
    .prepare(
      `INSERT INTO passkey_credentials (id, user_id, public_key, webauthn_user_id, sign_count, transports, device_type, backed_up, name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      credential.id,
      user.id,
      credential.publicKey as unknown as ArrayBuffer,
      webauthnUserId,
      credential.counter,
      JSON.stringify(credential.transports ?? []),
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      credentialName,
    )
    .run();

  return c.json({ status: "ok" });
});

// POST /api-keys — create a new API key (requires session)
auth.post("/api-keys", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "Name is required" }, 400);
  }
  if (body.name.length > 100) {
    return c.json({ error: "Name must be 100 characters or fewer" }, 400);
  }

  const result = await createApiKey(c.env.DB, user.id, body.name.trim());
  return c.json(result, 201);
});

// GET /api-keys — list API keys for the authenticated user (requires session)
auth.get("/api-keys", async (c) => {
  const user = c.get("user");
  const items = await listApiKeys(c.env.DB, user.id);
  return c.json({ items });
});

// DELETE /api-keys/:id — revoke an API key (requires session)
auth.delete("/api-keys/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const deleted = await deleteApiKey(c.env.DB, id, user.id);
  if (!deleted) {
    return notFound("API key");
  }
  return c.body(null, 204);
});

// GET /passkeys — list passkeys for the authenticated user (requires session)
auth.get("/passkeys", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB
    .prepare(
      "SELECT id, name, device_type, backed_up, created_at, last_used_at FROM passkey_credentials WHERE user_id = ? ORDER BY created_at DESC",
    )
    .bind(user.id)
    .all<{
      id: string;
      name: string | null;
      device_type: string | null;
      backed_up: number;
      created_at: string;
      last_used_at: string | null;
    }>();
  const items = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    deviceType: r.device_type,
    backedUp: r.backed_up === 1,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
  return c.json({ items });
});

// DELETE /passkeys/:id — revoke a passkey (requires session)
auth.delete("/passkeys/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB
    .prepare("DELETE FROM passkey_credentials WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) {
    return notFound("Passkey");
  }
  return c.body(null, 204);
});

// POST /logout — destroy session and clear cookie (requires session)
auth.post("/logout", async (c) => {
  const token = getSessionToken(c);
  if (token) {
    await deleteSession(c.env.DB, token);
  }
  const secure = c.env.RP_ORIGIN.startsWith("https://");
  clearSessionCookie(c, secure);
  return c.json({ status: "ok" });
});

// Users router — mounted at /api/v1/users in app.ts
export const usersRouter = new Hono<AppEnv>();

usersRouter.get("/me", async (c) => {
  const user = c.get("user");
  const full = await c.env.DB
    .prepare(
      "SELECT id, email, name, avatar_url, onboarded FROM users WHERE id = ?",
    )
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      onboarded: number;
    }>();
  if (!full) {
    return c.json({ error: "User not found" }, 404);
  }
  return c.json({
    id: full.id,
    email: full.email,
    name: full.name,
    avatarUrl: full.avatar_url,
    onboarded: full.onboarded === 1,
  });
});

usersRouter.patch("/me", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  if (body.name !== undefined) {
    if (
      typeof body.name !== "string" ||
      body.name.length < 1 ||
      body.name.length > 100
    ) {
      return c.json({ error: "Name must be 1-100 characters" }, 400);
    }
    await c.env.DB
      .prepare("UPDATE users SET name = ? WHERE id = ?")
      .bind(body.name, user.id)
      .run();
  }

  if (body.onboarded === true) {
    await c.env.DB
      .prepare("UPDATE users SET onboarded = 1 WHERE id = ?")
      .bind(user.id)
      .run();
  }

  const updated = await c.env.DB
    .prepare(
      "SELECT id, email, name, avatar_url, onboarded FROM users WHERE id = ?",
    )
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      name: string | null;
      avatar_url: string | null;
      onboarded: number;
    }>();
  return c.json({
    id: updated!.id,
    email: updated!.email,
    name: updated!.name,
    avatarUrl: updated!.avatar_url,
    onboarded: updated!.onboarded === 1,
  });
});

export default auth;
