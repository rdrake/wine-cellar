import { describe, it, expect, vi } from "vitest";
import { screen, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActivityItem from "./ActivityItem";
import type { Activity } from "@/types";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    batch_id: "batch-1",
    stage: "primary_fermentation",
    type: "measurement",
    title: "SG Reading",
    details: null,
    recorded_at: "2026-03-22T14:30:00Z",
    created_at: "2026-03-22T14:30:00Z",
    updated_at: "2026-03-22T14:30:00Z",
    ...overrides,
  };
}

describe("ActivityItem", () => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();

  it("renders the activity title", () => {
    render(<ActivityItem activity={makeActivity()} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText("SG Reading")).toBeInTheDocument();
  });

  it("renders activity type and stage labels", () => {
    render(<ActivityItem activity={makeActivity()} onEdit={onEdit} onDelete={onDelete} />);
    // "Measurement · Primary Fermentation"
    expect(screen.getByText(/Measurement/)).toBeInTheDocument();
    expect(screen.getByText(/Primary Fermentation/)).toBeInTheDocument();
  });

  it("formats and displays the recorded_at timestamp", () => {
    render(<ActivityItem activity={makeActivity()} onEdit={onEdit} onDelete={onDelete} />);
    // Should show the formatted date — month, day, year, and time
    expect(screen.getByText(/Mar/)).toBeInTheDocument();
    expect(screen.getByText(/22/)).toBeInTheDocument();
  });

  it("renders addition details with chemical, amount, unit", () => {
    const activity = makeActivity({
      type: "addition",
      title: "Added K2S2O5",
      details: { chemical: "K2S2O5", amount: 0.5, unit: "tsp" },
    });
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    // K2S2O5 gets formatted with subscripts
    expect(screen.getByText(/K₂S₂O₅/)).toBeInTheDocument();
    expect(screen.getByText(/0\.5 tsp/)).toBeInTheDocument();
  });

  it("renders measurement details", () => {
    const activity = makeActivity({
      type: "measurement",
      title: "Gravity check",
      details: { metric: "SG", value: 1.045, unit: "" },
    });
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText(/SG: 1.045/)).toBeInTheDocument();
  });

  it("renders racking details with vessel info", () => {
    const activity = makeActivity({
      type: "racking",
      title: "Racked to secondary",
      details: { from_vessel: "Primary bucket", to_vessel: "Glass carboy" },
    });
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText(/Primary bucket/)).toBeInTheDocument();
    expect(screen.getByText(/Glass carboy/)).toBeInTheDocument();
  });

  it("renders tasting details with scores", () => {
    const activity = makeActivity({
      type: "tasting",
      title: "First tasting",
      details: { aroma: "Fruity", flavor: "Balanced", overall_score: 4 },
    });
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText(/Aroma: Fruity/)).toBeInTheDocument();
    expect(screen.getByText(/Flavor: Balanced/)).toBeInTheDocument();
    expect(screen.getByText(/Score: 4\/5/)).toBeInTheDocument();
  });

  it("renders adjustment details", () => {
    const activity = makeActivity({
      type: "adjustment",
      title: "pH adjustment",
      details: { parameter: "pH", from_value: 3.8, to_value: 3.5, unit: "" },
    });
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText(/pH:/)).toBeInTheDocument();
    expect(screen.getByText(/3\.8/)).toBeInTheDocument();
    expect(screen.getByText(/3\.5/)).toBeInTheDocument();
  });

  it("renders note body", () => {
    const activity = makeActivity({
      type: "note",
      title: "Observation",
      details: { body: "Fermentation is vigorous" },
    });
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    expect(screen.getByText("Fermentation is vigorous")).toBeInTheDocument();
  });

  it("does not render details section when details is null", () => {
    const activity = makeActivity({ details: null });
    const { container } = render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);
    // The details div should not be present (class mt-1)
    const detailsDiv = container.querySelector(".mt-1");
    expect(detailsDiv).toBeNull();
  });

  it("calls onEdit when Edit button is clicked", async () => {
    const activity = makeActivity();
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(activity);
  });

  it("calls onDelete when Delete button is clicked", async () => {
    const activity = makeActivity();
    render(<ActivityItem activity={activity} onEdit={onEdit} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("act-1");
  });
});
