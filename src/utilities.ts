/**
 * Low-level helpers for parsing Markdown checklist ("task") lines.
 *
 * These are pure functions with no Obsidian, DOM, or Node dependencies, so they
 * run identically on every platform (desktop and mobile) and are trivial to
 * unit-test in isolation.
 */

/** A parsed checklist line. */
export interface TaskLine {
  /** Leading-whitespace width, with tabs counted as {@link TAB_WIDTH}. */
  indent: number;
  /** The list marker, e.g. `-`, `*`, `+`, `1.`, `2)`. */
  marker: string;
  /** Whether the checkbox is ticked (`[x]` / `[X]`). */
  checked: boolean;
}

/** Indent units a single tab is worth when comparing nesting depth. */
export const TAB_WIDTH = 4;

// Matches: "- [ ] text", "* [x] text", "+ [X] text", "1. [ ] text", "2) [x] text"
const TASK_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]/;

/**
 * Parse a line as a checklist item.
 *
 * @param line Raw line text.
 * @returns The parsed {@link TaskLine}, or `null` when the line is not a task.
 */
export function parseTaskLine(line: string): TaskLine | null {
  const match = TASK_RE.exec(line);
  if (!match) return null;
  return {
    indent: indentWidth(match[1]),
    marker: match[2],
    checked: match[3] !== " ",
  };
}

/** Whether a line is a Markdown checklist item (checked or not). */
export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

/** Whether a line is a *completed* checklist item. */
export function isCheckedTaskLine(line: string): boolean {
  const task = parseTaskLine(line);
  return task !== null && task.checked;
}

/**
 * Measure leading-whitespace width, counting each tab as {@link TAB_WIDTH}.
 * This lets nesting depth be compared consistently whether a note is indented
 * with tabs or spaces.
 *
 * @param leading The leading-whitespace substring of a line.
 */
export function indentWidth(leading: string): number {
  let width = 0;
  for (const ch of leading) width += ch === "\t" ? TAB_WIDTH : 1;
  return width;
}
