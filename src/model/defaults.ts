import { newId } from "./ids";
import type {
  BackgroundElement,
  CanvasSpec,
  DataRecord,
  DatasetMeta,
  ElementGroup,
  FieldDef,
  FontRef,
  ImageElement,
  ShapeElement,
  Template,
  TextElement,
  TextStyle,
  Project,
  Variable,
} from "./types";
import { STARTER_FONTS } from "./fonts";

export const DEFAULT_CANVAS: CanvasSpec = {
  widthMm: 63.5,
  heightMm: 88.9,
  dpi: 300,
  bleedMm: 3,
  marginMm: 3,
  safeAreaMm: 5,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  // Generic `sans-serif` is the safe default — it resolves to
  // whatever system sans-serif the browser provides and never
  // falls back to Times New Roman. If the project has any imported
  // fonts, TextSection auto-repairs element families to the first
  // available so new text elements pick up the user's typeface.
  family: "sans-serif",
  weight: 500,
  size: 4.5,
  color: "#111111",
  align: "left",
  valign: "top",
  lineHeight: 1.2,
  letterSpacing: 0,
};

export function emptyGroup(name = "Root"): ElementGroup {
  return {
    id: newId(),
    type: "group",
    name,
    x: 0, y: 0, w: 0, h: 0,
    rotation: 0, opacity: 1,
    locked: false, hidden: false, zIndex: 0,
    children: [],
  };
}

export function defaultTemplate(canvas: CanvasSpec = DEFAULT_CANVAS): Template {
  const bg: BackgroundElement = {
    id: newId(),
    type: "background",
    name: "Background",
    x: 0, y: 0, w: canvas.widthMm, h: canvas.heightMm,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 0,
    fill: { kind: "solid", color: "#fafafa" },
  };
  const frame: ShapeElement = {
    id: newId(),
    type: "shape",
    name: "Border",
    x: 3, y: 3,
    w: canvas.widthMm - 6,
    h: canvas.heightMm - 6,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 1,
    shape: "rect",
    fill: { kind: "solid", color: "#ffffff" },
    stroke: { color: "#111111", width: 0.5 },
    cornerRadius: 2,
  };
  const title: TextElement = {
    id: newId(),
    type: "text",
    name: "Title",
    x: 5, y: 5,
    w: canvas.widthMm - 10, h: 10,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 10,
    content: "Card Name",
    style: { ...DEFAULT_TEXT_STYLE, size: 6, weight: 700 },
    overflow: "shrink",
    padding: { t: 0, r: 0, b: 0, l: 0 },
    bindings: { content: { field: "name", fallback: "Unnamed" } },
  };
  const rules: TextElement = {
    id: newId(),
    type: "text",
    name: "Rules text",
    x: 5, y: canvas.heightMm - 30,
    w: canvas.widthMm - 10, h: 22,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 10,
    content: "Rules go here.",
    style: { ...DEFAULT_TEXT_STYLE, size: 3.5, weight: 400 },
    overflow: "shrink",
    padding: { t: 0, r: 0, b: 0, l: 0 },
    bindings: { content: { field: "rules", fallback: "" } },
  };
  const art: ImageElement = {
    id: newId(),
    type: "image",
    name: "Art",
    x: 5, y: 18,
    w: canvas.widthMm - 10, h: 38,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 5,
    fit: "cover",
    focal: { x: 0.5, y: 0.5 },
    corner: 1.5,
    bindings: { assetId: { field: "art" } },
  };

  const root: ElementGroup = {
    ...emptyGroup(),
    w: canvas.widthMm,
    h: canvas.heightMm,
    children: [bg, frame, art, title, rules],
  };

  return {
    id: newId(),
    name: "Card",
    datasetId: null,
    canvas,
    root,
  };
}

export function defaultDataset(): { dataset: DatasetMeta; records: DataRecord[] } {
  const fields: FieldDef[] = [
    { id: newId(), name: "name",  type: "text",     width: 140 },
    { id: newId(), name: "cost",  type: "number",   width: 70 },
    { id: newId(), name: "rules", type: "longtext", width: 260 },
    { id: newId(), name: "art",   type: "image",    width: 140 },
    {
      id: newId(), name: "rarity", type: "enum",
      enumOptions: ["common", "uncommon", "rare", "legendary"], width: 110,
    },
  ];
  const dataset: DatasetMeta = {
    id: newId(),
    name: "Cards",
    fields,
  };
  const rows: DataRecord[] = [
    { id: newId(), name: "Goblin Scout", cost: 1, rules: "Haste.",                           art: "", rarity: "common" },
    { id: newId(), name: "Forest Wolf",  cost: 2, rules: "When this enters: draw a card.",  art: "", rarity: "common" },
    { id: newId(), name: "Ancient Oak",  cost: 4, rules: "Other allies get +1/+1.",          art: "", rarity: "rare"   },
  ];
  return { dataset, records: rows };
}

export function starterVariable(): Variable {
  return {
    id: newId(),
    name: "rarityIcon",
    description: "Rarity → icon lookup. Import images and assign one per rarity.",
    keyType: "enum",
    enumOptions: ["common", "uncommon", "rare", "legendary"],
    valueType: "image",
    entries: {},
  };
}

/** Starter font references seeded into new projects.
 *  Each has `bundled: true` + empty `assetId` — the font isn't backed
 *  by a user-imported file, it's a web/system family. Users can remove
 *  entries they don't need in the Fonts tab. */
export function starterFontRefs(): FontRef[] {
  return STARTER_FONTS.map((f) => ({
    id: newId(),
    family: f.family,
    weight: f.weight,
    italic: !!f.italic,
    bundled: true,
    assetId: "",
  }));
}

/** Patch a freshly-created project with a starting template + dataset.
 *  Fonts are deliberately NOT seeded: the font picker falls back to
 *  Arial-only when `project.fonts` is empty, and the policy is that
 *  any populated fonts list means "these are the typefaces this
 *  project uses" — no implicit system fonts stacked on top. Users
 *  start with a clean slate and import what they want. */
export function seedStarter(project: Project): Project {
  const tpl = defaultTemplate(project.canvasDefaults);
  const { dataset, records: _ignored } = defaultDataset();
  tpl.datasetId = dataset.id;
  void _ignored;
  const v = starterVariable();
  return {
    ...project,
    templates: [tpl],
    datasets: [dataset],
    variables: [...(project.variables ?? []), v],
    fonts: project.fonts ?? [],
  };
}
