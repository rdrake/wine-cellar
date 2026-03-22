import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, renderWithRouter } from "@/test-utils";
import { mockAuthModule } from "@/test-utils";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { mockUpdateMe, mockRegisterOptions, mockRegister } = vi.hoisted(() => ({
  mockUpdateMe: vi.fn(),
  mockRegisterOptions: vi.fn(),
  mockRegister: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    users: { updateMe: mockUpdateMe },
    auth: {
      registerOptions: mockRegisterOptions,
      register: mockRegister,
    },
  },
}));

import { Welcome } from "./Welcome";

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateMe.mockResolvedValue({ id: "u1", email: "test@example.com", name: "Test User", avatarUrl: null, onboarded: true });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("Welcome page", () => {
  it("renders the welcome heading", () => {
    renderWithRouter(<Welcome />);
    expect(screen.getByText("Welcome to Wine Cellar")).toBeInTheDocument();
  });

  it("renders the subtitle", () => {
    renderWithRouter(<Welcome />);
    expect(screen.getByText("Set up your account")).toBeInTheDocument();
  });

  it("renders display name input pre-filled from user", () => {
    renderWithRouter(<Welcome />);
    const input = screen.getByLabelText("Display name") as HTMLInputElement;
    expect(input.value).toBe("Test User");
  });

  it("renders passkey setup button", () => {
    renderWithRouter(<Welcome />);
    expect(
      screen.getByRole("button", { name: "Set up Face ID / Touch ID" }),
    ).toBeInTheDocument();
  });

  it("renders continue button", () => {
    renderWithRouter(<Welcome />);
    expect(
      screen.getByRole("button", { name: "Continue to dashboard" }),
    ).toBeInTheDocument();
  });

  it("shows passkey description text", () => {
    renderWithRouter(<Welcome />);
    expect(
      screen.getByText(/Add a passkey for quick access/),
    ).toBeInTheDocument();
  });
});
