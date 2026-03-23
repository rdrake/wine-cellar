import { test, expect } from "@playwright/test";

test.describe("Activity logging", () => {
  test("logs an SG measurement and a note on a new batch", async ({ page }) => {
    const batchName = `E2E Activity Batch ${Date.now()}`;

    // ── Step 1: Create a batch ──────────────────────────────────────
    await page.goto("/batches/new");
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();
    await page.getByLabel("Name").fill(batchName);
    await page.getByRole("button", { name: "Create Batch" }).click();

    // Should navigate to the batch detail page
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    await expect(page.getByRole("heading", { name: batchName })).toBeVisible();

    // ── Step 2: Navigate to activity form via batch detail ──────────
    await page.getByRole("link", { name: "+ Log Activity" }).click();
    await expect(page.getByRole("heading", { name: "Log Activity" })).toBeVisible();

    // ── Step 3: Log an SG measurement ───────────────────────────────
    // Comboboxes in form order: Stage (0), Type (1)
    const comboboxes = page.getByRole("combobox");

    // Select stage — pick the first available option
    await comboboxes.nth(0).click();
    await page.getByRole("option").first().click();

    // Type defaults to "Measurement" — leave as-is

    // Fill title
    await page.getByPlaceholder("e.g., Added yeast nutrient").fill("Initial SG reading");

    // Metric defaults to "SG" — leave as-is

    // Fill the reading value
    await page.getByLabel("Reading").fill("1.085");

    // Submit
    await page.getByRole("button", { name: "Log Activity" }).click();

    // ── Step 4: Verify measurement appears on batch detail ──────────
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    await expect(page.getByText("Initial SG reading")).toBeVisible();

    // ── Step 5: Log a note ──────────────────────────────────────────
    await page.getByRole("link", { name: "+ Log Activity" }).click();
    await expect(page.getByRole("heading", { name: "Log Activity" })).toBeVisible();

    const noteComboboxes = page.getByRole("combobox");

    // Select stage — pick the first available option
    await noteComboboxes.nth(0).click();
    await page.getByRole("option").first().click();

    // Change type to "Note"
    await noteComboboxes.nth(1).click();
    await page.getByRole("option", { name: "Note" }).click();

    // Fill title
    await page.getByPlaceholder("e.g., Added yeast nutrient").fill("Smells great");

    // Fill the note body (required for note type)
    await page.getByPlaceholder("Observations, reminders, or anything worth recording").fill("Really nice aromas coming from the fermenter.");

    // Submit
    await page.getByRole("button", { name: "Log Activity" }).click();

    // ── Step 6: Verify note appears on batch detail ─────────────────
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    await expect(page.getByText("Smells great")).toBeVisible();

    // Both activities should be visible
    await expect(page.getByText("Initial SG reading")).toBeVisible();
  });
});
