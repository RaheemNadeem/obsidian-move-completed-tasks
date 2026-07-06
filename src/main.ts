import { Plugin } from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import {
  DEFAULT_SETTINGS,
  MoveCompletedTasksSettings,
  MoveCompletedTasksSettingTab,
} from "./settings";
import {
  BlockRange,
  findBlockBounds,
  sortChecklistBlockDetailed,
  SortOptions,
} from "./checklistSorter";
import { isCheckedTaskLine, isTaskLine, parseTaskLine } from "./utilities";

/**
 * Move Completed Tasks.
 *
 * Reacts only to real edits in the active editor (a CodeMirror 6 update
 * listener). When a checkbox is newly ticked, the enclosing checklist block is
 * reordered so completed items sink to the bottom (or rise to the top),
 * carrying their nested sub-tasks. The reorder is applied as a normal editor
 * transaction, so it participates in undo history and keeps the cursor on its
 * line.
 */
export default class MoveCompletedTasksPlugin extends Plugin {
  settings!: MoveCompletedTasksSettings;

  /** Guards against reacting to our own reorder transaction (no feedback loop). */
  private applying = false;

  /** Pending debounce timer, or `null` when idle. */
  private timer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MoveCompletedTasksSettingTab(this.app, this));

    // A single, lightweight CM6 listener. It fires only on genuine editor
    // changes for the active note — never scanning the vault — and works on
    // both desktop and mobile.
    this.registerEditorExtension(
      EditorView.updateListener.of((update) => this.handleUpdate(update)),
    );
  }

  onunload(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Inspect an editor update. If one or more checkboxes were *just* ticked,
   * schedule a reorder of the affected checklist(s).
   */
  private handleUpdate(update: ViewUpdate): void {
    if (!this.settings.enableAutoSort || this.applying || !update.docChanged) return;

    const doc = update.state.doc;
    const newlyChecked = new Set<number>();

    update.changes.iterChanges((_fromA, _toA, fromB, toB) => {
      // Examine each line the change touched, in the *new* document.
      const firstLine = doc.lineAt(fromB).number;
      const lastLine = doc.lineAt(Math.max(fromB, toB)).number;
      for (let lineNo = firstLine; lineNo <= lastLine; lineNo++) {
        const line = doc.line(lineNo);
        if (isCheckedTaskLine(line.text) && this.wasNotAlreadyChecked(update, line.from)) {
          newlyChecked.add(lineNo - 1); // store zero-based
        }
      }
    });

    if (newlyChecked.size > 0) this.schedule(update.view, [...newlyChecked]);
  }

  /**
   * True when the line at the given new-document position was *not* an
   * already-completed task before this edit — i.e. the checkbox was genuinely
   * ticked now (or the line was just typed), rather than the user editing the
   * text of a task that was already done.
   */
  private wasNotAlreadyChecked(update: ViewUpdate, newPos: number): boolean {
    const inverted = update.changes.invert(update.startState.doc);
    const oldPos = inverted.mapPos(newPos, 1);
    const oldLine = update.startState.doc.lineAt(oldPos).text;
    const old = parseTaskLine(oldLine);
    return !(old && old.checked);
  }

  /**
   * Debounce and defer the reorder. Deferral is mandatory: CodeMirror forbids
   * dispatching a transaction from inside an update listener. A delay of 0 runs
   * on the next tick (effectively instant).
   */
  private schedule(view: EditorView, changedLines: number[]): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.apply(view, changedLines);
    }, Math.max(0, this.settings.delay));
  }

  /** Compute and apply the reorder for the given (newly-checked) lines. */
  private apply(view: EditorView, changedLines: number[]): void {
    const doc = view.state.doc;
    const lines = doc.toString().split("\n");
    const opts: SortOptions = {
      direction: this.settings.sortDirection,
      ignoreNested: this.settings.ignoreNested,
    };

    const ranges = this.settings.onlySortCurrentChecklist
      ? this.blocksForLines(lines, changedLines)
      : this.allBlocks(lines);
    if (ranges.length === 0) return;

    // Remember the cursor's line so we can follow it to its new home.
    const cursor = view.state.selection.main;
    const cursorLineIdx = doc.lineAt(cursor.head).number - 1;
    const cursorCol = cursor.head - doc.line(cursorLineIdx + 1).from;
    let cursorTargetLineIdx: number | null = null;

    const changes: { from: number; to: number; insert: string }[] = [];
    for (const range of ranges) {
      const block = lines.slice(range.start, range.end + 1);
      const { lines: sorted, order } = sortChecklistBlockDetailed(block, opts);
      if (isSameOrder(block, sorted)) continue; // nothing to do

      changes.push({
        from: doc.line(range.start + 1).from,
        to: doc.line(range.end + 1).to,
        insert: sorted.join("\n"),
      });

      if (cursorLineIdx >= range.start && cursorLineIdx <= range.end) {
        const oldInBlock = cursorLineIdx - range.start;
        cursorTargetLineIdx = range.start + order.indexOf(oldInBlock);
      }
    }
    if (changes.length === 0) return;

    this.applying = true;
    try {
      // One transaction → one undo step (Ctrl+Z reverts the whole move).
      view.dispatch({ changes });

      // Reordering keeps every line count intact, so line *indices* are stable;
      // reposition the cursor onto its line's new index in the updated doc.
      if (cursorTargetLineIdx !== null) {
        const newDoc = view.state.doc;
        const targetLine = newDoc.line(Math.min(cursorTargetLineIdx + 1, newDoc.lines));
        const anchor = targetLine.from + Math.min(cursorCol, targetLine.length);
        view.dispatch({ selection: { anchor } });
      }
    } finally {
      this.applying = false;
    }
  }

  /** Unique checklist blocks that contain the given (zero-based) line indices. */
  private blocksForLines(lines: string[], changedLines: number[]): BlockRange[] {
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

  /** Every contiguous checklist block in the note (used when "only current" is off). */
  private allBlocks(lines: string[]): BlockRange[] {
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
}

/** Whether two equal-length line arrays are identical. */
function isSameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
