# Cardiac — Design Document

> Visual authoring tool for tabletop/game card creation.
> Local-only, offline-first, Tauri + React + TypeScript.

---

## 1. Architecture Overview

Cardiac is a **document-oriented desktop application**. The entire editable
state lives in a serialisable **Project Document** that is persisted to a
`.cardiac` project folder on disk. The document is rendered deterministically
by a pure-function pipeline, then displayed via SVG + HTML.

```
┌──────────────────────────────────────────────────────────────┐
│                        Cardiac Frontend                      │
│                  React + TypeScript (Vite)                   │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────┐  │
│  │  UI Shell  │  │   Canvas   │  │  Data Grid │  │ Panels │  │
│  │  (layout)  │  │  (editor)  │  │ (records)  │  │(props) │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └────┬───┘  │
│        └────────────────┼───────────────┴──────────────┘     │
│                         ▼                                    │
│   ┌────────────────────────────────────────────────────┐     │
│   │   Document Store (zustand) — single source of truth│     │
│   │   - Project, Templates, Elements, Dataset, Bindings│     │
│   │   - EditorState (transient: selection, viewport)   │     │
│   │   - Undo/redo history (command journal)            │     │
│   └───────────────────────┬────────────────────────────┘     │
│                           ▼                                  │
│   ┌───────────────┐ ┌────────────┐ ┌────────────────────┐    │
│   │ Binding Engine│ │  Renderer  │ │  Export Pipeline   │    │
│   │ field→props   │ │ pure SVG   │ │  PNG/PDF/Sheet     │    │
│   └───────┬───────┘ └─────┬──────┘ └────────┬───────────┘    │
│           └─────── Tauri invoke() ──────────┘                │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                     Tauri Rust Backend                       │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────┐ │
│  │  Project   │  │   Assets   │  │  Export    │  │  FS I/O │ │
│  │  loader/   │  │  importer  │  │  renderer  │  │ autosave│ │
│  │   saver    │  │  hashing   │  │  (resvg)   │  │  backup │ │
│  └────────────┘  └────────────┘  └────────────┘  └─────────┘ │
└──────────────────────────────────────────────────────────────┘
                           ▼
              .cardiac project folder on disk
```

### Module Boundaries

| Layer            | Responsibility                                                  |
|------------------|------------------------------------------------------------------|
| **Document Model** | Plain-data types. No UI, no side effects. Fully serialisable. |
| **Store**        | In-memory state, selection, history, dirty tracking.            |
| **Binding Engine** | Pure function: `(element, record, dataset) → resolvedProps`.   |
| **Renderer**     | Pure function: `resolvedElement → SVGNode`.                      |
| **Export**       | Deterministic rasterisation via `resvg` (Rust) for PNG/PDF.      |
| **Asset Manager**| Hashed, project-local copies. Thumbnail cache.                   |
| **Tauri Backend**| Filesystem, fonts, heavy rendering, autosave.                    |

Strict rule: the **document model** never knows about React. The **UI** never
mutates the document directly — it dispatches commands through the store.

---

## 2. Project File Format (`.cardiac`)

The project is a **folder** with the `.cardiac` extension (macOS treats it as
a bundle; Windows/Linux treat it as a directory). A packaged `.cardiacx` zip
variant is planned for distribution.

```
MyDeck.cardiac/
├── manifest.json            # schema version, app version, integrity
├── project.json             # templates, styles, bindings, palette
├── assets/
│   ├── images/              # hashed filenames: <sha1>_<slug>.<ext>
│   ├── fonts/               # imported fonts + metadata
│   └── icons/               # SVG icons / symbol libs
├── data/
│   └── <dataset-id>.json    # row-oriented records
├── previews/                # optional render cache (regeneratable)
└── backups/                 # autosave rotation (last 10)
```

### `manifest.json`

```json
{
  "format": "cardiac",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "projectId": "b5f5e2e0-...",
  "created": "2026-04-22T10:00:00Z",
  "modified": "2026-04-22T11:30:00Z",
  "name": "Fantasy Starter Deck",
  "integrity": {
    "projectJsonSha1": "...",
    "assetManifest": "..."
  }
}
```

