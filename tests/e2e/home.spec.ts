import { expect, test } from "@playwright/test";

test("home page loads LaunchCheck", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /ready to launch/i })).toBeVisible();
});
