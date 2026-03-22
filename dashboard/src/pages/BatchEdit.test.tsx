import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockAuthModule } from "@/test-utils";
import type { Batch } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

const { mockBatchGet, mockBatchUpdate } = vi.hoisted(() => ({
  mockBatchGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    batches: {
      get: mockBatchGet,
      update: mockBatchUpdate,
    },
  },
}));

import BatchEdit from "./BatchEdit";

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
    target_volume_liters: 21,
    target_gravity: null,
    yeast_strain: "RC212",
    oak_type: null,
    oak_format: null,
    oak_duration_days: null,
    mlf_status: null,
    bottled_at: null,
    started_at: "2026-03-15T00:00:00Z",
    completed_at: null,
    notes: "Test notes",
    created_at: "2026-03-15T00:00:00Z",
    updated_at: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

function renderBatchEdit(route = "/batches/b1/edit") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/batches/:id/edit" element={<BatchEdit />} />
        <Route path="/batches/:id" element={<div>Batch Detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchGet.mockResolvedValue(makeBatch());
  mockBatchUpdate.mockResolvedValue(makeBatch());
});

// ── Tests ────────────────────────────────────────────────────────────

describe("BatchEdit page", () => {
  it("shows loading state while batch loads", () => {
    mockBatchGet.mockReturnValue(new Promise(() => {}));
    renderBatchEdit();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows error when batch fails to load", async () => {
    mockBatchGet.mockRejectedValue(new Error("Not found"));
    renderBatchEdit();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("renders heading after batch loads", async () => {
    renderBatchEdit();
    expect(await screen.findByText("Edit Batch")).toBeInTheDocument();
  });

  it("renders Save Changes submit button", async () => {
    renderBatchEdit();
    expect(await screen.findByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("pre-fills name from batch data", async () => {
    renderBatchEdit();
    const nameInput = await screen.findByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("2026 Merlot");
  });

  it("pre-fills volume from batch data", async () => {
    renderBatchEdit();
    const volumeInput = await screen.findByLabelText("Volume (L)") as HTMLInputElement;
    expect(volumeInput.value).toBe("23");
  });

  it("pre-fills notes from batch data", async () => {
    renderBatchEdit();
    const notesInput = await screen.findByLabelText("Notes") as HTMLTextAreaElement;
    expect(notesInput.value).toBe("Test notes");
  });

  it("does not show wine type or source material selects (edit mode)", async () => {
    renderBatchEdit();
    await screen.findByText("Edit Batch");
    expect(screen.queryByLabelText("Wine Type")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Source Material")).not.toBeInTheDocument();
  });

  it("renders Cancel button", async () => {
    renderBatchEdit();
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
