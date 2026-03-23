import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockAuthModule } from "@/test-utils";
import type { Batch, Reading } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Recharts doesn't render well in jsdom — stub the chart
vi.mock("@/components/ReadingsChart", () => ({
  default: ({ readings }: { readings: unknown[] }) => (
    <div data-testid="readings-chart">{readings.length} readings</div>
  ),
}));

vi.mock("@/components/DeviceSection", () => ({
  default: () => <div data-testid="device-section">Device Section</div>,
}));

vi.mock("@/components/ExportButton", () => ({
  default: () => <button>Export</button>,
}));

vi.mock("@/components/NudgeBar", () => ({
  default: () => <div data-testid="nudge-bar">Nudges</div>,
}));

vi.mock("@/components/BatchTimeline", () => ({
  default: () => <div data-testid="batch-timeline">Timeline</div>,
}));

vi.mock("@/components/CellaringCard", () => ({
  default: () => <div data-testid="cellaring-card">Cellaring</div>,
}));

const { mockBatchGet, mockReadingsList, mockActivitiesList, mockDevicesList, mockBatchComplete, mockBatchAbandon } = vi.hoisted(() => ({
  mockBatchGet: vi.fn(),
  mockReadingsList: vi.fn(),
  mockActivitiesList: vi.fn(),
  mockDevicesList: vi.fn(),
  mockBatchComplete: vi.fn(),
  mockBatchAbandon: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    batches: {
      get: mockBatchGet,
      complete: mockBatchComplete,
      abandon: mockBatchAbandon,
      archive: vi.fn().mockResolvedValue({}),
      unarchive: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      setStage: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    readings: { listByBatch: mockReadingsList },
    activities: { list: mockActivitiesList },
    devices: { list: mockDevicesList },
    alerts: { dismiss: vi.fn().mockResolvedValue({}) },
  },
}));

import BatchDetail from "./BatchDetail";

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

function makeReading(overrides: Partial<Reading> = {}): Reading {
  return {
    id: "r1",
    batch_id: "b1",
    device_id: "d1",
    gravity: 1.045,
    temperature: 20,
    battery: 90,
    rssi: -55,
    source_timestamp: "2026-03-20T12:00:00Z",
    source: "device",
    created_at: "2026-03-20T12:00:00Z",
    ...overrides,
  };
}

function renderBatchDetail(route = "/batches/b1") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/batches/:id" element={<BatchDetail />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchGet.mockResolvedValue(makeBatch());
  mockReadingsList.mockResolvedValue({ items: [], next_cursor: null });
  mockActivitiesList.mockResolvedValue({ items: [] });
  mockDevicesList.mockResolvedValue({ items: [] });
  mockBatchComplete.mockResolvedValue(makeBatch({ status: "completed" }));
  mockBatchAbandon.mockResolvedValue(makeBatch({ status: "abandoned" }));
});

