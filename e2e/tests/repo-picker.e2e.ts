import { test } from "@e2e-dev/web";
import { pickReposOnFirstLaunch } from "../flows";

test("first launch: pick the repositories, then see their pull requests", pickReposOnFirstLaunch);
