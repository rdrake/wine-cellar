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

    // Step 2: Capture batch ID from the detail page URL (UUID contains digits, "new" does not)
    await expect(page).toHaveURL(/\/batches\/[0-9a-f]{8}-/);
    const batchId = page.url().match(/\/batches\/([0-9a-f-]+)$/)![1];

    // Step 3: Wait for the batch detail page to fully load before navigating to edit
    await expect(page.getByRole("heading", { name: originalName })).toBeVisible();

    // Step 4: Navigate to the edit page via the Edit link (avoids direct navigation race)
    await page.getByRole("link", { name: "Edit" }).click();

    // Step 5: Verify edit page heading (allow time for batch data to load)
    await expect(page.getByRole("heading", { name: "Edit Batch" })).toBeVisible({ timeout: 10_000 });

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

    // Step 11: Verify the notes section appears (notes are collapsed by default)
    await expect(page.getByText("Batch Notes")).toBeVisible();
    // Expand and verify note content
    await page.getByText("Batch Notes").click();
    await expect(page.getByText("Updated via E2E test")).toBeVisible();
  });
});
