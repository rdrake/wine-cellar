// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Batch detail (seed data)", () => {
  test("shows snapshot card with fermentation data for Cab Sauv", async ({ page }) => {
    // Navigate to dashboard first, then click through to the Cab Sauv
    await page.goto("/");
    await expect(page.getByText("Argentia Ridge Cab Sauv").first()).toBeVisible();
    await page.getByText("Argentia Ridge Cab Sauv").first().click();

    // Should be on batch detail page
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Should show current SG somewhere on the page
    await expect(page.getByText("Current SG")).toBeVisible();

    // Stage should be Primary Fermentation (use first() — appears in multiple contexts)
    await expect(page.getByText("Primary Fermentation").first()).toBeVisible();

    // Should show wine type (use first() — "Red" appears in multiple contexts)
    await expect(page.getByText("Red").first()).toBeVisible();
  });

  test("renders gravity chart with data points", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Argentia Ridge Cab Sauv").first().click();
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Recharts renders as SVG with class .recharts-wrapper
    const chart = page.locator(".recharts-wrapper");
    await expect(chart.first()).toBeVisible({ timeout: 10_000 });
  });

  test("shows seeded activities in timeline", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Argentia Ridge Cab Sauv").first().click();
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Should show the "Pitched yeast" activity from seed
    await expect(page.getByText("Pitched yeast")).toBeVisible();
  });

  test("shows device assignment", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Argentia Ridge Cab Sauv").first().click();
    await expect(page.getByRole("heading", { name: "Argentia Ridge Cab Sauv" })).toBeVisible();

    // Should show the assigned device name (appears in snapshot card and Devices section)
    await expect(page.getByText("Rapt Pill #1").first()).toBeVisible();
  });
});
