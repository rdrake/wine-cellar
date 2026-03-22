export type ChallengeType = "oauth" | "login" | "register";

export async function storeChallenge(
  db: D1Database,
  challenge: string,
  type: ChallengeType,
  userId?: string,
  ttlMinutes: number = 5,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO auth_challenges (id, challenge, type, user_id, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+' || ? || ' minutes'))",
    )
    .bind(id, challenge, type, userId ?? null, ttlMinutes)
    .run();
  return id;
}

export async function consumeChallenge(
  db: D1Database,
  challengeId: string,
  expectedType: ChallengeType,
): Promise<{ challenge: string; userId: string | null } | null> {
  const row = await db
    .prepare(
      "DELETE FROM auth_challenges WHERE id = ? AND type = ? AND expires_at > datetime('now') RETURNING challenge, user_id",
    )
    .bind(challengeId, expectedType)
    .first<{ challenge: string; user_id: string | null }>();
  if (!row) return null;
  return { challenge: row.challenge, userId: row.user_id };
}

export async function cleanupExpiredChallenges(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM auth_challenges WHERE expires_at <= datetime('now')").run();
}
