/**
 * Cardiac document model — pure data types.
 *
 * No runtime logic lives here. No React, no stores, no I/O.
 * Mirrors the JSON Schema in `src/schemas/project.schema.json`.
 */

export type ULID = string;

// ─── Project ───────────────────────────────────────────────────────────

export interface Project {
  meta: ProjectMeta;
  canvasDefaults: CanvasSpec;
  templates: Template[];
  styles: StyleDef[];
  palette: PaletteColor[];
  datasets: DatasetMeta[];
  fonts: FontRef[];
  assets: AssetRef[];
  variables: Variable[];
  /** Named icons; each may belong to a category. Referenced inline in
   *  text as `{{name}}` (uncategorised) or `{{category.name}}`. */
  icons: NamedIcon[];
  /** Registry of defined icon category names. Sorted alphabetically
   *  in the UI. Empty categories are allowed (you can create a
   *  category then populate it). */
  iconCategories: string[];
  /** Image gallery. Imports auto-populate this; categorisation and
   *  display names are UI-only metadata (data cells still bind via
   *  asset.id). */
  imageGallery: NamedImage[];
  imageCategories: string[];
  exportProfiles: ExportProfile[];
}

/**
 * A named icon is a nickname for an image asset. Users reference it
 * inline in text fields via `{{name}}` (uncategorised) or
 * `{{category.name}}` if the icon is assigned to a category. Multiple
 * icons can point at the same asset.
 *
 * Categories are a simple `string` on each icon; the Project's
 * `iconCategories` keeps an authoritative list of defined category
 * names (so empty categories are allowed and preserved).
 */
export interface NamedIcon {
  kind: "icon";
  id: ULID;
  name: string;
  assetId: ULID;
  category?: string;
}

/**
 * Gallery entry for an imported image. Parallel to NamedIcon but
 * images aren't inline-referenced in text (they live in element
 * assetId bindings keyed by id), so rename/move doesn't need a ripple
 * — the id is the stable reference.
 */
export interface NamedImage {
  kind: "image";
  id: ULID;
  name: string;
  assetId: ULID;
  category?: string;
}

/**
 * A named lookup table that bindings can route values through.
 * Solves the "rarity 1 → common icon, rarity 2 → uncommon icon" case:
 * define one `rarityIcon` variable with four entries, then bind any
 * number of elements through it.
 */
export interface Variable {
  id: ULID;
  name: string;
  description?: string;
  keyType: "text" | "number" | "enum";
  enumOptions?: string[];
  valueType: "image" | "color" | "text" | "number" | "boolean";
  /** key (always a string-keyed record) → value (asset id / hex / etc.) */
  entries: Record<string, unknown>;
  defaultValue?: unknown;
}

export interface ProjectMeta {
  name: string;
  description: string;
  author: string;
}

export interface PaletteColor {
  id: ULID;
  name: string;
  hex: string;
}

// ─── Canvas & Templates ────────────────────────────────────────────────

export interface CanvasSpec {
  widthMm: number;
  heightMm: number;
  dpi: number;
  bleedMm: number;
  marginMm: number;
  safeAreaMm: number;
  /** Rounded corner radius (mm) applied to the card itself. Content
   *  outside this rounded rectangle is clipped on export; the editor
   *  can optionally show the trimmed-away content as a greyed ghost. */
  cornerRadiusMm?: number;
  background?: Fill;
}

export interface Template {
  id: ULID;
  name: string;
  datasetId: ULID | null;
  canvas: CanvasSpec;
  root: ElementGroup;
}

// ─── Elements ──────────────────────────────────────────────────────────

export type ElementType =
  | "group"
  | "text"
  | "image"
  | "shape"
  | "icon"
  | "frame"
  | "mask"
  | "background"
  | "stat";

export type OverflowMode = "wrap" | "shrink" | "clip" | "ellipsis" | "scale";

export type ImageFit = "contain" | "cover" | "stretch" | "crop";

export interface Effect {
  kind: "dropShadow" | "innerShadow" | "glow" | "blur" | "stroke";
  dx?: number;
  dy?: number;
  blur?: number;
  color?: string;
  opacity?: number;
  spread?: number;
  /** Stroke effect: outline width in mm. */
  width?: number;
}

