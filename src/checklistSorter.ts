/**
 * The reordering engine.
 *
 * Pure, framework-free functions that take the raw lines of a note (or a single
 * checklist block) and compute the new ordering. Keeping this logic free of any
 * editor API makes the tricky part — nesting-aware, stable reordering — easy to
 * reason about and unit-test.
 */

import { isTaskLine, parseTaskLine } from "./utilities";

/** Options controlling how a checklist block is reordered. */
export interface SortOptions {
  /** Where completed items should end up within each sibling group. */
  direction: "bottom" | "top";
  /**
   * When `true`, only the top-level items of a block are reordered; nested
   * sub-lists keep their original order and stay attached to their parent.
   */
  ignoreNested: boolean;
}

/** The inclusive line range `[start, end]` of a contiguous checklist block. */
export interface BlockRange {
  start: number;
  end: number;
}

/** Result of reordering a block: the new lines and the applied permutation. */
export interface SortResult {
  /** Reordered block lines (same count as the input). */
  lines: string[];
  /**
   * `order[k]` is the original block index of the line now at position `k`.
   * Used by the editor layer to keep the cursor on its line after a move.
   */
  order: number[];
}

/** A checklist item plus its nested descendants. */
interface TaskNode {
  raw: string;
  /** Index of this line within the original block (for the permutation). */
  origIndex: number;
  indent: number;
  checked: boolean;
  children: TaskNode[];
}

/**
 * Find the contiguous checklist block that contains `lineIndex`.
 *
 * A block is a maximal run of consecutive task lines. Any non-task line —
 * including a blank line or a paragraph — ends the block, so two lists that are
 * visually separate are never merged (see the plugin's "scope detection" rule).
 *
 * @param lines All lines of the note.
 * @param lineIndex Zero-based index of a line inside the block.
 * @returns The block range, or `null` when `lineIndex` is not a task line.
 */
export function findBlockBounds(lines: string[], lineIndex: number): BlockRange | null {
  if (lineIndex < 0 || lineIndex >= lines.length || !isTaskLine(lines[lineIndex])) {
    return null;
  }
  let start = lineIndex;
  while (start - 1 >= 0 && isTaskLine(lines[start - 1])) start--;
  let end = lineIndex;
  while (end + 1 < lines.length && isTaskLine(lines[end + 1])) end++;
  return { start, end };
}

/**
 * Build a nesting tree from a block's lines using indentation depth. An item is
 * a child of the nearest preceding item with a smaller indent; equal indent
 * means siblings.
 */
function buildTree(blockLines: string[]): TaskNode[] {
  const roots: TaskNode[] = [];
  const stack: TaskNode[] = [];

  blockLines.forEach((raw, origIndex) => {
    const parsed = parseTaskLine(raw);
    const node: TaskNode = {
      raw,
      origIndex,
      // A non-task line shouldn't appear inside a block, but if it does, treat
      // it as maximally deep so it stays attached to the item above it.
      indent: parsed ? parsed.indent : Number.MAX_SAFE_INTEGER,
      checked: parsed ? parsed.checked : false,
      children: [],
    };
    while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  });

  return roots;
}

/**
 * Stable partition of one sibling group: incomplete items keep their relative
 * order, completed items keep their relative order, and completed items sink to
 * the bottom (or rise to the top). Stability is what keeps already-completed
 * tasks in a predictable order.
 */
function partition(nodes: TaskNode[], direction: "bottom" | "top"): TaskNode[] {
  const incomplete: TaskNode[] = [];
  const complete: TaskNode[] = [];
  for (const node of nodes) (node.checked ? complete : incomplete).push(node);
  return direction === "top" ? [...complete, ...incomplete] : [...incomplete, ...complete];
}

/** Reorder siblings, recursing into children unless `ignoreNested` is set. */
function orderNodes(nodes: TaskNode[], opts: SortOptions): TaskNode[] {
  if (!opts.ignoreNested) {
    for (const node of nodes) node.children = orderNodes(node.children, opts);
  }
  return partition(nodes, opts.direction);
}

/** Flatten a node tree back into lines in document (pre-order) order. */
function flatten(nodes: TaskNode[], outLines: string[], outOrder: number[]): void {
  for (const node of nodes) {
    outLines.push(node.raw);
    outOrder.push(node.origIndex);
    flatten(node.children, outLines, outOrder);
  }
}

/**
 * Reorder a single checklist block, returning the new lines and the permutation
 * that produced them. Completed items move to the bottom (or top), carrying
 * their nested sub-tasks and preserving each line's indentation verbatim.
 *
 * @param blockLines The raw lines of one contiguous checklist block.
 * @param opts Sorting options.
 */
export function sortChecklistBlockDetailed(
  blockLines: string[],
  opts: SortOptions,
): SortResult {
  if (blockLines.length < 2) {
    return { lines: blockLines.slice(), order: blockLines.map((_, i) => i) };
  }
  const ordered = orderNodes(buildTree(blockLines), opts);
  const lines: string[] = [];
  const order: number[] = [];
  flatten(ordered, lines, order);
  return { lines, order };
}

/**
 * Convenience wrapper returning only the reordered lines.
 *
 * @param blockLines The raw lines of one contiguous checklist block.
 * @param opts Sorting options.
 */
export function sortChecklistBlock(blockLines: string[], opts: SortOptions): string[] {
  return sortChecklistBlockDetailed(blockLines, opts).lines;
}
