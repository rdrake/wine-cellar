import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, renderWithRouter } from "@/test-utils";
import { mockAuthModule } from "@/test-utils";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

// api mock — must use vi.hoisted so the reference is available in the hoisted vi.mock call
const { mockDashboard } = vi.hoisted(() => ({
  mockDashboard: vi.fn().mockResolvedValue({ active_batches: [], recent_activities: [], alerts: [] }),
}));

vi.mock("@/api", () => ({
  api: {
    dashboard: mockDashboard,
    alerts: { dismiss: vi.fn().mockResolvedValue({}) },
  },
}));

import Dashboard from "./Dashboard";

beforeEach(() => {
  vi.clearAllMocks();
  mockDashboard.mockResolvedValue({ active_batches: [], recent_activities: [], alerts: [] });
});

describe("Dashboard page", () => {
  it("renders empty state when no batches", async () => {
    renderWithRouter(<Dashboard />);

    expect(
      await screen.findByText(/No active batches yet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/No activities yet/)).toBeInTheDocument();
  });

  it("renders batch names when data is present", async () => {
    mockDashboard.mockResolvedValueOnce({
      active_batches: [
        {
          id: "b1",
          name: "2026 Merlot",
          wine_type: "red",
          stage: "primary_fermentation",
          status: "active",
          days_fermenting: 5,
          first_reading: null,
          latest_reading: null,
          velocity: null,
          sparkline: [],
        },
      ],
      recent_activities: [],
      alerts: [],
    });

    renderWithRouter(<Dashboard />);

    expect(await screen.findByText("2026 Merlot")).toBeInTheDocument();
    expect(screen.getByText("Active batches")).toBeInTheDocument();
  });

  it("renders alerts section", async () => {
    mockDashboard.mockResolvedValueOnce({
      active_batches: [],
      recent_activities: [],
      alerts: [
        {
          id: "a1",
          batch_id: "b1",
          batch_name: "Test Wine",
          alert_type: "temp_high",
          context: '{"message":"32\\u00B0C \\u2014 too hot"}',
          fired_at: "2026-03-22T12:00:00Z",
        },
      ],
    });

    renderWithRouter(<Dashboard />);

    expect(await screen.findByText(/too hot/)).toBeInTheDocument();
  });

  it("renders recent activities", async () => {
    mockDashboard.mockResolvedValueOnce({
      active_batches: [],
      recent_activities: [
        {
          id: "act1",
          batch_id: "b1",
          batch_name: "Merlot",
          stage: "primary_fermentation",
          type: "note",
          title: "Added yeast",
          details: null,
          recorded_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      alerts: [],
    });

    renderWithRouter(<Dashboard />);

    expect(await screen.findByText("Added yeast")).toBeInTheDocument();
    expect(screen.getByText(/Merlot/)).toBeInTheDocument();
  });
});
