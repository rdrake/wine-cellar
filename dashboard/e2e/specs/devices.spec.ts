import { test, expect } from "@playwright/test";

test.describe("Device management (Settings page)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("shows Devices section", async ({ page }) => {
    await expect(page.getByText("Devices", { exact: true }).first()).toBeVisible();
  });

  test("shows the seeded RAPT Pill device", async ({ page }) => {
    await expect(page.getByText("Rapt Pill #1")).toBeVisible();
  });

  test("device shows assigned status and batch name", async ({ page }) => {
    await expect(page.getByText("Assigned").first()).toBeVisible();
    await expect(page.getByText("Argentia Ridge Cab Sauv").first()).toBeVisible();
  });

  test("unassign and reassign device", async ({ page }) => {
    // Unassign
    await page.getByRole("button", { name: "Unassign" }).click();
    await expect(page.getByText("Device unassigned")).toBeVisible();
    await expect(page.getByText("Idle")).toBeVisible();

    // Reassign — click the "Assign" button on the device card
    await page.getByRole("button", { name: "Assign" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // AssignDialog uses shadcn Select (rendered as combobox role)
    await page.getByRole("combobox").click();
    await page
      .getByRole("option", { name: /Argentia Ridge Cab Sauv/ })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Assign" })
      .click();

    await expect(page.getByText("Device assigned")).toBeVisible();
  });

  test("shows sparkline SVGs for device with readings", async ({ page }) => {
    // Sparklines render as <svg> elements — there should be at least one (gravity)
    // Wait for readings to load first
    await expect(page.getByText("SG").first()).toBeVisible();
    // Gravity sparkline renders as inline SVG
    await expect(page.locator("svg").first()).toBeVisible();
  });

  test("shows Export CSV button for device with readings", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  });

  test("shows battery and signal sparkline labels", async ({ page }) => {
    // Use exact: true to avoid matching "95% bat" or "Assign"/"Assigned"
    await expect(page.getByText("Bat", { exact: true })).toBeVisible();
    await expect(page.getByText("Sig", { exact: true })).toBeVisible();
  });
});
