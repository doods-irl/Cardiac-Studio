# End-to-end Workflow

This walks a first-time user from an empty desktop to a folder of
exported PNGs, using only the built-in features.

## 1. Create a project

File → **New project…** (or the Welcome dialog).
Pick a folder path ending in `.cardiac`, e.g. `~/Decks/FantasyStarter.cardiac`.

Cardiac creates the skeleton:

```
FantasyStarter.cardiac/
├── manifest.json
├── project.json          (one "Card" template, empty Cards dataset)
├── data/
├── assets/{images,fonts,icons}/
└── backups/
```

## 2. Design the card (Design tab)

The middle panel shows the card canvas. The left panel's **Add element**
lets you drop in:

- **Background** — full-card fill, sits at z-index -10.
- **Shape** — rect/ellipse with fill + stroke.
- **Text** — content + style.
- **Image** — with fit mode (contain / cover / stretch / crop).

Select an element to see its properties on the right: position, size,
rotation, opacity, style. Drag an element on the canvas to reposition.
Delete removes it. Ctrl+D duplicates it.

## 3. Define data columns (Data tab or inline in the bottom grid)

The bottom grid shows the active template's dataset. Use the column
controls in the toolbar to add fields:

- `name` · text
- `cost` · number
- `rules` · longtext
- `art` · image
- `rarity` · enum (`common` | `uncommon` | `rare` | `legendary`)

Add a handful of rows by clicking **+ Row**.

## 4. Bind elements to data

Select your title text element. In the right-hand **Bindings** section
you'll see available binding targets:

- `content` → choose field `name`
- `style.color` → leave static
- `style.size` → leave static

Select the background element. Add a binding on `fill.color` → field
`rarity`. Back in `project.json` you can add a `map` transform to
translate rarities to palette colours. (The example starter deck already
includes this.)

## 5. See all cards (Preview tab)

The preview grid renders one thumbnail per row, all at once. Click one to
make it the active record and jump back to Design.

## 6. Import art

In the data grid's `art` column, pick **Import image…** (or drag a PNG
onto the left panel's Assets section). Cardiac copies it into
`assets/images/<hash>_<slug>.ext` and adds an entry to `project.assets`.
You can then refer to that asset by id in any image field.

## 7. Export

Export tab → **Export full deck (PNGs)…** → choose an output folder.

Cardiac renders every record to SVG, hands each to `resvg` on the Rust
side with the project's font directory loaded, and writes numbered PNGs:

```
FantasyStarter-cards/
├── 01-goblin-scout.png
├── 02-forest-wolf.png
├── 03-ancient-oak-warden.png
└── ...
```

Export is deterministic: the on-screen preview and the exported PNG use
the same SVG pipeline. Repeat exports produce byte-identical output for
unchanged inputs.

## 8. Save & back up

Ctrl+S saves now. Autosave runs every 30s while there are unsaved
changes, rotating the last 10 snapshots into `backups/`. Because the
project is just a folder, you can also commit it to Git — `project.json`
and `data/*.json` diff cleanly and asset files are content-addressed.
