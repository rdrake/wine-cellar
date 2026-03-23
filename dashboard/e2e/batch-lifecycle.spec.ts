import { test, expect } from "@playwright/test";

test.describe("Batch lifecycle", () => {
  test("creates a new batch and views it", async ({ page }) => {
    const batchName = `E2E Test Batch ${Date.now()}`;

    // Navigate to the new batch form
    await page.goto("/batches/new");
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();

    // Fill in the batch name (required)
    await page.getByLabel("Name").fill(batchName);

    // Select wine type — shadcn Select: click trigger, then click option
    // Default is "Red" so let's pick "White" to verify the select works
    const wineTypeTrigger = page
      .locator("div")
      .filter({ has: page.getByText("Wine Type") })
      .getByRole("combobox");
    await wineTypeTrigger.click();
    await page.getByRole("option", { name: "White" }).click();

    // Select source material — default is "Kit", pick "Fresh Grapes"
    const sourceMaterialTrigger = page
      .locator("div")
      .filter({ has: page.getByText("Source Material") })
      .getByRole("combobox");
    await sourceMaterialTrigger.click();
    await page.getByRole("option", { name: "Fresh Grapes" }).click();

    // started_at is pre-filled with current datetime, leave as-is

    // Fill in volume
    await page.getByLabel("Volume (L)").fill("23");

    // Fill in target volume
    await page.getByLabel("Target Volume (L)").fill("21");

    // Submit the form
    await page.getByRole("button", { name: "Create Batch" }).click();

    // Should navigate to the batch detail page
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);

    // Should see the batch name on the detail page
    await expect(page.getByRole("heading", { name: batchName })).toBeVisible();

    // Verify wine type and source material appear in the detail subtitle
    await expect(page.getByText("White")).toBeVisible();
    await expect(page.getByText("Fresh Grapes")).toBeVisible();
  });
});
