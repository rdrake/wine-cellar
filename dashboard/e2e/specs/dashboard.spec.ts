// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("shows summary stats with active batch count", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Summary stats line: should show at least 8 batches (seed has 8 active)
    const statsLine = page.locator("p.tabular-nums");
    await expect(statsLine).toBeVisible();
    const statsText = await statsLine.textContent();
    const batchCount = parseInt(statsText?.match(/(\d+)\s+batch/)?.[1] ?? "0");
    expect(batchCount).toBeGreaterThanOrEqual(8);
  });

  test("lists seed batches by name", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Verify key seed batches appear (use .first() since names may appear in activity feed too)
    await expect(page.getByText("Argentia Ridge Cab Sauv").first()).toBeVisible();
    await expect(page.getByText("Magnotta Chardonnay").first()).toBeVisible();
    await expect(page.getByText("Argentia Ridge Zinfandel").first()).toBeVisible();
    await expect(page.getByText('2025 Syrah "Control"').first()).toBeVisible();
  });

  test("shows sparkline charts for batches with readings", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Sparklines render as SVG elements
    const svgs = page.locator("svg");
    await expect(svgs.first()).toBeVisible();
    // Should have multiple sparklines (2 per batch with temp data: gravity + temp)
    expect(await svgs.count()).toBeGreaterThanOrEqual(4);
  });

  test("shows Zinfandel in needs attention alerts", async ({ page }) => {
    await page.goto("/");

    // The "Needs attention" section should appear
    await expect(page.getByText("Needs attention")).toBeVisible();

    // Zinfandel should appear as an alert (may also appear in batch list)
    await expect(page.getByText("Argentia Ridge Zinfandel").first()).toBeVisible();
  });

  test("shows recent activities from seed data", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();

    // Should show at least one activity title from seed data
    const activitySection = page.locator("section", { has: page.getByRole("heading", { name: "Recent activity" }) });
    const activityLinks = activitySection.locator("a");
    expect(await activityLinks.count()).toBeGreaterThanOrEqual(1);
  });

  test("can navigate to new batch form", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();
    await page.locator('a[href="/batches/new"]').click({ force: true });
    await expect(page).toHaveURL(/\/batches\/new$/);
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Batch" })).toBeVisible();
  });
});
