import { expect, test } from "@playwright/test";

test("Jamie rents and returns a physical copy", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Browse the shelves" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "View Midnight Rewind details" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Midnight Rewind" }),
  ).toBeVisible();
  await expect(
    page.getByText("3 of 3 copies are available", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Rent for 7 nights" }).click();
  await page.getByRole("link", { name: "View my rentals" }).click();

  await expect(page.getByRole("heading", { name: "My rentals" })).toBeVisible();

  const activeRental = page
    .getByRole("article")
    .filter({ hasText: "Midnight Rewind" });

  await expect(activeRental.getByText("Active rental")).toBeVisible();
  await expect(activeRental.getByText("Jamie Vega")).toBeVisible();
  await expect(activeRental.getByText("MUV-MR-001")).toBeVisible();

  await activeRental
    .getByRole("button", { name: "Return this copy" })
    .click();

  await expect(activeRental).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your rental bag is empty" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Browse", exact: true }).click();

  const midnightRewindCard = page.getByRole("article").filter({
    has: page.getByRole("link", { name: "View Midnight Rewind details" }),
  });

  await expect(midnightRewindCard).toBeVisible();
  await expect(
    midnightRewindCard.getByText("3 copies available", { exact: true }),
  ).toBeVisible();
});
