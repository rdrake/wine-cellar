/**
 * Shared test utilities for dashboard tests.
 *
 * Re-exports @testing-library/react and provides:
 * - renderWithAuth(): renders a component with a mocked AuthGate context
 * - makeUser(): builds a test user with optional overrides
 * - Common mock factories for API responses
 */
import { vi } from "vitest";

// ── Test user factory ─────────────────────────────────────────────────

interface TestUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export function makeUser(overrides: Partial<TestUser> = {}): TestUser {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    avatarUrl: null,
    ...overrides,
  };
}

// ── Mock setup helpers ────────────────────────────────────────────────

/**
 * Call this inside vi.mock("@/components/AuthGate", ...) to get a mock useAuth.
 * Pass `user` and `isNewUser` to customize per-test.
 */
export function mockAuthModule(
  user: TestUser = makeUser(),
  opts: { isNewUser?: boolean } = {},
) {
  return {
    useAuth: () => ({
      user,
      isNewUser: opts.isNewUser ?? false,
      refreshAuth: vi.fn(),
    }),
  };
}

/**
 * Returns a mock `api` object with all endpoints resolving to empty lists.
 * Override individual methods per-test via vi.mocked().
 */
export function mockApiModule() {
  return {
    api: {
      devices: { list: vi.fn().mockResolvedValue({ items: [] }) },
      batches: { list: vi.fn().mockResolvedValue({ items: [] }) },
      readings: { listByDevice: vi.fn().mockResolvedValue({ items: [], next_cursor: null }) },
      auth: {
        passkeys: { list: vi.fn().mockResolvedValue({ items: [] }) },
        apiKeys: { list: vi.fn().mockResolvedValue({ items: [] }) },
        logout: vi.fn().mockResolvedValue({ status: "ok" }),
      },
      push: {
        vapidKey: vi.fn().mockResolvedValue({ key: "" }),
      },
    },
  };
}

// ── Re-exports for convenience ────────────────────────────────────────

export { render, screen, within, waitFor } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
