import { test, expect } from "@playwright/test";

test.describe("Settings — API Keys", () => {
  test("can create and revoke an API key", async ({ page }) => {
    const keyName = `E2E Test Key ${Date.now()}`;

    await page.goto("/settings");

    // Verify the API Keys section is visible ("API Keys" is a <p>, not a heading)
    await expect(page.getByText("API Keys")).toBeVisible();
    await expect(page.getByText("For MCP servers and automation.")).toBeVisible();

    // Click the "Create" button in the section (not the dialog one)
    await page.getByRole("button", { name: "Create" }).first().click();

    // Fill in the key name
    const nameInput = page.getByLabel("API key name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(keyName);

    // Click "Create" inside the dialog
    await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

    // Verify the "API Key Created" dialog appears
    await expect(page.getByText("API Key Created")).toBeVisible();

    // Verify the generated key starts with "wc-"
    const generatedKeyInput = page.getByLabel("Generated API key");
    await expect(generatedKeyInput).toBeVisible();
    const keyValue = await generatedKeyInput.inputValue();
    expect(keyValue).toMatch(/^wc-/);

    // Close the dialog
    await page.getByRole("button", { name: "Done" }).click();

    // Verify the key appears in the list
    await expect(page.getByText(keyName)).toBeVisible();

    // Revoke the key — find the row containing the key name, then click its Revoke button
    const keyRow = page.getByText(keyName).locator("../..");
    await keyRow.getByRole("button", { name: "Revoke" }).click();

    // Verify the key is removed from the list
    await expect(page.getByText(keyName)).not.toBeVisible();
  });
});