export interface ElementBase {
  id: ULID;
  type: ElementType;
  name: string;
  x: number; y: number;
  w: number; h: number;
  rotation: number;
  /**
   * Anchor / pivot point on the element, in 0..1 space where (0.5, 0.5)
   * is the centre. Used as the rotation origin and as the reference
   * point for alignment operations. Defaults to the centre.
   */
  anchor?: { x: number; y: number };
  opacity: number;
  locked: boolean;
  hidden: boolean;
  zIndex: number;
  maskId?: ULID;
  effects?: Effect[];
  bindings?: Record<string, Binding>; // "content" | "style.color" | ...
  visibilityBinding?: Binding;
  styleRefs?: ULID[];
}

export interface GroupElement extends ElementBase {
  type: "group";
  children: Element[];
}
export type ElementGroup = GroupElement;

export interface TextStyle {
  family: string;
  weight: number;
  size: number;              // mm (canvas units)
  color: string;
  align: "left" | "center" | "right" | "justify";
  valign: "top" | "middle" | "bottom";
  lineHeight: number;        // multiplier
  letterSpacing: number;     // em
  stroke?: { color: string; width: number };
  shadow?: Effect;
  italic?: boolean;
  underline?: boolean;
  uppercase?: boolean;
  /** Display size for `{{icon}}` tokens embedded in this text element.
   *  In mm. Defaults to the font size if absent. */
  inlineIconSize?: number;
  /** Vertical alignment for inline icons relative to the text line.
   *  "center" (default) centres the icon on the text's x-height;
   *  "baseline" sits the icon on the baseline; "top" aligns the icon
   *  top with the ascender top. */
  inlineIconAlign?: "baseline" | "center" | "top";
}

export interface TextElement extends ElementBase {
  type: "text";
  content: string;
  style: TextStyle;
  overflow: OverflowMode;
  padding: { t: number; r: number; b: number; l: number };
  autoFit?: boolean;
}

export interface ImageFilter {
  /** 1.0 = unchanged. 0..2 typical range. */
  brightness?: number;
  contrast?: number;
  saturation?: number;
  /** Degrees of hue rotation. */
  hue?: number;
  /** Blur radius in mm. */
  blur?: number;
  /** 0 unchanged, 1 fully grey. */
  grayscale?: number;
  /** 0..1 applied via feColorMatrix. */
  sepia?: number;
  /** 0..1 applied via feComponentTransfer. */
  invert?: number;
  /** Optional duotone: replaces grayscale luminance with a gradient from → to. */
  duotone?: { from: string; to: string; strength?: number };
  /** Recolour a grayscale-looking image with a single hue. `strength`
   *  blends the result back toward the original (0 = unchanged, 1 =
   *  fully tinted). Useful for neutral/greyscale art that needs to be
   *  themed per-variant. */
  tint?: { color: string; strength: number };
}

export interface ImageElement extends ElementBase {
  type: "image";
  assetId?: ULID;
  fit: ImageFit;
  focal: { x: number; y: number };   // 0..1
  corner: number;                    // mm (rectangular corner radius)
  /** Bounding-box stroke — a border around the image frame. */
  border?: { color: string; width: number };
  /**
   * Alpha-aware outline that follows the image's silhouette. Rendered
   * via SVG feMorphology so transparent PNGs get a clean stroke.
   */
  alphaStroke?: { color: string; width: number; opacity?: number };
  filter?: ImageFilter;
}

export type Fill =
  | { kind: "solid"; color: string; opacity?: number }
  | { kind: "linear"; angle: number; stops: Array<{ at: number; color: string }>; opacity?: number }
  | { kind: "radial"; cx: number; cy: number; r: number; stops: Array<{ at: number; color: string }>; opacity?: number };

export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
  /** 0..1 — independent of element opacity so a frame can have a
   *  transparent fill but a solid stroke (typical "border-only" case).
   *  Defaults to 1 when absent. */
  opacity?: number;
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: "rect" | "ellipse" | "polygon" | "path";
  fill?: Fill;
  stroke?: Stroke;
  cornerRadius?: number;
  path?: string;                     // when shape === "path"
  sides?: number;                    // when polygon
}

export interface BackgroundElement extends ElementBase {
  type: "background";
  fill: Fill;
}

