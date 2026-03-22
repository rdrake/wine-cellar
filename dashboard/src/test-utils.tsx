/**
 * Shared test utilities for dashboard tests.
 *
 * Re-exports @testing-library/react and provides:
 * - makeUser(): builds a test user with optional overrides
 * - mockAuthModule / mockApiModule: factories for vi.mock() calls
 * - renderWithRouter(): renders inside a MemoryRouter
 */
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ReactElement } from "react";

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
 * Returns a mock `api` object with all endpoints resolving to empty data.
 * Override individual methods per-test via vi.mocked().
 */
export function mockApiModule() {
  return {
    api: {
      dashboard: vi.fn().mockResolvedValue({ active_batches: [], recent_activities: [], alerts: [] }),
      devices: { list: vi.fn().mockResolvedValue({ items: [] }) },
      batches: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        get: vi.fn().mockResolvedValue(null),
      },
      readings: {
        listByBatch: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
        listByDevice: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
      },
      activities: {
        list: vi.fn().mockResolvedValue({ items: [] }),
      },
      alerts: {
        dismiss: vi.fn().mockResolvedValue({}),
      },
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

// ── Render helpers ────────────────────────────────────────────────────

export function renderWithRouter(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}

// ── Re-exports for convenience ────────────────────────────────────────

export { render, screen, within, waitFor } from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
