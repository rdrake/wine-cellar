// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Batch comparison (seed data)", () => {
  test("can select both Syrah batches and see overlaid charts", async ({ page }) => {
    await page.goto("/compare");

    // The comparison page should load
    await expect(page.getByText("Compare")).toBeVisible();

    // Find and select the Control Syrah (rendered as <button> with <Badge>)
    const controlButton = page.getByRole("button", { name: /2025 Syrah.*Control/ });
    await expect(controlButton).toBeVisible({ timeout: 10_000 });
    await controlButton.click();

    // Find and select the Oak Chips Syrah
    const oakButton = page.getByRole("button", { name: /2025 Syrah.*Oak Chips/ });
    await expect(oakButton).toBeVisible();
    await oakButton.click();

    // Chart should render with data
    const chart = page.locator(".recharts-wrapper");
    await expect(chart.first()).toBeVisible({ timeout: 10_000 });

    // Should have multiple lines (one per selected batch)
    const lines = chart.locator(".recharts-line");
    expect(await lines.count()).toBeGreaterThanOrEqual(2);
  });
});
