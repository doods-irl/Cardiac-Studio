# Cardiac Project Format

A Cardiac project is a **folder** with the `.cardiac` extension. The folder
is the unit of sharing and versioning. Nothing in it is hidden; a user can
inspect every file with a text editor, put it under Git, or zip it up.

```
MyDeck.cardiac/
├── manifest.json
├── project.json
├── assets/
│   ├── images/
│   ├── fonts/
│   └── icons/
├── data/
│   └── <dataset-id>.json
├── backups/
└── previews/            (optional, regeneratable cache)
```

## `manifest.json`

Small, declarative, always valid.

```json
{
  "format": "cardiac",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "projectId": "01H8ZW3K2QMNV6A1EXAMPLE0001",
  "created":  "2026-04-22T10:00:00Z",
  "modified": "2026-04-22T11:30:00Z",
  "name": "Starter Deck",
  "integrity": {
    "projectJsonSha1": "…",
    "assetManifest": null
  }
}
```

- `schemaVersion` — integer, bumped when the document model changes.
- `integrity.projectJsonSha1` — SHA-1 of the `project.json` bytes at save
  time. On load, a mismatch is surfaced to the user with an option to
  open the latest autosave.

## `project.json`

The main document. Canonical JSON Schema:
[`src/schemas/project.schema.json`](../src/schemas/project.schema.json).

Top-level keys:

| Key | Type | Purpose |
|---|---|---|
| `meta` | object | Name, description, author. |
| `canvasDefaults` | `CanvasSpec` | Used when creating new templates. |
| `templates` | `Template[]` | Card templates (scene graph + canvas). |
| `styles` | `StyleDef[]` | Reusable named styles (text, frame, image). |
| `palette` | `PaletteColor[]` | Named theme colours. |
| `datasets` | `DatasetMeta[]` | Column schemas for rows (records in `/data`). |
| `fonts` | `FontRef[]` | Imported fonts metadata (files in `/assets/fonts`). |
| `assets` | `AssetRef[]` | All asset metadata (content-addressed filenames). |
| `exportProfiles` | `ExportProfile[]` | Saved export presets. |

See `examples/starter-deck.cardiac/project.json` for a working example.

## `data/<dataset-id>.json`

Row-oriented. Each record is `{ id, …fields }`. Field names match the
corresponding `FieldDef.name` on the dataset.

```json
[
  { "id": "rec-0001", "name": "Goblin", "cost": 1, "rules": "Haste.",  "rarity": "common" },
  { "id": "rec-0002", "name": "Wolf",   "cost": 2, "rules": "Draw.",   "rarity": "common" }
]
```

## `assets/*`

Imported files live here. Filenames are `<sha1-prefix>_<slug>.<ext>` so
renaming or duplicating never collides. The original filename is kept in
the `AssetRef.originalName` field for display.

## `backups/`

Autosave snapshots of `project.json`, named `autosave-YYYYMMDDThhmmss.json`.
The last 10 are kept; older ones are pruned. The UI offers recovery when a
primary load fails.

## Atomic writes

Every write goes through `write → fsync → rename` on a `*.tmp` sibling,
so a crash mid-save leaves the previous file untouched.

## Schema migrations

When `schemaVersion` in memory is **lower** than the current app’s version,
the loader walks a chain of pure `(project@N) → project@N+1` migrations
until it reaches the current version. Saving then writes the upgraded
document. Both the Rust (`src-tauri/src/format.rs`) and TypeScript
(`src/engine/format/migrations.ts`) sides maintain migration tables.

If `schemaVersion` in memory is **higher** than the app supports, the app
refuses to open the project rather than risk lossy downgrades.

## Integrity and recovery

- `integrity.projectJsonSha1` detects in-flight corruption.
- On load failure the UI offers to restore from the latest backup.
- Asset files have their hash stored in `AssetRef.hash` so we can later
  audit missing/changed files.

## Portability

- The format is **folder-based**, so `.cardiac` works across Windows,
  macOS and Linux without treating the folder as a bundle (macOS may
  still present it as one via the `Info.plist` of the `.app`).
- Asset references are **project-relative**. Moving the folder moves the
  assets with it. No external-file dependencies by default.