### `project.json` (top-level keys)

- `meta` — name, description, author
- `canvasDefaults` — default card size, DPI, bleed, margin
- `templates[]` — card templates (scene graphs)
- `styles[]` — reusable named text/frame styles
- `palette[]` — named theme colours
- `datasets[]` — dataset metadata (records live in `/data/`)
- `fonts[]` — imported font metadata
- `assets[]` — asset metadata (hashed filename, original name, dims)
- `exportProfiles[]` — named export presets

See `src/schemas/project.schema.json` for the full JSON Schema, and
`examples/starter-deck.cardiac/` for a working example.

### Versioning & Migrations

`schemaVersion` is an integer. Migrations are pure functions
`(projectAtN) → projectAtN+1` registered in `src/engine/format/migrations.ts`.
On load, the project is walked forward through all registered migrations.

### Integrity & Recovery

- Writes are **atomic**: write to `*.tmp`, fsync, rename.
- Autosave runs every 30s into `backups/autosave-<timestamp>.json`.
- On open, if `project.json` fails to parse, the most recent backup is offered.
- Asset file hashes are stored in `manifest.json.integrity` for later verify.

---

## 3. Data Model

All IDs are ULIDs (sortable, URL-safe).

### Project

```ts
interface Project {
  meta: ProjectMeta;
  canvasDefaults: CanvasDefaults;
  templates: Template[];
  styles: StyleDef[];
  palette: PaletteColor[];
  datasets: DatasetMeta[];  // records in /data/*.json
  fonts: FontRef[];
  assets: AssetRef[];
  exportProfiles: ExportProfile[];
}
```

### Template (a card)

```ts
interface Template {
  id: ULID;
  name: string;
  datasetId: ULID;          // which dataset drives this template
  canvas: CanvasSpec;       // w/h/DPI/bleed/margin/safe
  root: ElementGroup;       // element tree
}

interface CanvasSpec {
  widthMm: number;
  heightMm: number;
  dpi: number;              // export DPI (e.g. 300)
  bleedMm: number;
  marginMm: number;
  safeAreaMm: number;
  background?: Fill;
}
```

### Element (scene-graph node)

All elements share a common header, then have type-specific props:

```ts
interface ElementBase {
  id: ULID;
  type: ElementType;
  name: string;
  x: number; y: number;             // mm, top-left of bounding box
  w: number; h: number;             // mm
  rotation: number;                 // degrees
  opacity: number;                  // 0..1
  locked: boolean;
  hidden: boolean;
  maskId?: ULID;                    // reference to a mask element
  effects?: Effect[];               // drop-shadow, glow, blur
  bindings?: BindingMap;            // targetProp → Binding
  visibilityBinding?: Binding;      // conditional visibility
}

type ElementType =
  | 'group' | 'text' | 'richText' | 'image' | 'shape'
  | 'icon' | 'frame' | 'mask' | 'background' | 'stat';

interface TextProps { content: string; style: TextStyle; overflow: OverflowMode; }
interface ImageProps { assetId?: ULID; fit: ImageFit; focal: {x:number,y:number};
                       corner: number; filter?: ImageFilter; }
interface ShapeProps { shape: 'rect'|'ellipse'|'polygon'|'path'; fill: Fill;
                       stroke?: Stroke; cornerRadius?: number; path?: string; }
// ... etc.
```

### Style (reusable)

```ts
interface StyleDef {
  id: ULID;
  name: string;                     // "Card Title", "Rarity Legendary"
  target: 'text' | 'frame' | 'image';
  props: Partial<TextStyle | FrameStyle | ImageStyle>;
}
```

### Binding

A binding resolves a target property from a record. Both static and
field-backed values are supported, composable through transforms:

```ts
interface Binding {
  field?: string;                   // dataset column name
  static?: unknown;                 // fallback when no field
  transforms?: Transform[];
  fallback?: unknown;
}

type Transform =
  | { kind: 'upper' | 'lower' | 'title' }
  | { kind: 'prefix'; value: string }
  | { kind: 'suffix'; value: string }
  | { kind: 'format'; pattern: string }           // "HP: {value}/10"
  | { kind: 'map'; map: Record<string, unknown> } // enum → value
  | { kind: 'number'; decimals?: number; grouping?: boolean }
  | { kind: 'if'; when: Predicate; then: unknown; else?: unknown };
```

