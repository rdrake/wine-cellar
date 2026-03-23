import { test, expect } from "@playwright/test";

// Override storageState to be unauthenticated for login tests
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Login page", () => {
  test("shows Wine Cellar heading when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Wine Cellar", { exact: true })
    ).toBeVisible();
  });

  test("shows GitHub sign-in link", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /Sign in with GitHub/i })
    ).toBeVisible();
  });

  test("shows passkey sign-in button", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /Sign in with Passkey/i })
    ).toBeVisible();
  });

  test("shows error for closed registrations", async ({ page }) => {
    await page.goto("/?error=registrations_closed");
    await expect(
      page.getByText("Registrations are currently closed.")
    ).toBeVisible();
  });

  test("shows error for GitHub failure", async ({ page }) => {
    await page.goto("/?error=github_error");
    await expect(
      page.getByText("GitHub sign-in failed. Please try again.")
    ).toBeVisible();
  });
});
