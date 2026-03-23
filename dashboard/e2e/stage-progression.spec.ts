import { test, expect } from "@playwright/test";

test.describe("Stage progression", () => {
  test("changes batch stage from Primary Fermentation to Secondary Fermentation", async ({
    page,
  }) => {
    const batchName = `E2E Stage Test ${Date.now()}`;

    // Create a new batch
    await page.goto("/batches/new");
    await expect(
      page.getByRole("heading", { name: "New Batch" })
    ).toBeVisible();

    await page.getByLabel("Name").fill(batchName);
    await page.getByRole("button", { name: "Create Batch" }).click();

    // Should navigate to the batch detail page
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    await expect(
      page.getByRole("heading", { name: batchName })
    ).toBeVisible();

    // Verify initial stage is Primary Fermentation
    await expect(page.getByText("Primary Fermentation")).toBeVisible();

    // Open the stage select (first combobox on the detail page)
    await page.getByRole("combobox").first().click();

    // Select "Secondary Fermentation"
    await page
      .getByRole("option", { name: "Secondary Fermentation" })
      .click();

    // Click "Set Stage" button
    await page.getByRole("button", { name: "Set Stage" }).click();

    // Wait for the page to reflect the updated stage
    // The "Set Stage" button should become disabled since selected matches current
    await expect(
      page.getByRole("button", { name: "Set Stage" })
    ).toBeDisabled();

    // Verify "Secondary Fermentation" is now displayed on the page
    await expect(page.getByText("Secondary Fermentation")).toBeVisible();
  });
});
