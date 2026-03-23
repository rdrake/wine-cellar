import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads dashboard without showing login page", async ({ page }) => {
    await page.goto("/");

    // Should NOT see the login page (check for login-specific elements)
    await expect(page.getByRole("link", { name: "Sign in with GitHub" })).not.toBeVisible();

    // Should see the dashboard content — the "Active batches" section heading
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // Should also see the "Recent activity" section heading
    await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  });

  test("can navigate to new batch form", async ({ page }) => {
    await page.goto("/");

    // Wait for dashboard to load
    await expect(page.getByRole("heading", { name: "Active batches" })).toBeVisible();

    // The FAB is a fixed-position link to /batches/new
    await page.locator('a[href="/batches/new"]').click({ force: true });

    // Should navigate to the new batch page
    await expect(page).toHaveURL(/\/batches\/new$/);

    // Should see the "New Batch" heading
    await expect(page.getByRole("heading", { name: "New Batch" })).toBeVisible();

    // Should see the form with the "Create Batch" submit button
    await expect(page.getByRole("button", { name: "Create Batch" })).toBeVisible();
  });
});