export interface FrameElement extends ElementBase {
  type: "frame";
  fill?: Fill;
  stroke?: Stroke;
  cornerRadius?: number;
}

export interface IconElement extends ElementBase {
  type: "icon";
  assetId?: ULID;
  tint?: string;
}

export interface MaskElement extends ElementBase {
  type: "mask";
  shape: "rect" | "ellipse" | "path";
  cornerRadius?: number;
  path?: string;
}

export interface StatElement extends ElementBase {
  type: "stat";
  value: number;
  label?: string;
  style: TextStyle;
  background?: Fill;
  shape:
    | "circle" | "rect" | "diamond" | "shield"
    | "hexagon" | "triangle" | "pentagon" | "star" | "octagon";
}

export type Element =
  | GroupElement
  | TextElement
  | ImageElement
  | ShapeElement
  | BackgroundElement
  | FrameElement
  | IconElement
  | MaskElement
  | StatElement;

// ─── Styles ────────────────────────────────────────────────────────────

export interface StyleDef {
  id: ULID;
  name: string;
  target: "text" | "frame" | "image";
  props: Partial<TextStyle> | Partial<Fill> | Record<string, unknown>;
}

// ─── Bindings ──────────────────────────────────────────────────────────

export type Transform =
  | { kind: "upper" }
  | { kind: "lower" }
  | { kind: "title" }
  | { kind: "prefix"; value: string }
  | { kind: "suffix"; value: string }
  | { kind: "format"; pattern: string }
  | { kind: "map"; map: Record<string, unknown> }
  | { kind: "number"; decimals?: number; grouping?: boolean }
  | { kind: "if"; when: Predicate; then: unknown; else?: unknown }
  /** Route the current value through a named project variable's lookup table. */
  | { kind: "var"; variableId: ULID };

export interface Predicate {
  op: "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "truthy" | "in";
  value?: unknown;
  values?: unknown[];
}

export interface Binding {
  field?: string;
  static?: unknown;
  /**
   * Resolve to the hex of a palette entry by id. Takes priority over
   * `field` and `static` when set. Useful for "the title bar colour
   * should follow palette entry X" — re-themed automatically when the
   * palette entry changes.
   */
  paletteId?: string;
  transforms?: Transform[];
  fallback?: unknown;
}

// ─── Datasets ──────────────────────────────────────────────────────────

export type FieldType =
  | "text" | "longtext" | "number" | "bool" | "enum"
  | "color" | "image" | "tags" | "date" | "derived"
  /** Key-constrained field backed by a project variable. The cell is
   *  a dropdown of that variable's entry keys. */
  | "variable";

export interface FieldDef {
  id: ULID;
  name: string;             // the column name / binding key
  type: FieldType;
  enumOptions?: string[];
  /** When type === "variable": which variable provides the keys. */
  variableId?: ULID;
  default?: unknown;
  width?: number;           // grid display width
  formula?: string;         // for derived (future)
}

export interface DatasetMeta {
  id: ULID;
  name: string;
  fields: FieldDef[];
}

export type DataRecord = { id: ULID } & Record<string, unknown>;

// ─── Assets & Fonts ────────────────────────────────────────────────────

export interface AssetRef {
  id: ULID;
  kind: "image" | "font" | "icon";
  path: string;                      // project-relative
  originalName: string;
  hash: string;
  width?: number; height?: number;
  family?: string; weight?: number;
}

export interface FontRef {
  id: ULID;
  family: string;
  assetId: ULID;
  weight: number;
  italic: boolean;
  bundled: boolean;
}

// ─── Export ────────────────────────────────────────────────────────────

export interface ExportProfile {
  id: ULID;
  name: string;
  format: "png" | "pdf" | "svg";
  dpi: number;
  bleed: boolean;
  cropMarks?: boolean;
}

// ─── Full loaded project ───────────────────────────────────────────────

export interface Manifest {
  format: "cardiac";
  schemaVersion: number;
  appVersion: string;
  projectId: string;
  created: string;
  modified: string;
  name: string;
  integrity?: { projectJsonSha1: string; assetManifest?: string };
}

export interface LoadedProject {
  path: string;
  manifest: Manifest;
  project: Project;
  records: Record<string, DataRecord[]>; // keyed by dataset id
}
