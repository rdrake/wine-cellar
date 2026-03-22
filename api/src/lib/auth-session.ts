import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";

const SESSION_DURATION_SECONDS = 86400; // 24 hours

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSession(
  db: D1Database,
  userId: string,
): Promise<{ token: string; hash: string }> {
  const token = generateToken();
  const hash = await hashToken(token);
  await db
    .prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 day'))")
    .bind(hash, userId)
    .run();
  return { token, hash };
}

export async function validateSession(db: D1Database, token: string): Promise<string | null> {
  const hash = await hashToken(token);
  const row = await db
    .prepare("SELECT user_id FROM auth_sessions WHERE id = ? AND expires_at > datetime('now')")
    .bind(hash)
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  const hash = await hashToken(token);
  await db.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(hash).run();
}

export async function cleanupExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM auth_sessions WHERE expires_at <= datetime('now')").run();
}

export function getSessionToken(c: Context): string | null {
  return getCookie(c, "__Host-session") ?? getCookie(c, "session") ?? null;
}

export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  const name = secure ? "__Host-session" : "session";
  setCookie(c, name, token, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

export function clearSessionCookie(c: Context, secure: boolean): void {
  const name = secure ? "__Host-session" : "session";
  setCookie(c, name, "", {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}
