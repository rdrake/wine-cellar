import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, render } from "@/test-utils";
import { mockApiModule, mockAuthModule } from "@/test-utils";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
}));

vi.mock("@/api", () => mockApiModule());
vi.mock("@/components/AuthGate", () => mockAuthModule());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Settings from "./Settings";

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
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

    expect(await screen.findByText("Passkeys")).toBeInTheDocument();
    expect(
      screen.getByText("Sign in with biometrics or a security key."),
    ).toBeInTheDocument();
  });

  it("renders the API Keys section inside the Security card", async () => {
    render(<Settings />);

    expect(await screen.findByText("API Keys")).toBeInTheDocument();
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
