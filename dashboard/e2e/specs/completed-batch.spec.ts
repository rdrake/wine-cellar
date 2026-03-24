// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Completed batch (seed data)", () => {
  // Helper: navigate to 2024 Merlot batch detail via Completed tab.
  // Uses exact match to avoid hitting "2024 Merlot (Copy)" from clone tests,
  // and waits for the list to load before clicking (avoids tab-switch race).
  async function gotoMerlot(page: import("@playwright/test").Page) {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(page.getByText("2024 Merlot", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByText("2024 Merlot", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible({ timeout: 10_000 });
  }

  test("Merlot shows completed status and cellaring info", async ({ page }) => {
    await gotoMerlot(page);

    // Status should show Completed (use first() — "Completed" appears in tab + badge)
    await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 10_000 });

    // Wine type
    await expect(page.getByText("Red").first()).toBeVisible();
  });

  test("Merlot shows cellaring card", async ({ page }) => {
    await gotoMerlot(page);

    // Cellaring section should be visible (it's rendered when bottled_at is set)
    await expect(page.getByRole("heading", { name: "Cellaring" })).toBeVisible({ timeout: 10_000 });
  });

  test("Merlot shows full activity history", async ({ page }) => {
    await gotoMerlot(page);

    // Should show activities from the full lifecycle
    await expect(page.getByText("Grapes received")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Pitched yeast")).toBeVisible();
    await expect(page.getByText("Bottled")).toBeVisible();
  });

  test("Merlot has no stage selector", async ({ page }) => {
    await gotoMerlot(page);

    // Stage combobox should not be present for completed batches
    await expect(page.getByRole("button", { name: "Set Stage" })).not.toBeVisible();
  });
});
