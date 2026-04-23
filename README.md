# Cardiac

Local-first desktop app for designing tabletop/game cards.
Built with Tauri 2 + React + TypeScript.

```
┌─────────────────────────────────────────────┐
│  Design a card once. Generate a full deck.  │
│                                             │
│   Template editor · Data grid · Bindings    │
│   PNG / PDF export · Offline, file-owned    │
└─────────────────────────────────────────────┘
```

## What it does

- **Visual template editor** — drag-and-drop text, images, shapes, frames, backgrounds onto a card canvas.
- **Data grid** — every row is one card variant; columns are fields (text, number, enum, image, …).
- **Bindings** — any element property can be driven by a field, with transforms (upper, prefix, format, map, number, if).
- **Live preview** — change a cell in the grid, see every bound element update instantly.
- **Export** — PNG per card, whole decks to a folder, all rasterised deterministically via `resvg`.

## Project file format

A `.cardiac` **project is a folder** on disk, human-inspectable and friendly to version control:

```
MyDeck.cardiac/
├── manifest.json      schema version, app version, integrity
├── project.json       templates, styles, palette, bindings
├── assets/{images,fonts,icons}/
├── data/<datasetId>.json
├── backups/           autosave rotation
└── previews/          optional render cache
```

See [DESIGN.md](./DESIGN.md) for the full architecture and
[docs/PROJECT_FORMAT.md](./docs/PROJECT_FORMAT.md) for the format specification.

## Workflow (quick)

1. **File → New project…** choose a folder like `MyDeck.cardiac`.
2. Design your card: drop a background, add text/image/stat elements.
3. In the data grid below, fill in rows (one row = one card variant).
4. For each element that should vary per card, open Bindings in the right panel and pick a column.
5. Switch to **Preview** to see every variant; **Export** writes PNGs.

A full walkthrough: [docs/WORKFLOW.md](./docs/WORKFLOW.md).

## Running

### Dev mode (browser-only, no Tauri shell)

```
npm install
npm run dev
```

The app boots with an in-memory sample project. Save / open / export require the desktop shell.

### Full desktop build

Requires Rust 1.77+ and (Windows) the VS Build Tools + WebView2 runtime.

```
npm install
npm run tauri:dev     # hot-reloading desktop app
npm run tauri:build   # release build → src-tauri/target/release/bundle/
```

## Repository layout

```
Cardiac/
├── DESIGN.md              full architecture
├── README.md              this file
├── package.json
├── vite.config.ts · tsconfig.json · index.html
├── src/                   frontend (React + TS)
│   ├── main.tsx · App.tsx
│   ├── styles/
│   ├── model/             pure document types
│   ├── store/             zustand slices + history
│   ├── engine/            binding / render / export / format
│   ├── io/                Tauri invoke wrappers
│   ├── schemas/           JSON Schema
│   └── components/        Shell / Canvas / Panels / Grid
├── src-tauri/             backend (Rust)
│   ├── Cargo.toml · tauri.conf.json · build.rs
│   ├── capabilities/
│   └── src/
│       ├── main.rs
│       ├── format.rs · project.rs
│       ├── assets.rs · export.rs
├── docs/                  supporting documentation
└── examples/
    └── starter-deck.cardiac/
```

## License

Proprietary source in this scaffold; bundled Inter / Bebas Neue fonts (when added) are SIL OFL.