describe("BatchDetail page", () => {
  it("shows loading state initially", () => {
    mockBatchGet.mockReturnValue(new Promise(() => {})); // never resolves
    renderBatchDetail();
    expect(screen.getByText("Loading batch details...")).toBeInTheDocument();
  });

  it("renders batch name, wine type, stage, and status", async () => {
    renderBatchDetail();

    expect(await screen.findByText("2026 Merlot")).toBeInTheDocument();
    expect(screen.getByText(/Red/)).toBeInTheDocument();
    expect(screen.getByText(/Fresh Grapes/)).toBeInTheDocument();
    expect(screen.getByText("Primary Fermentation")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows readings chart with readings data", async () => {
    const readings = [
      makeReading({ id: "r1", gravity: 1.050, source_timestamp: "2026-03-18T12:00:00Z" }),
      makeReading({ id: "r2", gravity: 1.040, source_timestamp: "2026-03-20T12:00:00Z" }),
    ];
    mockReadingsList.mockResolvedValue({ items: readings, next_cursor: null });

    renderBatchDetail();

    expect(await screen.findByTestId("readings-chart")).toBeInTheDocument();
    expect(screen.getByText("2 readings")).toBeInTheDocument();
  });

  it("shows empty chart state when no readings", async () => {
    renderBatchDetail();

    expect(await screen.findByTestId("readings-chart")).toBeInTheDocument();
    expect(screen.getByText("0 readings")).toBeInTheDocument();
  });

  it("renders activities section", async () => {
    mockActivitiesList.mockResolvedValue({
      items: [
        {
          id: "act1",
          batch_id: "b1",
          stage: "primary_fermentation",
          type: "note",
          title: "Added yeast",
          details: null,
          recorded_at: "2026-03-16T10:00:00Z",
          created_at: "2026-03-16T10:00:00Z",
          updated_at: "2026-03-16T10:00:00Z",
        },
      ],
    });

    renderBatchDetail();

    expect(await screen.findByText("Added yeast")).toBeInTheDocument();
  });

  it("shows Complete button for active batch", async () => {
    renderBatchDetail();

    expect(await screen.findByRole("button", { name: "Complete" })).toBeInTheDocument();
  });

  it("shows Abandon button for active batch with confirmation dialog", async () => {
    renderBatchDetail();

    const abandonBtn = await screen.findByRole("button", { name: "Abandon" });
    expect(abandonBtn).toBeInTheDocument();

    await userEvent.click(abandonBtn);

    // Confirmation dialog should appear
    expect(await screen.findByText("Abandon batch?")).toBeInTheDocument();
    expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abandon" })).toBeInTheDocument();
  });

  it("shows Reopen button for completed batch", async () => {
    mockBatchGet.mockResolvedValue(makeBatch({ status: "completed", completed_at: "2026-03-22T00:00:00Z" }));
    renderBatchDetail();

    expect(await screen.findByRole("button", { name: "Reopen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("notes expand/collapse behavior", async () => {
    mockBatchGet.mockResolvedValue(makeBatch({ notes: "This is a great batch of wine" }));
    renderBatchDetail();

    // Notes section should show the toggle
    const notesBtn = await screen.findByText("Batch Notes");
    expect(notesBtn).toBeInTheDocument();

    // Notes content should be hidden initially
    expect(screen.queryByText("This is a great batch of wine")).not.toBeInTheDocument();

    // Click to expand
    await userEvent.click(notesBtn);
    expect(screen.getByText("This is a great batch of wine")).toBeInTheDocument();

    // Click to collapse
    await userEvent.click(notesBtn);
    expect(screen.queryByText("This is a great batch of wine")).not.toBeInTheDocument();
  });

  it("shows error state and retry button", async () => {
    mockBatchGet.mockRejectedValue(new Error("Server error"));
    renderBatchDetail();

    expect(await screen.findByText(/Couldn't load batch/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows snapshot stats when readings are present", async () => {
    const readings = [
      makeReading({ id: "r1", gravity: 1.050, temperature: 18, source_timestamp: "2026-03-18T12:00:00Z" }),
      makeReading({ id: "r2", gravity: 1.040, temperature: 22, source_timestamp: "2026-03-20T12:00:00Z" }),
    ];
    mockReadingsList.mockResolvedValue({ items: readings, next_cursor: null });

    renderBatchDetail();

    // Should show Current SG
    expect(await screen.findByText("Current SG")).toBeInTheDocument();
    expect(screen.getByText("1.040")).toBeInTheDocument();
    // Should show Est. ABV
    expect(screen.getByText("Est. ABV")).toBeInTheDocument();
    // Should show temperature
    expect(screen.getByText("Temperature")).toBeInTheDocument();
  });

  it("shows 'No readings yet' when batch has no readings", async () => {
    renderBatchDetail();

    expect(await screen.findByText("No readings yet")).toBeInTheDocument();
  });

  it("shows + Log Activity link for active batch", async () => {
    renderBatchDetail();

    expect(await screen.findByRole("link", { name: "+ Log Activity" })).toBeInTheDocument();
  });

  it("shows Set Stage dropdown for active batch", async () => {
    renderBatchDetail();

    expect(await screen.findByRole("button", { name: "Set Stage" })).toBeInTheDocument();
  });

  it("shows device battery and signal strength", async () => {
    const readings = [
      makeReading({ id: "r1", gravity: 1.050, source_timestamp: "2026-03-18T12:00:00Z" }),
      makeReading({ id: "r2", gravity: 1.040, source_timestamp: "2026-03-20T12:00:00Z" }),
    ];
    mockReadingsList.mockResolvedValue({ items: readings, next_cursor: null });

    renderBatchDetail();
    await screen.findByText("2026 Merlot");

    expect(screen.getByText("90% bat")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument(); // rssi -55 → "Good"
  });
});
