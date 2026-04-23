# Roadmap

## v0.1 (this scaffold) — the editor loop works

- [x] Project folder format + load / save / autosave / backup
- [x] Binding engine with transforms (upper, prefix, format, map, number, if)
- [x] Canvas editor: select, drag-move, zoom, safe-area overlay
- [x] Elements: background, shape (rect / ellipse), text, image, frame, stat, group
- [x] Data grid with typed cells (text / number / bool / enum / color / image / tags / date)
- [x] Live preview tied to the active row
- [x] Preview grid showing all variants
- [x] Undo / redo (snapshot journal with coalescing)
- [x] Basic keyboard shortcuts
- [x] Deterministic PNG export (single card + deck)

## v0.2 — usable editor polish

- [ ] Asset browser with drag-to-canvas + import dialog
- [ ] Multi-select + alignment tools (distribute, align, snap to guides)
- [ ] Layers panel drag-reorder + group / ungroup commands
- [ ] Effects: inner shadow, glow, blur (with resvg parity check)
- [ ] Font import UI + live family list in text props
- [ ] Deck export with progress bar + cancellation
- [ ] Backup recovery dialog when opening a project fails integrity check
- [ ] Bleed / crop marks in export
- [ ] Snapshot tests for export determinism

## v0.3 — production-grade

- [ ] Print sheet PDF layout designer
- [ ] Rich text (inline style runs)
- [ ] Masks (arbitrary shape clipping) + path-based shapes
- [ ] Gradient fills (linear / radial) in the UI
- [ ] Style presets + linked styles with inheritance
- [ ] Front / back template pairs
- [ ] CSV import with column type inference
- [ ] Conditional styling rules editor

## v0.4 — power users

- [ ] Symbol libraries (reusable element clusters)
- [ ] Theming by rarity / faction (named binding sets)
- [ ] Duotone / hue-shift image filters
- [ ] Batch image replacement by rule
- [ ] Derived fields (formula language)
- [ ] `.cardiacx` zip round-trip for distribution

## v1.0 — platform

- [ ] Plugin system (renderers, exporters, transforms)
- [ ] SVG / PDF-direct export with embedded fonts
- [ ] Localised UI
- [ ] Accessibility pass on panels + grid

## Deliberate non-goals

- Cloud sync / accounts / telemetry. Ever.
- Being a general graphic editor. This is a *card template* editor.
- Animation / video. Print-first, static output.
