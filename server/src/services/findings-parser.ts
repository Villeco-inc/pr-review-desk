import type { Finding, Reference, Report, Severity } from "../../../shared/types";
import { SEVERITIES } from "../../../shared/types";

export interface ParseWarning {
  index: number;
  reason: string;
}

export interface ParseResult {
  report: Report | null;
  warnings: ParseWarning[];
  error: string | null;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string {
  const value = pick(obj, ...keys);
  return typeof value === "string" ? value : "";
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: "blocker",
  major: "high",
  warning: "medium",
  minor: "low",
  info: "nit",
  informational: "nit",
};

function normalizeSeverity(value: unknown): Severity {
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if ((SEVERITIES as readonly string[]).includes(lower)) return lower as Severity;
    if (SEVERITY_ALIASES[lower]) return SEVERITY_ALIASES[lower];
  }
  return "medium";
}

function normalizeSide(value: unknown): "LEFT" | "RIGHT" {
  return typeof value === "string" && value.toUpperCase() === "LEFT" ? "LEFT" : "RIGHT";
}

function normalizeReferences(value: unknown): Reference[] {
  if (!Array.isArray(value)) return [];

  const refs: Reference[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const file = pick(obj, "file", "path");
    if (typeof file !== "string" || file.length === 0) continue;

    refs.push({
      file,
      startLine: toNullableNumber(pick(obj, "startLine", "start_line")),
      endLine: toNullableNumber(pick(obj, "endLine", "end_line")),
      note: pickString(obj, "note", "reason"),
    });
  }
  return refs;
}

export function normalizeFinding(raw: unknown, index: number): { finding: Finding | null; warning: string | null } {
  if (!raw || typeof raw !== "object") {
    return { finding: null, warning: `finding ${index}: not an object` };
  }

  const obj = raw as Record<string, unknown>;

  const file = pick(obj, "file", "path", "filename");
  if (typeof file !== "string" || file.length === 0) {
    return { finding: null, warning: `finding ${index}: missing "file"` };
  }

  const title = pick(obj, "title", "name");
  if (typeof title !== "string" || title.length === 0) {
    return { finding: null, warning: `finding ${index}: missing "title"` };
  }

  const startLine = toNullableNumber(pick(obj, "startLine", "start_line", "line"));
  const endLine = toNullableNumber(pick(obj, "endLine", "end_line")) ?? startLine;

  const finding: Finding = {
    file,
    startLine,
    endLine,
    side: normalizeSide(pick(obj, "side")),
    severity: normalizeSeverity(pick(obj, "severity", "level")),
    category: pickString(obj, "category", "type"),
    title,
    summary: pickString(obj, "summary", "description"),
    background: pickString(obj, "background", "context"),
    problem: pickString(obj, "problem", "issue"),
    suggestedFix: pickString(obj, "suggestedFix", "suggested_fix", "fix"),
    suggestedComment: pickString(obj, "suggestedComment", "suggested_comment", "comment"),
    references: normalizeReferences(pick(obj, "references", "refs")),
  };

  return { finding, warning: null };
}

function extractFindingsArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const arr = pick(obj, "findings", "issues", "comments");
    if (Array.isArray(arr)) return arr;
  }

  return null;
}

function extractSummary(parsed: unknown): string {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return pickString(parsed as Record<string, unknown>, "summary", "overview");
  }
  return "";
}

/**
 * Whether the `"` at index i ends a JSON string. Models sometimes quote words inside their text
 * with plain `"` (`« 1 icône + "+1" »`); a real closing quote is followed by `,` `}` `]` `:` or the end.
 */
export function closesString(text: string, i: number): boolean {
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    return ch === "," || ch === "}" || ch === "]" || ch === ":";
  }
  return true;
}

/** Escapes the stray quotes and raw newlines a model left inside JSON strings; valid JSON is unchanged. */
export function repairJson(raw: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escape) {
      escape = false;
      out += ch;
    } else if (ch === "\\") {
      escape = true;
      out += ch;
    } else if (ch === '"') {
      if (closesString(raw, i)) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else {
      out += ch;
    }
  }
  return out;
}

export function parseReport(raw: string): ParseResult {
  let parsed: unknown;
  let repaired = false;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    try {
      parsed = JSON.parse(repairJson(raw));
      repaired = true;
    } catch {
      return { report: null, warnings: [], error: `invalid JSON: ${(err as Error).message}` };
    }
  }

  const findingsRaw = extractFindingsArray(parsed);
  if (findingsRaw === null) {
    return { report: null, warnings: [], error: 'report must be an array or contain a "findings" array' };
  }

  const warnings: ParseWarning[] = [];
  const findings: Finding[] = [];

  findingsRaw.forEach((item, index) => {
    const { finding, warning } = normalizeFinding(item, index);
    if (finding) {
      findings.push(finding);
    } else if (warning) {
      warnings.push({ index, reason: warning });
    }
  });

  if (repaired) warnings.unshift({ index: -1, reason: "the report had unescaped quotes or line breaks inside its text; they were escaped" });

  return {
    report: { summary: extractSummary(parsed), findings },
    warnings,
    error: null,
  };
}
