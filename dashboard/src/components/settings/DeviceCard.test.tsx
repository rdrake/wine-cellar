import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, render } from "@/test-utils";
import { mockApiModule } from "@/test-utils";
import userEvent from "@testing-library/user-event";
import { DeviceCard } from "./DeviceCard";
import type { Device, Reading } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────

vi.mock("@/api", () => mockApiModule());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/Sparkline", () => ({
  GravitySparkline: () => <div data-testid="gravity-sparkline" />,
  BatterySparkline: () => <div data-testid="battery-sparkline" />,
  RssiSparkline: () => <div data-testid="rssi-sparkline" />,
}));

const mockDownloadCSV = vi.fn();
const mockDeviceReadingsToCSV = vi.fn().mockReturnValue("csv-content");
vi.mock("@/lib/csv", () => ({
  downloadCSV: (...args: unknown[]) => mockDownloadCSV(...args),
  deviceReadingsToCSV: (...args: unknown[]) => mockDeviceReadingsToCSV(...args),
}));

import { api } from "@/api";

// ── Factories ────────────────────────────────────────────────────

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

function makeReading(overrides: Partial<Reading> = {}): Reading {
  return {
    id: "r-1",
    batch_id: "b-1",
    device_id: "dev-1",
    gravity: 1.045,
    temperature: 22.5,
    battery: 95,
    rssi: -55,
    source: "device",
    source_timestamp: "2026-03-20T12:00:00Z",
    created_at: "2026-03-20T12:00:00Z",
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────

const defaultProps = {
  device: makeDevice(),
  batchName: null,
  onAssign: vi.fn(),
  onUnassign: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.readings.listByDevice).mockResolvedValue({ items: [], next_cursor: null });
});

// ── Tests ────────────────────────────────────────────────────────

describe("DeviceCard", () => {
  it("renders device name and ID", async () => {
    render(<DeviceCard {...defaultProps} />);
    expect(screen.getByText("RAPT Pill #1")).toBeInTheDocument();
    expect(screen.getByText("dev-1")).toBeInTheDocument();
  });

  it("shows Idle status when no batch assigned", async () => {
    render(<DeviceCard {...defaultProps} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
  });

  it("shows Assigned status when batch is assigned", async () => {
    render(
      <DeviceCard
        {...defaultProps}
        device={makeDevice({ batch_id: "b-1", assigned_at: "2026-03-15T00:00:00Z" })}
        batchName="My Batch"
      />,
    );
    expect(screen.getByText("Assigned")).toBeInTheDocument();
    expect(screen.getByText("My Batch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassign" })).toBeInTheDocument();
  });

  it("shows 'No readings received yet' when no data", async () => {
    render(<DeviceCard {...defaultProps} />);
    expect(await screen.findByText("No readings received yet")).toBeInTheDocument();
  });

  it("displays latest reading values", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [makeReading(), makeReading({ id: "r-2", source_timestamp: "2026-03-20T13:00:00Z" })],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    expect(await screen.findByText("1.045")).toBeInTheDocument();
    expect(screen.getByText("22.5")).toBeInTheDocument();
    expect(screen.getByText("95% bat")).toBeInTheDocument();
  });

  it("renders sparklines when 2+ readings", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [makeReading(), makeReading({ id: "r-2", source_timestamp: "2026-03-20T13:00:00Z" })],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    expect(await screen.findByTestId("gravity-sparkline")).toBeInTheDocument();
    expect(screen.getByTestId("battery-sparkline")).toBeInTheDocument();
    expect(screen.getByTestId("rssi-sparkline")).toBeInTheDocument();
  });

  it("shows Export CSV button and calls download on click", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [makeReading(), makeReading({ id: "r-2", source_timestamp: "2026-03-20T13:00:00Z" })],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    const btn = await screen.findByRole("button", { name: "Export CSV" });
    await userEvent.click(btn);
    expect(mockDeviceReadingsToCSV).toHaveBeenCalled();
    expect(mockDownloadCSV).toHaveBeenCalledWith("csv-content", "rapt-pill-1-readings.csv");
  });

  it("calls onAssign when Assign is clicked", async () => {
    render(<DeviceCard {...defaultProps} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(defaultProps.onAssign).toHaveBeenCalledWith(defaultProps.device);
  });

  it("calls onUnassign when Unassign is clicked", async () => {
    const device = makeDevice({ batch_id: "b-1", assigned_at: "2026-03-15T00:00:00Z" });
    render(<DeviceCard {...defaultProps} device={device} batchName="Batch" />);
    await userEvent.click(screen.getByRole("button", { name: "Unassign" }));
    expect(defaultProps.onUnassign).toHaveBeenCalledWith("dev-1");
  });

  it("hides battery sparkline when no battery data", async () => {
    vi.mocked(api.readings.listByDevice).mockResolvedValue({
      items: [
        makeReading({ battery: null, rssi: null }),
        makeReading({ id: "r-2", battery: null, rssi: null, source_timestamp: "2026-03-20T13:00:00Z" }),
      ],
      next_cursor: null,
    });
    render(<DeviceCard {...defaultProps} />);
    await screen.findByTestId("gravity-sparkline");
    expect(screen.queryByTestId("battery-sparkline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rssi-sparkline")).not.toBeInTheDocument();
  });
});
