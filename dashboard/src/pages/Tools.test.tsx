import { describe, it, expect, vi } from "vitest";
import { screen, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/AuthGate", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "test@example.com", name: "Test", avatarUrl: null },
    isNewUser: false,
    refreshAuth: vi.fn(),
  }),
}));

import Tools from "./Tools";

describe("Tools page", () => {
  it("renders the page heading", () => {
    render(<Tools />);
    expect(screen.getByText("Winemaking Calculators")).toBeInTheDocument();
  });

  it("renders all five calculator card titles", () => {
    render(<Tools />);
    expect(screen.getByText("ABV")).toBeInTheDocument();
    expect(screen.getByText("Chaptalization")).toBeInTheDocument();
    expect(screen.getByText("Sulfite Addition")).toBeInTheDocument();
    expect(screen.getByText("Hydrometer Correction")).toBeInTheDocument();
    expect(screen.getByText("Calibration Solution")).toBeInTheDocument();
  });

  it("ABV calculator is open by default and shows results", () => {
    render(<Tools />);
    expect(screen.getByText("Estimated ABV")).toBeInTheDocument();
    expect(screen.getByText("Apparent Attenuation")).toBeInTheDocument();
  });

  it("Chaptalization is collapsed by default", () => {
    render(<Tools />);
    // Description is visible in the collapsed header
    expect(screen.getByText(/How much sugar/)).toBeInTheDocument();
    // But the slider fields are not rendered
    expect(screen.queryByLabelText("Batch Volume (L)")).not.toBeInTheDocument();
  });

  it("clicking a collapsed calculator expands it", async () => {
    const user = userEvent.setup();
    render(<Tools />);

    // Click Chaptalization header to expand
    await user.click(screen.getByText("Chaptalization"));

    // Now the slider labels should be visible
    expect(screen.getByText("Current SG")).toBeInTheDocument();
    expect(screen.getByText("Target SG")).toBeInTheDocument();
  });

  it("ABV calculator computes correct values for default inputs", () => {
    render(<Tools />);

    // Default: OG=1.090, FG=0.996 → ABV = (1.090-0.996)*131.25 = 12.3%
    expect(screen.getByText("12.3")).toBeInTheDocument();
  });
});