`BindingMap` is `Record<TargetPropPath, Binding>`, e.g.
`{ "content": {...}, "style.color": {...} }`.

### Dataset

```ts
interface DatasetMeta {
  id: ULID;
  name: string;
  fields: FieldDef[];               // column schema
  storage: 'json';                  // v1 only
}

interface FieldDef {
  id: ULID;
  name: string;                     // column name, used as binding field
  type: FieldType;
  enumOptions?: string[];
  default?: unknown;
}

type FieldType =
  | 'text' | 'longtext' | 'number' | 'bool' | 'enum'
  | 'color' | 'image' | 'tags' | 'date' | 'derived';

type Record = { id: ULID; [fieldName: string]: unknown };
```

### Asset

```ts
interface AssetRef {
  id: ULID;
  kind: 'image' | 'font' | 'icon';
  path: string;                     // relative to project root
  originalName: string;
  hash: string;                     // sha1 of content
  width?: number; height?: number;  // images
  family?: string; weight?: number; // fonts
  unused?: boolean;                 // computed flag
}
```

---

## 4. UI Layout

```
┌─── Title bar (project name · unsaved indicator · menu) ──────┐
├────────┬───────────────────────────────────┬─────────────────┤
│        │                                   │                 │
│  LEFT  │        CENTRE: CARD CANVAS        │      RIGHT      │
│        │                                   │                 │
│ ▸Temp- │     ┌─────────────────────┐       │  ▸Properties    │
│  lates │     │                     │       │  ▸Bindings      │
│        │     │   rendered card     │       │  ▸Style         │
│ ▸Asset │     │   with selection    │       │  ▸Effects       │
│  browser    │   handles           │       │                 │
│        │     │                     │       │                 │
│ ▸Layers│     └─────────────────────┘       │                 │
│        │    rulers · zoom · guides         │                 │
│        │                                   │                 │
├────────┴───────────────────────────────────┴─────────────────┤
│   BOTTOM: DATA GRID (row per card variant)                   │
│   name │ cost │ attack │ art │ rarity │ type │ ...           │
│   Goblin  1     2       [img] common   minion                │
│  ▸Orc     3     4       [img] uncommon minion (selected)     │
│   ...                                                        │
├──────────────────────────────────────────────────────────────┤
│   Status bar: canvas size · current template · dataset rows  │
└──────────────────────────────────────────────────────────────┘
```

- **Tabs** at top allow switching between **Design**, **Data**, **Preview**,
  **Export** modes, but in default (Design) view the grid stays docked bottom
  so you can edit data and see the canvas update at the same time.
- **Layers panel** mirrors the element tree. Drag to reorder, click eye/lock.
- **Bindings panel** is contextual: shows which fields are bound to which
  props of the current element, with an "Add binding" picker.
- **Asset browser** supports drag-to-canvas. Drop creates an Image element.
- **Preview mode** shows a grid of all card variants rendered small.

### Keyboard shortcuts (planned)

| Action | Shortcut |
|---|---|
| Save | Ctrl+S |
| Undo / Redo | Ctrl+Z / Ctrl+Shift+Z |
| Delete element | Del |
| Duplicate | Ctrl+D |
| Group / Ungroup | Ctrl+G / Ctrl+Shift+G |
| Lock / Hide | Ctrl+L / Ctrl+H |
| Align left/right/top/bottom | Alt+1/2/3/4 |
| Next/Prev record | PgDn / PgUp |
| Toggle preview mode | Ctrl+P |
| Export current card | Ctrl+E |

---

## 5. Rendering Pipeline

Rendering is a three-stage pure pipeline so it is trivially testable,
memoisable, and deterministic.

