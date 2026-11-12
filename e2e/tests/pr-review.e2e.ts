import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { reviewPullRequest } from "../flows";

// Run in the default look, Linea light, which theme.e2e.ts does not cover.
test("review a pull request: running, then reported with its findings", async (desk) => {
  await reviewPullRequest(desk);
  const html = desk.browser.locator("html");
  await expect(html).toHaveAttribute("data-system", "linea");
  await expect(html).toHaveAttribute("data-theme", "light");
});
