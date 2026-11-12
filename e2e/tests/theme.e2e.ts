import { beforeEach, describe, test } from "@e2e-dev/web";
import { expect } from "e2e";
import { PR, editAndPostComment, reviewPullRequest } from "../flows";
import { resetWorld } from "../harness/world-state";

// The same flows in the Blueprint system, dark mode. The switch is set in code (a click on each
// radio), and checked on <html>, where the theme applies, and again after a reload.
describe("in Blueprint, dark", () => {
  beforeEach(async ({ app, screen, browser }) => {
    resetWorld({ repos: [PR.repo] }); // no repository picker over the rail
    await app.open("/prs");
    await screen.getByRole("radio", "Blueprint").tap();
    await screen.getByRole("radio", "Dark").tap();
    const html = browser.locator("html");
    await expect(html).toHaveAttribute("data-system", "blueprint");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await browser.reload();
    await expect(html).toHaveAttribute("data-system", "blueprint");
    await expect(screen.getByRole("radio", "Dark")).toBeChecked();
  });

  test("review a pull request", reviewPullRequest);
  test("edit a finding's comment and post it inline", editAndPostComment);
});
