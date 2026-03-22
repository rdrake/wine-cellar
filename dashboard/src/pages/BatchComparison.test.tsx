import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, renderWithRouter } from "@/test-utils";
import { mockAuthModule } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import type { Batch } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

// Recharts doesn't render in jsdom — stub the chart components
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div>,
  Line: () => <div data-testid="chart-line" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
}));

vi.mock("@/hooks/useChartColors", () => ({
  useChartColors: () => ({
    chart1: "#000", chart2: "#111", chart3: "#222", chart4: "#333", chart5: "#444",
    foreground: "#000", mutedForeground: "#666", card: "#fff", cardForeground: "#000", border: "#ccc",
  }),
}));

const { mockBatchList, mockReadingsList } = vi.hoisted(() => ({
  mockBatchList: vi.fn(),
  mockReadingsList: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    batches: { list: mockBatchList },
    readings: { listByBatch: mockReadingsList },
  },
}));

import BatchComparison from "./BatchComparison";

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
  mockReadingsList.mockResolvedValue({ items: [], next_cursor: null });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("BatchComparison page", () => {
  it("renders the page heading", async () => {
    renderWithRouter(<BatchComparison />);
    expect(screen.getByText("Compare Batches")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockBatchList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<BatchComparison />);
    expect(screen.getByText("Loading batches...")).toBeInTheDocument();
  });

  it("shows error state", async () => {
    mockBatchList.mockRejectedValue(new Error("Server error"));
    renderWithRouter(<BatchComparison />);
    expect(await screen.findByText("Server error")).toBeInTheDocument();
  });

  it("shows prompt to select batches when none selected", async () => {
    mockBatchList.mockResolvedValue({
      items: [makeBatch()],
    });

    renderWithRouter(<BatchComparison />);

    expect(
      await screen.findByText(/Select up to 5 batches/),
    ).toBeInTheDocument();
  });

  it("renders batch name badges as selectors", async () => {
    mockBatchList.mockResolvedValue({
      items: [
        makeBatch({ id: "b1", name: "Merlot" }),
        makeBatch({ id: "b2", name: "Chardonnay" }),
      ],
    });

    renderWithRouter(<BatchComparison />);

    expect(await screen.findByText("Merlot")).toBeInTheDocument();
    expect(screen.getByText("Chardonnay")).toBeInTheDocument();
  });

  it("fetches readings when a batch is selected", async () => {
    const user = userEvent.setup();
    mockBatchList.mockResolvedValue({
      items: [makeBatch({ id: "b1", name: "Merlot" })],
    });

    renderWithRouter(<BatchComparison />);

    const badge = await screen.findByText("Merlot");
    await user.click(badge);

    expect(mockReadingsList).toHaveBeenCalledWith("b1", { limit: 500 });
  });
});
