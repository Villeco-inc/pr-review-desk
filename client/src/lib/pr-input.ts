export type PrInput = { repo: string; number: number } | { error: string };

const NAME = "[\\w.-]+";
const ADDRESS = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${NAME})/(${NAME})/pull/(\\d+)(?:[/?#].*)?$`, "i");
const FULL = new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`);
const SHORT = new RegExp(`^(${NAME})#(\\d+)$`);

const NOT_A_PR = "Not a pull request. Paste its GitHub address, or type repo#123.";

/** What was typed on the home screen: a PR's GitHub address, `owner/repo#123`, or `repo#123` for a followed repository. */
export function parsePrInput(text: string, followed: string[]): PrInput {
  const typed = text.trim();
  const full = ADDRESS.exec(typed) ?? FULL.exec(typed);
  if (full) return pr(`${full[1]}/${full[2]}`, full[3]);

  const short = SHORT.exec(typed);
  if (!short || Number(short[2]) <= 0) return { error: NOT_A_PR };
  const name = short[1];
  const named = followed.filter((r) => !r.startsWith("org:") && r.split("/")[1]?.toLowerCase() === name.toLowerCase());
  if (named.length === 0) return { error: `No followed repository is named ${name}. Paste the pull request's address instead.` };
  if (named.length > 1) return { error: `Several followed repositories are named ${name} (${named.join(", ")}). Type owner/${name}#${short[2]}.` };
  return pr(named[0], short[2]);
}

function pr(repo: string, digits: string): PrInput {
  const number = Number(digits);
  return number > 0 ? { repo, number } : { error: NOT_A_PR };
}
