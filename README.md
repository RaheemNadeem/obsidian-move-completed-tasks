# Move Completed Tasks

An Obsidian community plugin that automatically moves a completed checklist item
(`- [x]`) to the bottom of its checklist the moment you tick it — the way
Microsoft To Do and Google Keep behave. Works on desktop **and** mobile,
supports **nested tasks**, and integrates cleanly with undo.

---

## Features

- ✅ Tick a box → the item sinks below the unfinished ones instantly.
- 🧷 **Stable order** — already-completed items keep their relative order.
- 🌳 **Nesting-aware** — a checked sub-task moves only within its sibling group
  and carries its own children; indentation is preserved.
- 🎯 **Scope-safe** — only the checklist you edited is touched; separate lists
  (broken by a blank line or paragraph) are never merged.
- 🖱️ **Cursor-stable** and **undo-friendly** (`Ctrl/Cmd+Z` reverts the move).
- ⚡ Reacts only to real edits in the active note — it never scans the vault.
- ⚙️ Configurable: enable/disable, delay, direction, scope, and nesting.

---

## Folder structure

```
move-completed-tasks/
├── manifest.json          # Obsidian plugin manifest
├── package.json           # npm metadata + scripts
├── tsconfig.json          # TypeScript config
├── versions.json          # plugin-version → min-app-version map
├── styles.css             # (no styling needed; ships for completeness)
├── esbuild.config.mjs     # bundler config
├── version-bump.mjs       # `npm version` helper
└── src/
    ├── main.ts            # plugin entry: editor listener, scheduling, apply
    ├── settings.ts        # settings interface, defaults, settings tab
    ├── checklistSorter.ts # pure reorder engine (block detection + sort)
    └── utilities.ts       # task-line parsing helpers
```

---

## Build instructions

Requires Node.js 18+.

```bash
npm install
npm run build      # type-checks with tsc, then bundles to main.js
# or, while developing:
npm run dev        # esbuild watch mode
```

`npm run build` produces `main.js` in the project root.

---

## Installation

**Manual install into a vault:**

1. Create the folder `<your-vault>/.obsidian/plugins/move-completed-tasks/`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into it.
3. In Obsidian: **Settings → Community plugins → reload**, then enable
   **Move Completed Tasks** (turn off *Restricted mode* if needed).

That's it — tick a checkbox in any note and watch it drop.

---

## Settings

| Setting | Type | Default | Effect |
|---|---|---|---|
| Enable automatic sorting | toggle | On | Master on/off switch. |
| Delay before moving | slider (0–5000 ms) | 0 | Wait this long after a tick before moving (0 = instant). |
| Sort direction | dropdown | Move completed to bottom | Bottom or top. |
| Only sort current checklist | toggle | On | On: reorder just the edited list. Off: tidy every checklist in the note on each tick. |
| Ignore nested tasks | toggle | Off | On: only top-level items reorder; sub-tasks keep their order. |

---

## Algorithm

The tricky part is reordering **stably** and **without breaking nesting**. It runs
in four stages, entirely on plain strings (`src/checklistSorter.ts`), which is
why it is easy to test and identical on every platform.

**1. Detect a genuine tick (`src/main.ts`).**
A single CodeMirror 6 `updateListener` observes edits to the active editor. For
each change it looks at the touched line(s) in the new document; if a line is now
a completed task **and** the same line was *not* already a completed task before
the edit (checked by inverting the change set and reading the old document), it is
recorded as *newly checked*. This ignores text edits to already-done tasks and
does nothing when a box is *un*checked.

**2. Find the block (scope).**
From a newly-checked line the plugin expands up and down while adjacent lines are
task lines, giving one **contiguous checklist block**. Any non-task line — blank
line, heading, or paragraph — ends the block, so two visually separate lists are
never merged.

**3. Reorder the block (nesting-aware, stable).**
The block's lines are parsed into a **tree** using indentation depth (tabs count
as 4 units): an item is a child of the nearest previous item with a smaller
indent; equal indent means siblings. Each sibling group is then **stably
partitioned** — unfinished items keep their order, finished items keep their
order, and finished ones move to the bottom (or top). Partitioning recurses into
children (unless *Ignore nested tasks* is on), so a checked parent sinks carrying
its whole sub-tree, and a checked sub-task moves only among its siblings. The tree
is flattened back to lines in pre-order, preserving each line's original text and
indentation. The engine also returns the permutation it applied.

**4. Apply it (cursor + undo).**
If the order actually changed, the block is replaced in a **single editor
transaction** (so `Ctrl/Cmd+Z` undoes the whole move at once). Because reordering
never changes the number of lines, line indices stay stable; the plugin uses the
permutation to move the cursor onto its line's new position with the same column,
so typing is not disrupted. A guard flag ensures the plugin's own transaction
does not re-trigger the listener.

### Worked example

```
- [ ] A          - [ ] A
- [x] B    →     - [ ] C
- [ ] C          - [x] B
- [x] D          - [x] D
```

Both completed items (`B`, `D`) are partitioned to the bottom while their
relative order is preserved.

---

## Compatibility

- `minAppVersion` 1.4.0; targets current stable Obsidian on desktop and mobile.
- No Node-only APIs are used, so it runs on Windows, macOS, Linux, Android, iOS.
- Active in **Source mode** and **Live Preview** (where checkbox edits go through
  the editor). Reading view has no editor to hook.

## License

MIT
