import { describe, it, expect, vi, afterEach } from "vitest";
import { relativeTime, timeAgo, parseUtc } from "./dates";

// ── parseUtc ─────────────────────────────────────────────────────────

describe("parseUtc", () => {
  it("parses ISO string with Z suffix", () => {
    const d = parseUtc("2026-03-22T12:00:00Z");
    expect(d.toISOString()).toBe("2026-03-22T12:00:00.000Z");
  });

  it("parses ISO string with timezone offset", () => {
    const d = parseUtc("2026-03-22T12:00:00+05:00");
    expect(d.toISOString()).toBe("2026-03-22T07:00:00.000Z");
  });

  it("parses bare datetime (from SQLite) as UTC", () => {
    const d = parseUtc("2026-03-22 13:41:01");
    expect(d.toISOString()).toBe("2026-03-22T13:41:01.000Z");
  });

  it("parses bare date as UTC midnight", () => {
    const d = parseUtc("2026-03-22");
    expect(d.toISOString()).toBe("2026-03-22T00:00:00.000Z");
  });

  it("parses T-separated datetime without Z as UTC", () => {
    const d = parseUtc("2026-03-22T14:30:00");
    expect(d.toISOString()).toBe("2026-03-22T14:30:00.000Z");
  });
});

// ── relativeTime ─────────────────────────────────────────────────────

describe("relativeTime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for times less than a minute ago', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe("just now");
  });

  it("returns minutes ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:30:00Z"));
    expect(relativeTime("2026-03-22T12:25:00Z")).toBe("5m ago");
    vi.useRealTimers();
  });

  it("returns hours ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T15:00:00Z"));
    expect(relativeTime("2026-03-22T12:00:00Z")).toBe("3h ago");
    vi.useRealTimers();
  });

  it('returns "yesterday" for exactly 1 day ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00Z"));
    expect(relativeTime("2026-03-21T12:00:00Z")).toBe("yesterday");
    vi.useRealTimers();
  });

  it("returns days ago for 2-29 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00Z"));
    expect(relativeTime("2026-03-15T12:00:00Z")).toBe("7d ago");
    vi.useRealTimers();
  });

  it("returns formatted date for 30+ days ago", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00Z"));
    const result = relativeTime("2026-01-15T12:00:00Z");
    // Should contain month and day (locale-dependent format)
    expect(result).toContain("Jan");
    expect(result).toContain("15");
    vi.useRealTimers();
  });
});

// ── timeAgo ──────────────────────────────────────────────────────────

describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a human-readable relative time with suffix", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00Z"));
    const result = timeAgo("2026-03-19T12:00:00Z");
    expect(result).toContain("3 days ago");
    vi.useRealTimers();
  });

  it("handles future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00Z"));
    const result = timeAgo("2026-03-25T12:00:00Z");
    expect(result).toContain("in");
    vi.useRealTimers();
  });
});
