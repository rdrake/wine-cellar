// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Completed batch (seed data)", () => {
  test("Merlot shows completed status and cellaring info", async ({ page }) => {
    // Navigate to batch list, completed tab
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await expect(page.getByText("2024 Merlot")).toBeVisible({ timeout: 10_000 });
    await page.getByText("2024 Merlot").click();

    // Should be on batch detail
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Status should show Completed (use first() — "Completed" appears in tab + badge)
    await expect(page.getByText("Completed").first()).toBeVisible();

    // Wine type
    await expect(page.getByText("Red").first()).toBeVisible();
  });

  test("Merlot shows cellaring card", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Cellaring section should be visible (it's rendered when bottled_at is set)
    await expect(page.getByRole("heading", { name: "Cellaring" })).toBeVisible({ timeout: 10_000 });
  });

  test("Merlot shows full activity history", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Should show activities from the full lifecycle
    await expect(page.getByText("Grapes received")).toBeVisible();
    await expect(page.getByText("Pitched yeast")).toBeVisible();
    await expect(page.getByText("Bottled")).toBeVisible();
  });

  test("Merlot has no stage selector", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page.getByRole("heading", { name: "2024 Merlot" })).toBeVisible();

    // Stage combobox should not be present for completed batches
    await expect(page.getByRole("button", { name: "Set Stage" })).not.toBeVisible();
  });
});
