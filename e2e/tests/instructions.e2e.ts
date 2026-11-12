import { test } from "@e2e-dev/web";
import { reviewWithInstructions } from "../flows";

test("instructions typed before a review reach the review agent", reviewWithInstructions);
