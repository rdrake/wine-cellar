import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, renderWithRouter } from "@/test-utils";
import { mockAuthModule } from "@/test-utils";
import type { Batch } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

vi.mock("@/components/BatchCard", () => ({
  default: ({ batch }: { batch: Batch }) => (
    <div data-testid="batch-card">{batch.name}</div>
  ),
}));

const { mockBatchList } = vi.hoisted(() => ({
  mockBatchList: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    batches: { list: mockBatchList },
    readings: { listByBatch: vi.fn().mockResolvedValue({ items: [], next_cursor: null }) },
  },
}));

import BatchList from "./BatchList";

// ── Helpers ──────────────────────────────────────────────────────────

function makeBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: "b1",
    name: "2026 Merlot",
    wine_type: "red",
    source_material: "fresh_grapes",
    stage: "primary_fermentation",
    status: "active",
    volume_liters: 23,
    target_volume_liters: null,
    target_gravity: null,
    yeast_strain: null,
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: null,
    bottled_at: null,
    started_at: "2026-03-15T00:00:00Z",
    completed_at: null,
    notes: null,
    created_at: "2026-03-15T00:00:00Z",
    updated_at: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchList.mockResolvedValue({ items: [] });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("BatchList page", () => {
  it("renders the page heading", async () => {
    renderWithRouter(<BatchList />);
    expect(screen.getByText("Batches")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockBatchList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<BatchList />);
    expect(screen.getByText("Fetching your batches...")).toBeInTheDocument();
  });

  it("shows empty state for active batches", async () => {
    renderWithRouter(<BatchList />);
    expect(
      await screen.findByText(/No batches yet/),
    ).toBeInTheDocument();
  });

  it("renders batch cards when data is present", async () => {
    mockBatchList.mockResolvedValue({
      items: [
        makeBatch({ id: "b1", name: "Merlot" }),
        makeBatch({ id: "b2", name: "Chardonnay" }),
      ],
    });

    renderWithRouter(<BatchList />);

    expect(await screen.findByText("Merlot")).toBeInTheDocument();
    expect(screen.getByText("Chardonnay")).toBeInTheDocument();
    expect(screen.getAllByTestId("batch-card")).toHaveLength(2);
  });

  it("shows error state with retry button", async () => {
    mockBatchList.mockRejectedValue(new Error("Network error"));

    renderWithRouter(<BatchList />);

    expect(await screen.findByText(/Couldn't load batches/)).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("renders status tabs", () => {
    renderWithRouter(<BatchList />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Abandoned")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("renders the + button linking to new batch", () => {
    renderWithRouter(<BatchList />);
    expect(screen.getByText("+")).toBeInTheDocument();
  });

  it("renders Compare button", () => {
    renderWithRouter(<BatchList />);
    expect(screen.getByText("Compare")).toBeInTheDocument();
  });
});
