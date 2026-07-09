import { EditorView, ViewUpdate } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import { MoveCompletedTasksSettings } from "./settings";
import {
  BlockRange,
  findBlockBounds,
  sortChecklistBlockDetailed,
  SortOptions,
} from "./checklistSorter";
import { isTaskLine, parseTaskLine } from "./utilities";

/**
 * Build the CodeMirror 6 editor extension that powers the plugin.
 *
 * Kept independent of Obsidian's `Plugin` class so it can be exercised against a
 * real {@link EditorView} in tests. Obsidian editors are the same CM6 editors,
 * so a passing integration test here means the behaviour holds in the app.
 *
 * @param getSettings Returns the current, live settings.
 */
export function createMoveCompletedTasksExtension(
  getSettings: () => MoveCompletedTasksSettings,
): Extension {
  // Guards against reacting to our own reorder transaction (no feedback loop).
  let applying = false;
  // Pending debounce timer, or null when idle.
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * True when the checkbox state of the line at `newPos` differs from before
   * this edit — in *either* direction (checked→unchecked or unchecked→checked).
   * A line that was not a task before counts as unchecked, so a newly-typed
   * completed task also sorts, while typing a new empty task, or editing a
   * task's text, does not.
   */
  function checkedStateFlipped(update: ViewUpdate, newPos: number, nowChecked: boolean): boolean {
    const inverted = update.changes.invert(update.startState.doc);
    const oldPos = inverted.mapPos(newPos, 1);
    const before = parseTaskLine(update.startState.doc.lineAt(oldPos).text);
    const wasChecked = before ? before.checked : false;
    return wasChecked !== nowChecked;
  }

  /** Unique checklist blocks containing the given zero-based line indices. */
  function blocksForLines(lines: string[], changedLines: number[]): BlockRange[] {
    const seenStarts = new Set<number>();
    const ranges: BlockRange[] = [];
    for (const lineIdx of changedLines) {
      const range = findBlockBounds(lines, lineIdx);
      if (range && !seenStarts.has(range.start)) {
        seenStarts.add(range.start);
        ranges.push(range);
      }
    }
    return ranges;
  }

  /** Every contiguous checklist block in the note. */
  function allBlocks(lines: string[]): BlockRange[] {
    const ranges: BlockRange[] = [];
    let i = 0;
    while (i < lines.length) {
      if (isTaskLine(lines[i])) {
        const range = findBlockBounds(lines, i);
        if (range) {
          ranges.push(range);
          i = range.end + 1;
          continue;
        }
      }
      i++;
    }
    return ranges;
  }

  /** Compute and apply the reorder for the given newly-checked lines. */
  function apply(view: EditorView, changedLines: number[]): void {
    const settings = getSettings();
    const doc = view.state.doc;
    const lines = doc.toString().split("\n");
    const opts: SortOptions = {
      direction: settings.sortDirection,
      ignoreNested: settings.ignoreNested,
      insertDivider: settings.insertDivider,
      dividerText: settings.dividerText,
    };

    const ranges = settings.onlySortCurrentChecklist
      ? blocksForLines(lines, changedLines)
      : allBlocks(lines);
    if (ranges.length === 0) return;

    const cursor = view.state.selection.main;
    const cursorLineIdx = doc.lineAt(cursor.head).number - 1;
    const cursorCol = cursor.head - doc.line(cursorLineIdx + 1).from;
    let cursorTargetLineIdx: number | null = null;

    const changes: { from: number; to: number; insert: string }[] = [];
    for (const range of ranges) {
      const block = lines.slice(range.start, range.end + 1);
      const { lines: sorted, order } = sortChecklistBlockDetailed(block, opts);
      if (block.length === sorted.length && sorted.every((l, i) => l === block[i])) continue;

      changes.push({
        from: doc.line(range.start + 1).from,
        to: doc.line(range.end + 1).to,
        insert: sorted.join("\n"),
      });

      if (cursorLineIdx >= range.start && cursorLineIdx <= range.end) {
        cursorTargetLineIdx = range.start + order.indexOf(cursorLineIdx - range.start);
      }
    }
    if (changes.length === 0) return;

    applying = true;
    try {
      view.dispatch({ changes }); // one transaction → one undo step
      if (cursorTargetLineIdx !== null) {
        const newDoc = view.state.doc;
        const line = newDoc.line(Math.min(cursorTargetLineIdx + 1, newDoc.lines));
        view.dispatch({ selection: { anchor: line.from + Math.min(cursorCol, line.length) } });
      }
    } finally {
      applying = false;
    }
  }

  /** Debounce + defer (CM6 forbids dispatching inside an update listener). */
  function schedule(view: EditorView, changedLines: number[]): void {
    const delay = Math.max(0, getSettings().delay);
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      apply(view, changedLines);
    }, delay);
  }

  /** React to an editor update; schedule a reorder if a box was just ticked. */
  function handleUpdate(update: ViewUpdate): void {
    if (!getSettings().enableAutoSort || applying || !update.docChanged) return;

    const doc = update.state.doc;
    const toggled = new Set<number>();
    update.changes.iterChanges((_fromA, _toA, fromB, toB) => {
      const firstLine = doc.lineAt(fromB).number;
      const lastLine = doc.lineAt(Math.max(fromB, toB)).number;
      for (let lineNo = firstLine; lineNo <= lastLine; lineNo++) {
        const line = doc.line(lineNo);
        const task = parseTaskLine(line.text);
        // Re-sort on any checkbox flip: checking sinks the item, unchecking
        // lifts it back above the completed ones.
        if (task && checkedStateFlipped(update, line.from, task.checked)) {
          toggled.add(lineNo - 1);
        }
      }
    });
    if (toggled.size > 0) schedule(update.view, [...toggled]);
  }

  return EditorView.updateListener.of(handleUpdate);
}
