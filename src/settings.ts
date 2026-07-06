import { App, PluginSettingTab, Setting } from "obsidian";
import type MoveCompletedTasksPlugin from "./main";

/** Persisted plugin settings. */
export interface MoveCompletedTasksSettings {
  /** Master switch for automatic sorting. */
  enableAutoSort: boolean;
  /** Debounce, in milliseconds, between ticking a box and moving it (0–5000). */
  delay: number;
  /** Whether completed tasks go to the bottom or the top of their group. */
  sortDirection: "bottom" | "top";
  /**
   * When `true`, only the edited checklist is reordered. When `false`, every
   * checklist block in the note is tidied whenever any box is ticked.
   */
  onlySortCurrentChecklist: boolean;
  /** When `true`, nested sub-lists are left untouched (only top level sorts). */
  ignoreNested: boolean;
}

/** Factory-default settings. */
export const DEFAULT_SETTINGS: MoveCompletedTasksSettings = {
  enableAutoSort: true,
  delay: 0,
  sortDirection: "bottom",
  onlySortCurrentChecklist: true,
  ignoreNested: false,
};

/** Settings tab under Settings → Community plugins → Move Completed Tasks. */
export class MoveCompletedTasksSettingTab extends PluginSettingTab {
  private readonly plugin: MoveCompletedTasksPlugin;

  constructor(app: App, plugin: MoveCompletedTasksPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Render the settings controls. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable automatic sorting")
      .setDesc("Automatically move a task when you tick its checkbox.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAutoSort).onChange(async (value) => {
          this.plugin.settings.enableAutoSort = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Delay before moving")
      .setDesc("How long to wait after a box is ticked before moving it (0 = instant).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 5000, 100)
          .setValue(this.plugin.settings.delay)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.delay = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Sort direction")
      .setDesc("Where completed tasks should move.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bottom", "Move completed to bottom")
          .addOption("top", "Move completed to top")
          .setValue(this.plugin.settings.sortDirection)
          .onChange(async (value) => {
            this.plugin.settings.sortDirection = value === "top" ? "top" : "bottom";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Only sort current checklist")
      .setDesc(
        "On: reorder only the checklist you edited. Off: tidy every checklist in the note whenever a box is ticked.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.onlySortCurrentChecklist)
          .onChange(async (value) => {
            this.plugin.settings.onlySortCurrentChecklist = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Ignore nested tasks")
      .setDesc("On: only top-level items are reordered; sub-tasks keep their order.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.ignoreNested).onChange(async (value) => {
          this.plugin.settings.ignoreNested = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
