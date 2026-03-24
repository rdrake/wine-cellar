import { test, expect } from "@playwright/test";

test.describe("Batch cloning", () => {
  test("clones a completed batch with full recipe data", async ({ page }) => {
    // Navigate to batch list, find 2024 Merlot (completed)
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();
    await page.getByText("2024 Merlot").click();
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);

    // Capture original batch URL
    const originalUrl = page.url();

    // Click Clone
    await page.getByRole("button", { name: "Clone" }).click();

    // Verify success toast
    await expect(page.getByText(/Batch cloned/)).toBeVisible();

    // Verify navigation to NEW batch (different URL)
    await expect(page).toHaveURL(/\/batches\/[a-zA-Z0-9-]+$/);
    expect(page.url()).not.toBe(originalUrl);

    // Verify cloned batch has correct data
    // Name gets " (Copy)" appended by the API
    await expect(page.getByText("2024 Merlot (Copy)").first()).toBeVisible();

    // Cloned batch should be active (not completed)
    await expect(page.getByText("Active").first()).toBeVisible();

    // Verify recipe data carried over (shown in snapshot section)
    await expect(page.getByText("Red").first()).toBeVisible();
    await expect(page.getByText("Fresh Grapes").first()).toBeVisible();
  });
});
