import { Plugin } from "obsidian";
import {
  DEFAULT_SETTINGS,
  MoveCompletedTasksSettings,
  MoveCompletedTasksSettingTab,
} from "./settings";
import { createMoveCompletedTasksExtension } from "./reorderExtension";

/**
 * Move Completed Tasks.
 *
 * Reacts only to real edits in the active editor (via a CodeMirror 6 update
 * listener). When a checkbox is newly ticked, the enclosing checklist block is
 * reordered so completed items sink to the bottom (or rise to the top), carrying
 * their nested sub-tasks. The reorder is applied as a normal editor transaction,
 * so it participates in undo history and keeps the cursor on its line.
 */
export default class MoveCompletedTasksPlugin extends Plugin {
  settings!: MoveCompletedTasksSettings;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new MoveCompletedTasksSettingTab(this.app, this));
    // A single, lightweight editor extension — no vault scanning; desktop + mobile.
    this.registerEditorExtension(
      createMoveCompletedTasksExtension(() => this.settings),
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
