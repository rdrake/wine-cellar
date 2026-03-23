// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Alerts (seed data)", () => {
  test("Zinfandel stall alert is visible on dashboard", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Needs attention")).toBeVisible();

    // Find the Zinfandel alert row
    const zinfandelAlert = page.locator("a", { hasText: "Argentia Ridge Zinfandel" });
    await expect(zinfandelAlert.first()).toBeVisible();
  });

  test("can dismiss an alert", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Needs attention")).toBeVisible();

    // Scope to the alerts section only (not the active batches list which also has links)
    const alertsSection = page.locator("section", { has: page.getByText("Needs attention") });

    // Count Zinfandel alerts before dismiss
    const beforeCount = await alertsSection.locator("a", { hasText: "Argentia Ridge Zinfandel" }).count();
    expect(beforeCount).toBeGreaterThanOrEqual(1);

    // Find and click the first dismiss button for Zinfandel
    const dismissButton = page.getByRole("button", { name: /Dismiss alert for Argentia Ridge Zinfandel/ });
    await dismissButton.first().click();

    // Wait for refetch
    await page.waitForTimeout(1000);

    // Count should be one fewer in the alerts section
    const afterCount = await alertsSection.locator("a", { hasText: "Argentia Ridge Zinfandel" }).count();
    expect(afterCount).toBeLessThan(beforeCount);
  });
});
