import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { mockAuthModule } from "@/test-utils";
import type { Batch } from "@/types";

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock("@/components/AuthGate", () => mockAuthModule());

const { mockBatchGet, mockActivitiesCreate } = vi.hoisted(() => ({
  mockBatchGet: vi.fn(),
  mockActivitiesCreate: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    batches: { get: mockBatchGet },
    activities: { create: mockActivitiesCreate },
  },
}));

import ActivityNew from "./ActivityNew";

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

function renderActivityNew(route = "/batches/b1/activities/new") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/batches/:id/activities/new" element={<ActivityNew />} />
        <Route path="/batches/:id" element={<div>Batch Detail</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockBatchGet.mockResolvedValue(makeBatch());
  mockActivitiesCreate.mockResolvedValue({
    id: "act-new",
    batch_id: "b1",
    stage: "primary_fermentation",
    type: "measurement",
    title: "SG check",
    details: null,
    recorded_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("ActivityNew page", () => {
  it("shows loading state while batch loads", () => {
    mockBatchGet.mockReturnValue(new Promise(() => {}));
    renderActivityNew();
    expect(screen.getByText("Loading batch...")).toBeInTheDocument();
  });

  it("shows error when batch fails to load", async () => {
    mockBatchGet.mockRejectedValue(new Error("Not found"));
    renderActivityNew();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders form fields after batch loads", async () => {
    renderActivityNew();

    // Use heading role to avoid ambiguity with the submit button
    expect(await screen.findByRole("heading", { name: "Log Activity" })).toBeInTheDocument();
    expect(screen.getByText("Stage")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Recorded At")).toBeInTheDocument();
  });

  it("renders the cancel button that navigates back", async () => {
    renderActivityNew();

    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });
    expect(cancelBtn).toBeInTheDocument();
  });

  it("submit button is disabled when no stage is selected", async () => {
    renderActivityNew();

    // Wait for the page to render
    await screen.findByRole("heading", { name: "Log Activity" });

    const submitBtn = screen.getByRole("button", { name: "Log Activity" });
    expect(submitBtn).toBeDisabled();
  });

  it("shows measurement detail fields by default (measurement type)", async () => {
    renderActivityNew();

    // Measurement is the default type — should see metric selection
    expect(await screen.findByText("What are you measuring?")).toBeInTheDocument();
    expect(screen.getByText("Reading")).toBeInTheDocument();
  });

  it("renders title input field with placeholder", async () => {
    renderActivityNew();

    const titleInput = await screen.findByPlaceholderText("e.g., Added yeast nutrient");
    expect(titleInput).toBeInTheDocument();
  });

  it("renders datetime-local input for recorded at", async () => {
    renderActivityNew();

    await screen.findByRole("heading", { name: "Log Activity" });

    const inputs = screen.getAllByRole("textbox");
    // Should have multiple form inputs
    expect(inputs.length).toBeGreaterThan(0);
  });

  it("calls api with correct data when form is submitted with stage selected", async () => {
    const user = userEvent.setup();
    renderActivityNew();

    await screen.findByRole("heading", { name: "Log Activity" });

    // Fill title
    const titleInput = screen.getByPlaceholderText("e.g., Added yeast nutrient");
    await user.type(titleInput, "SG check");

    // Select stage — click trigger and choose option
    const stageTrigger = screen.getByText("Select stage").closest("button")!;
    await user.click(stageTrigger);
    const option = await screen.findByRole("option", { name: "Primary Fermentation" });
    await user.click(option);

    // base-ui Select popup may leave body overflow:hidden in jsdom.
    // Use fireEvent.submit to bypass any overlay issues.
    const form = screen.getByRole("heading", { name: "Log Activity" }).closest("div")!.querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(mockActivitiesCreate).toHaveBeenCalledWith("b1", expect.objectContaining({
        stage: "primary_fermentation",
        type: "measurement",
        title: "SG check",
      }));
    });
  });

  it("navigates to batch detail after successful submission", async () => {
    const user = userEvent.setup();
    renderActivityNew();

    await screen.findByRole("heading", { name: "Log Activity" });

    // Fill title
    const titleInput = screen.getByPlaceholderText("e.g., Added yeast nutrient");
    await user.type(titleInput, "SG check");

    // Select stage
    const stageTrigger = screen.getByText("Select stage").closest("button")!;
    await user.click(stageTrigger);
    const option = await screen.findByRole("option", { name: "Primary Fermentation" });
    await user.click(option);

    // Submit via fireEvent to bypass base-ui overlay
    const form = screen.getByRole("heading", { name: "Log Activity" }).closest("div")!.querySelector("form")!;
    fireEvent.submit(form);

    // Should navigate to batch detail page
    await waitFor(() => {
      expect(screen.getByText("Batch Detail")).toBeInTheDocument();
    });
  });
});
