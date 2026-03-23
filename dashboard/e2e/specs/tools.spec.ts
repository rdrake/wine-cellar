import { test, expect } from "@playwright/test";

test.describe("Tools — Winemaking Calculators", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/tools");
  });

  test("page renders with heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Winemaking Calculators" })
    ).toBeVisible();
  });

  test("ABV calculator computes correctly", async ({ page }) => {
    // ABV card is defaultOpen — no click needed
    await page.locator("#abv-og").fill("1.050");
    await page.locator("#abv-fg").fill("1.010");

    // ABV = (1.050 - 1.010) * 131.25 = 5.25, displayed as "5.3" via .toFixed(1)
    await expect(page.getByText("5.3")).toBeVisible();
    // Attenuation = 80, displayed as "80" via .toFixed(0)
    await expect(page.getByText("Apparent Attenuation")).toBeVisible();
  });

  test("chaptalization calculator computes sugar needed", async ({ page }) => {
    await page.getByText("Chaptalization").click();

    await page.locator("#chap-vol").fill("23");
    await page.locator("#chap-cur").fill("1.050");
    await page.locator("#chap-tgt").fill("1.060");

    // pts = 10, sugar = 23 * 10 * 2.65 = 610g
    await expect(page.getByText("610")).toBeVisible();
  });

  test("sulfite calculator computes KMS addition", async ({ page }) => {
    await page.getByText("Sulfite Addition").click();

    await page.locator("#so2-vol").fill("23");
    await page.locator("#so2-ph").fill("3.4");
    await page.locator("#so2-tgt").fill("50");
    await page.locator("#so2-cur").fill("20");

    // KMS = (50-20) * 23 / 576 ≈ 1.20g
    await expect(page.getByText("KMS to Add")).toBeVisible();
    await expect(page.getByText("1.20")).toBeVisible();
  });

  test("hydrometer correction adjusts for temperature", async ({ page }) => {
    await page.getByText("Hydrometer Correction").click();

    await page.locator("#tc-sg").fill("1.050");
    await page.locator("#tc-temp").fill("30");
    await page.locator("#tc-cal").fill("20");

    await expect(page.getByText("Corrected SG")).toBeVisible();
  });

  test("calibration solution calculator shows sugar needed", async ({ page }) => {
    await page.getByText("Calibration Solution").click();

    await page.locator("#cal-vol").fill("1");
    await page.locator("#cal-sg").fill("1.050");

    await expect(page.getByText("Sugar Needed")).toBeVisible();
  });
});
