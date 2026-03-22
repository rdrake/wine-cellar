import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

// Mock @simplewebauthn/browser before any imports that use it
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
}));

// Mock the API module — return empty lists for all fetch calls
vi.mock("@/api", () => ({
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
}));

// Mock AuthGate to provide a fake user context
vi.mock("@/components/AuthGate", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      email: "test@example.com",
      name: "Test User",
      avatarUrl: null,
    },
    isNewUser: false,
    refreshAuth: vi.fn(),
  }),
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import Settings from "./Settings";

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  // jsdom doesn't have serviceWorker or PushManager
  // The NotificationsSection checks for these and gracefully degrades
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe("Settings page", () => {
  it("renders the three Card group titles", async () => {
    render(<Settings />);

    expect(await screen.findByText("Devices")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
  });

  it("renders the Passkeys section inside the Security card", async () => {
    render(<Settings />);

    // Wait for async data to settle
    expect(await screen.findByText("Passkeys")).toBeInTheDocument();

    // Passkeys section should display its description
    expect(
      screen.getByText("Sign in with biometrics or a security key."),
    ).toBeInTheDocument();
  });

  it("renders the API Keys section inside the Security card", async () => {
    render(<Settings />);

    // Wait for async data to settle
    expect(await screen.findByText("API Keys")).toBeInTheDocument();

    // API Keys section should display its description
    expect(
      screen.getByText("For MCP servers and automation."),
    ).toBeInTheDocument();
  });

  it("shows the logged-in user info in the Account card", async () => {
    render(<Settings />);

    expect(await screen.findByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
  });

  it("shows empty states when no data is present", async () => {
    render(<Settings />);

    expect(
      await screen.findByText("No passkeys registered."),
    ).toBeInTheDocument();
    expect(screen.getByText("No API keys yet.")).toBeInTheDocument();
  });
});
