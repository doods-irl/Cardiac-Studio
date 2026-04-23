# Architecture

A terse companion to `DESIGN.md` that calls out the *why* behind each
module boundary.

## Layering

```
UI ───► Store ───► Document Model
                    ▲
                    │ (derived)
              Binding Engine ──► Renderer ──► export (Rust)
                    │
              Asset Manager
```

- **Document Model** (`src/model/*`): plain data. No React, no I/O.
- **Store** (`src/store/*`): zustand slices. Single source of truth. Mutations go through `mutate()` so history + dirty flag + coalescing stay consistent.
- **Binding Engine** (`src/engine/binding/*`): pure functions turning
  `(element, record) → resolvedProps`. No state.
- **Renderer** (`src/engine/render/*`): pure functions producing SVG
  React nodes (or serialisable strings for export). Same code runs in
  the browser for preview and server-side for export; `resvg` finishes
  rasterising on the Rust side.
- **Format I/O** (`src/engine/format/*`): save / load / migrations,
  forwarded to Rust for disk access.
- **UI** (`src/components/*`): reads slices, dispatches mutations. Never
  manipulates the document directly.

The rule: **nothing about the UI leaks into the saved document**.

## Dataflow

```
  user drags    ┌──────────┐    mutation     ┌──────────────┐
  element  ───► │  UI      │ ───────────────► │  Document    │
                └──────────┘                  │   Store      │
                   ▲                           └──────┬───────┘
                   │                                  │ (React subscribes)
                   │              ┌──────────────────▼────────────────┐
                   │              │ re-render: binding resolve + SVG  │
                   │              └──────────────────┬────────────────┘
                   │                                 ▼
                   └────────────────────────  displayed canvas
```

Binding resolve + render are memoisable per `(elementId, recordHash)` so
a 1000-row dataset only re-renders rows whose records changed.

## Why folder-based project format?

- Git-friendly: `project.json` and per-dataset files diff cleanly.
- Inspectable: a user can poke at the files without leaving us a
  support ticket.
- Atomic writes per file keep each dataset write independent.
- A zip round-trip (`.cardiacx`) is a later step for easy distribution;
  it's a mechanical concern once the on-disk layout is stable.

## Why SVG for rendering?

- **Deterministic**: same SVG → same pixels. Critical for a card
  authoring tool that'll be printed.
- **Exportable**: resvg rasterises identical markup in Rust with the
  same fonts.
- **Printable**: SVG handles vector shapes, strokes, text layout, masks,
  gradients without leaving the DOM. We can later add an SVG-direct
  export with zero extra work.
- WebGL would win for 10k animated elements; we don't have that problem.

## Store mutation discipline

All mutations go through `useDoc.getState().mutate(fn, { coalesce? })`.
- `fn` receives the current `LoadedProject`, returns the next one.
- A `coalesce` key collapses consecutive mutations with the same key
  within 500 ms into a single undo entry (drag, text typing).
- Every mutation sets `dirty = true`; save / autosave clears it.

## Extensibility points

- **New element type**: add a variant to `ElementType`, a props
  interface, a renderer case in `svg.tsx`, an editor panel in
  `RightPanel.tsx`. Schema updates are additive.
- **New transform**: append to the `Transform` union in `types.ts`,
  extend `applyTransform` in `resolve.ts`.
- **New export format**: add an invoke handler in Rust (`src-tauri/src/export.rs`)
  and a button in `ExportPanel.tsx`.
- **New field type**: append to `FieldType`, add a `<Cell>` case in
  `DataGrid.tsx`, a default generator in `store/document.ts`.