```
Template + Record + Dataset
           │
           ▼
  ┌─────────────────────┐
  │  1. Binding resolve │   resolveElement(el, ctx) → ResolvedElement
  └─────────────────────┘   (applies bindings, transforms, fallbacks)
           │
           ▼
  ┌─────────────────────┐
  │  2. Layout          │   layout(resolved, parent) → LaidOut
  └─────────────────────┘   (anchor, text overflow, image fit)
           │
           ▼
  ┌─────────────────────┐
  │  3. Render          │   renderSVG(laidOut) → React.ReactNode
  └─────────────────────┘   (or → SVG string for export)
```

For **preview** we render live React SVG.
For **export** we emit an SVG string and hand it to `resvg` in Rust for
deterministic PNG/PDF rasterisation. Fonts from `/assets/fonts` are loaded
into resvg's font database before export.

Memoisation: results are cached by `(elementId, recordHash)`.
On dataset edit we invalidate only affected rows.

---

## 6. Binding Engine

Single entry point:

```ts
resolve(binding: Binding, record: Record): unknown
```

Order of operations:
1. If `binding.field` present: look up `record[field]`. Otherwise use `binding.static`.
2. If raw value is `undefined`/`null` or missing: use `binding.fallback`.
3. Apply `transforms` in order, each taking the current value and producing
   the next.
4. Return.

Target-prop application uses a dotted path (`style.color`, `content`,
`props.corner`) so bindings are schema-agnostic. A small path-set helper
updates the resolved element without mutating the source.

---

## 7. Export Pipeline

1. For each record in the chosen dataset (and template):
   - run binding engine → resolved tree
   - render to SVG string (server-side; no DOM required)
2. Hand SVG + font dir + DPI to Rust:
   - `resvg` rasterises to `RgbaImage`
   - encoded to PNG, or tiled into a print sheet PDF (`printpdf` crate)
3. Files written to user-chosen folder:
   - `deck-name/01-goblin.png`, `02-orc.png`, ...
   - or `deck-name/sheet-01.pdf` for print sheets

Export is **cancellable** and runs in a Tauri async command so the UI stays
responsive. Progress is streamed back via a Tauri event channel.

---

## 8. MVP Scope

### In MVP (v0.1)

- Project folder format + load/save/autosave + backup recovery
- One or many templates, one dataset per template
- Element types: text, image, shape (rect/ellipse), background
- Properties panel with position/size/rotation/opacity/fill/stroke/corner
- Text styling: family/weight/size/colour/align/line-height, overflow shrink+clip
- Image fit: contain/cover/stretch, corner radius
- Effects: drop shadow
- Data grid: add/remove/reorder columns, types text/number/bool/enum/image
- Bindings: static or field with upper/lower/prefix/suffix/format transforms
- Live preview tied to selected row
- Asset import (images, fonts) with hashed storage
- Export single card PNG + deck zip of PNGs
- Undo/redo (command journal)

### Post-MVP

- Rich text (multi-style inline)
- Gradient fills, masks, path shapes
- Print-sheet PDF with crop marks
- Style presets library + inheritance
- Symbol libraries
- Formula/derived fields
- Plugin system
- Front/back card pairs
- Duotone / hue-shift image filters
- Conditional styling rules UI
- CSV import with column-type inference

---

## 9. Key Libraries

| Area | Choice | Rationale |
|---|---|---|
| Shell | Tauri 2 | Tiny binaries, strong sandboxing, local-first friendly |
| UI | React 18 + TypeScript | Familiar, type-safe, large ecosystem |
| Bundler | Vite | Fast dev, small config |
| State | Zustand | Small, unopinionated, easy to slice |
| Canvas | Raw SVG + React | Deterministic, printable, no WebGL complexity |
| Drag | dnd-kit | Accessible, modern |
| IDs | `ulid` | Sortable, no server needed |
| Rust JSON | `serde_json` | Standard |
| Rust raster | `resvg` + `usvg` | Headless SVG → PNG with font support |
| Rust PDF | `printpdf` | Simple PDF writing |
| Rust hashing | `sha1` | Asset content addressing |

---

## 10. Risks & Tradeoffs

- **Rendering parity (edit vs export).** Browser SVG and resvg differ
  subtly (text metrics especially). Mitigation: bundle fonts and load the
  same font file into resvg; snapshot-test export output; keep effects list
  conservative.
