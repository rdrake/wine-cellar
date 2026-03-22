import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, renderWithRouter } from "@/test-utils";
import { mockAuthModule } from "@/test-utils";
import type { Device } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Sparkline makes api calls — stub it
vi.mock("@/components/Sparkline", () => ({
  GravitySparkline: () => <div data-testid="sparkline" />,
  TemperatureSparkline: () => <div data-testid="temp-sparkline" />,
}));

const { mockDevicesList, mockBatchList, mockReadingsByDevice } = vi.hoisted(() => ({
  mockDevicesList: vi.fn(),
  mockBatchList: vi.fn(),
  mockReadingsByDevice: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    devices: {
      list: mockDevicesList,
      assign: vi.fn().mockResolvedValue({}),
      unassign: vi.fn().mockResolvedValue({}),
    },
    batches: { list: mockBatchList },
    readings: { listByDevice: mockReadingsByDevice },
  },
}));

import Devices from "./Devices";

// ── Helpers ──────────────────────────────────────────────────────────

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: "dev-1",
    name: "RAPT Pill #1",
    batch_id: null,
    assigned_at: null,
    created_at: "2026-03-10T00:00:00Z",
    updated_at: "2026-03-10T00:00:00Z",
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDevicesList.mockResolvedValue({ items: [] });
  mockBatchList.mockResolvedValue({ items: [] });
  mockReadingsByDevice.mockResolvedValue({ items: [], next_cursor: null });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("Devices page", () => {
  it("renders the page heading", async () => {
    renderWithRouter(<Devices />);
    expect(screen.getByText("Devices")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockDevicesList.mockReturnValue(new Promise(() => {}));
    renderWithRouter(<Devices />);
    expect(screen.getByText("Loading devices...")).toBeInTheDocument();
  });

  it("shows empty state when no devices", async () => {
    renderWithRouter(<Devices />);
    expect(
      await screen.findByText(/No devices registered/),
    ).toBeInTheDocument();
  });

  it("shows error state with retry button", async () => {
    mockDevicesList.mockRejectedValue(new Error("Fetch failed"));
    renderWithRouter(<Devices />);

    expect(await screen.findByText(/Couldn't load devices/)).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("renders device cards with names", async () => {
    mockDevicesList.mockResolvedValue({
      items: [
        makeDevice({ id: "dev-1", name: "RAPT Pill #1" }),
        makeDevice({ id: "dev-2", name: "RAPT Pill #2" }),
      ],
    });

    renderWithRouter(<Devices />);

    expect(await screen.findByText("RAPT Pill #1")).toBeInTheDocument();
    expect(screen.getByText("RAPT Pill #2")).toBeInTheDocument();
  });

  it("shows Assign button for unassigned device", async () => {
    mockDevicesList.mockResolvedValue({
      items: [makeDevice({ batch_id: null })],
    });

    renderWithRouter(<Devices />);

    expect(await screen.findByText("Assign")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("shows Unassign button for assigned device", async () => {
    mockDevicesList.mockResolvedValue({
      items: [makeDevice({ batch_id: "b1", assigned_at: "2026-03-15T00:00:00Z" })],
    });

    renderWithRouter(<Devices />);

    expect(await screen.findByText("Unassign")).toBeInTheDocument();
    expect(screen.getByText("Assigned")).toBeInTheDocument();
  });

  it("shows device ID in mono font", async () => {
    mockDevicesList.mockResolvedValue({
      items: [makeDevice({ id: "abc-123" })],
    });

    renderWithRouter(<Devices />);

    expect(await screen.findByText("abc-123")).toBeInTheDocument();
  });
});
