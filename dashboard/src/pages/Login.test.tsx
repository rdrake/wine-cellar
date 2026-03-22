import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, render } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
}));

const { mockAuthSettings, mockLoginOptions } = vi.hoisted(() => ({
  mockAuthSettings: vi.fn(),
  mockLoginOptions: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    auth: {
      settings: mockAuthSettings,
      loginOptions: mockLoginOptions,
      login: vi.fn(),
    },
  },
}));

import { Login } from "./Login";

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthSettings.mockResolvedValue({ registrationsOpen: true });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("Login page", () => {
  it("renders the Wine Cellar title", () => {
    render(<Login />);
    expect(screen.getByText("Wine Cellar")).toBeInTheDocument();
  });

  it("renders GitHub sign-in link", () => {
    render(<Login />);
    expect(screen.getByText("Sign in with GitHub")).toBeInTheDocument();
  });

  it("renders passkey sign-in button", () => {
    render(<Login />);
    expect(screen.getByText("Sign in with Passkey")).toBeInTheDocument();
  });

  it("renders the 'or' divider", () => {
    render(<Login />);
    expect(screen.getByText("or")).toBeInTheDocument();
  });

  it("shows registrations closed message when signups are disabled", async () => {
    mockAuthSettings.mockResolvedValue({ registrationsOpen: false });
    render(<Login />);

    expect(
      await screen.findByText("New signups are currently closed"),
    ).toBeInTheDocument();
  });

  it("GitHub link points to the OAuth endpoint", () => {
    render(<Login />);
    const link = screen.getByText("Sign in with GitHub");
    expect(link.closest("a")).toHaveAttribute("href", "/api/v1/auth/github");
  });
});
