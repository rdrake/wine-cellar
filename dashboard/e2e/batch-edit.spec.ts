import { test, expect } from "@playwright/test";

test.describe("Batch editing", () => {
  test("edits an existing batch", async ({ page }) => {
    const timestamp = Date.now();
    const originalName = `Edit Test Batch ${timestamp}`;
    const editedName = `Edited Batch ${timestamp}`;

    // Step 1: Create a batch to edit
    await page.goto("/batches/new");
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();

    await page.getByLabel("Name").fill(originalName);

    // Select wine type and source material (required comboboxes)
    const comboboxes = page.getByRole("combobox");
    await comboboxes.nth(0).click();
    await page.getByRole("option", { name: "White" }).click();
    await comboboxes.nth(1).click();
    await page.getByRole("option", { name: "Fresh Grapes" }).click();

    await page.getByRole("button", { name: "Create Batch" }).click();

    // Step 2: Capture batch ID from the detail page URL
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    const batchId = page.url().match(/\/batches\/([a-zA-Z0-9-]+)$/)![1];

    // Step 3: Navigate to the edit page
    await page.goto(`/batches/${batchId}/edit`);

    // Step 4: Verify edit page heading
    await expect(page.getByRole("heading", { name: "Edit Batch" })).toBeVisible();

    // Step 5: Change the name
    await page.getByLabel("Name").clear();
    await page.getByLabel("Name").fill(editedName);

    // Step 6: Set volume
    await page.locator("#volume").fill("25");

    // Step 7: Add notes
    await page.getByLabel("Notes").fill("Updated via E2E test");

    // Step 8: Submit the form
    await page.getByRole("button", { name: "Save Changes" }).click();

    // Step 9: Verify redirect back to batch detail page
    await expect(page).toHaveURL(new RegExp(`/batches/${batchId}$`));

    // Step 10: Verify the new name appears in the heading
    await expect(page.getByRole("heading", { name: editedName })).toBeVisible();

    // Step 11: Verify volume appears on the page
    await expect(page.getByText("25")).toBeVisible();
  });
});
