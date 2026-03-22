import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, renderWithRouter } from "@/test-utils";
import { mockAuthModule } from "@/test-utils";
import userEvent from "@testing-library/user-event";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

const { mockBatchCreate } = vi.hoisted(() => ({
  mockBatchCreate: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    batches: { create: mockBatchCreate },
  },
}));

import BatchNew from "./BatchNew";

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchCreate.mockResolvedValue({ id: "b-new", name: "Test Batch" });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("BatchNew page", () => {
  it("renders the page heading", () => {
    renderWithRouter(<BatchNew />);
    expect(screen.getByText("New Batch")).toBeInTheDocument();
  });

  it("renders quick start template buttons", () => {
    renderWithRouter(<BatchNew />);

    expect(screen.getByText("Red from grapes")).toBeInTheDocument();
    expect(screen.getByText("White from grapes")).toBeInTheDocument();
    expect(screen.getByText("Rosé from grapes")).toBeInTheDocument();
    expect(screen.getByText("Red wine kit")).toBeInTheDocument();
    expect(screen.getByText("White wine kit")).toBeInTheDocument();
    expect(screen.getByText("Juice bucket")).toBeInTheDocument();
  });

  it("renders the batch form with Create Batch submit button", () => {
    renderWithRouter(<BatchNew />);
    expect(screen.getByRole("button", { name: "Create Batch" })).toBeInTheDocument();
  });

  it("renders name input field", () => {
    renderWithRouter(<BatchNew />);
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("renders Cancel button", () => {
    renderWithRouter(<BatchNew />);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("pre-fills form when a template is clicked", async () => {
    const user = userEvent.setup();
    renderWithRouter(<BatchNew />);

    await user.click(screen.getByText("Red wine kit"));

    // Volume should be pre-filled with 23
    const volumeInput = screen.getByLabelText("Volume (L)") as HTMLInputElement;
    expect(volumeInput.value).toBe("23");
  });
});
