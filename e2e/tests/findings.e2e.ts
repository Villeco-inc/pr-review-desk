import { describe, test } from "@e2e-dev/web";
import { dismissThenReopen, editAndPostComment } from "../flows";

describe("findings", () => {
  test("edit a finding's comment and post it inline", editAndPostComment);
  test("dismiss a finding, then reopen it, across reloads", dismissThenReopen);
});
