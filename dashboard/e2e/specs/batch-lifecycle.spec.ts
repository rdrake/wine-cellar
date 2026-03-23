import { test, expect } from "@playwright/test";

test.describe("Batch lifecycle", () => {
  test("creates a new batch and views it", async ({ page }) => {
    const batchName = `E2E Test Batch ${Date.now()}`;

    // Navigate to the new batch form
    await page.goto("/batches/new");
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();

    // Fill in the batch name (required)
    await page.getByLabel("Name").fill(batchName);

    // Select wine type — comboboxes are in form order: Wine Type, Source Material
    const comboboxes = page.getByRole("combobox");
    await comboboxes.nth(0).click();
    await page.getByRole("option", { name: "White" }).click();

    // Select source material
    await comboboxes.nth(1).click();
    await page.getByRole("option", { name: "Fresh Grapes" }).click();

    // started_at is pre-filled with current datetime, leave as-is

    // Fill in volume and target volume (use id selectors — labels overlap)
    await page.locator("#volume").fill("23");
    await page.locator("#target_volume").fill("21");

    // Submit the form
    await page.getByRole("button", { name: "Create Batch" }).click();

    // Should navigate to the batch detail page
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);

    // Should see the batch name on the detail page
    await expect(page.getByRole("heading", { name: batchName })).toBeVisible();

    // Verify wine type appears in the detail
    await expect(page.getByText("White")).toBeVisible();
  });
});
