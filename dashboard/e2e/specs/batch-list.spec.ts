// Requires: seed data — yes
import { test, expect } from "@playwright/test";

test.describe("Batch list (seed data)", () => {
  test("active tab shows seed batches", async ({ page }) => {
    await page.goto("/batches");
    await expect(page.getByRole("heading", { name: "Batches" })).toBeVisible();

    // Active tab is default — should show seed batches
    await expect(page.getByText("Argentia Ridge Cab Sauv")).toBeVisible();
    await expect(page.getByText("Magnotta Chardonnay")).toBeVisible();
  });

  test("completed tab shows the Merlot", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Completed" }).click();

    await expect(page.getByText("2024 Merlot")).toBeVisible({ timeout: 10_000 });
  });

  test("archived tab shows the Sauvignon Blanc", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Archived" }).click();

    await expect(page.getByText("Magnotta Sauvignon Blanc")).toBeVisible({ timeout: 10_000 });
  });

  test("abandoned tab shows the Malbec", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("tab", { name: "Abandoned" }).click();

    await expect(page.getByText("Magnotta Malbec")).toBeVisible({ timeout: 10_000 });
  });

  test("compare button navigates to comparison page", async ({ page }) => {
    await page.goto("/batches");
    await page.getByRole("button", { name: "Compare" }).click();

    await expect(page).toHaveURL(/\/compare$/);
  });
});