- **Large datasets.** 10k-row grids stress naive DOM tables. Mitigation:
  virtualised grid; memoised per-row binding resolve; preview thumbnails
  rendered off the main thread.
- **Folder vs archive format.** Folders are diff-friendly but awkward to
  share. Mitigation: ship an "Export as `.cardiacx`" zip round-trip.
- **Undo size.** Full doc snapshots explode memory. Mitigation: immer-style
  patch journal; collapse consecutive text edits.
- **Font licensing.** Bundling fonts means licensing diligence. MVP ships
  with Inter + Bebas Neue (SIL OFL) only; users import anything else.
- **Tauri API churn.** v2 is stable but plugins evolve. Pin versions.

---

## 11. Implementation Plan (phased)

### Phase 0 — Scaffolding (this commit)
- [x] Repo layout, Tauri + React + TS config
- [x] Document model types + JSON schema
- [x] Rust project loader/saver + autosave
- [x] Minimal editor shell: canvas, grid, panels
- [x] Binding engine + live preview
- [x] Basic element types (text, image, shape, background)
- [x] Static PNG export of a single card

### Phase 1 — Usable editor
- [ ] Keyboard shortcuts + undo/redo polish
- [ ] Layers panel drag-reorder, grouping
- [ ] Effects (drop shadow, glow)
- [ ] Asset browser with drag-to-canvas
- [ ] Deck-wide PNG export with progress
- [ ] Backup recovery UI

### Phase 2 — Production polish
- [ ] Print sheet PDF with bleed/crop
- [ ] Style presets + inheritance
- [ ] Rich text
- [ ] Masks / path shapes / gradients
- [ ] Front/back pairs
- [ ] CSV import
- [ ] Snapshot test harness

### Phase 3 — Advanced
- [ ] Plugins
- [ ] Symbol libraries
- [ ] Theming by rarity/faction (conditional styling)
- [ ] Batch image replacement

---

## 12. Example Snippets

See:
- `src/schemas/project.schema.json` — full JSON Schema
- `examples/starter-deck.cardiac/project.json` — a real project
- `examples/starter-deck.cardiac/data/cards.json` — dataset
- `docs/WORKFLOW.md` — blank project → exported deck walkthrough

---

## 13. Folder / Module Structure

```
Cardiac/
├── DESIGN.md                        ← this file
├── README.md
├── package.json · vite.config.ts · tsconfig.json · index.html
│
├── src/                              ← frontend
│   ├── main.tsx · App.tsx
│   ├── styles/app.css
│   ├── model/                        ← pure data types
│   │   ├── types.ts                  element / template / project
│   │   ├── ids.ts                    ULID helpers
│   │   ├── defaults.ts               constructors for default elements
│   │   └── selectors.ts              document queries
│   ├── store/                        ← zustand slices + command journal
│   │   ├── document.ts
│   │   ├── editor.ts
│   │   └── history.ts
│   ├── engine/
│   │   ├── binding/resolve.ts
│   │   ├── render/svg.tsx
│   │   ├── format/save.ts · load.ts · migrations.ts
│   │   └── export/png.ts
│   ├── io/
│   │   └── tauri.ts                  invoke() wrappers
│   ├── schemas/project.schema.json
│   └── components/
│       ├── Shell/                    app chrome, menus, tabs
│       ├── Canvas/                   canvas + selection + tools
│       ├── Panels/                   props, bindings, layers, assets
│       ├── Grid/                     data grid
│       └── Dialogs/                  new project, import, export
│
├── src-tauri/                        ← backend
│   ├── Cargo.toml · tauri.conf.json · build.rs
│   └── src/
│       ├── main.rs                   tauri setup + command registration
│       ├── project.rs                load / save / autosave
│       ├── format.rs                 schema types + migrations
│       ├── assets.rs                 import, hash, thumbnail
│       └── export.rs                 resvg + PDF
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PROJECT_FORMAT.md
│   ├── WORKFLOW.md
│   └── ROADMAP.md
│
└── examples/
    └── starter-deck.cardiac/
```
