import { expect, test } from "@playwright/test";

test("home page shows validation errors for an incomplete form", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Run pre-flight" }).click();

  await expect(page.getByText("Enter a site URL.")).toBeVisible();
  await expect(page.getByText(/confirm you own this site or repo/i)).toBeVisible();
});

test("home page rejects a non-URL site value", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("Site URL").fill("not-a-url");
  await page.getByLabel(/I own this site or repo/).click();
  await page.getByRole("button", { name: "Run pre-flight" }).click();

  await expect(page.getByText("Enter a valid URL.")).toBeVisible();
});
