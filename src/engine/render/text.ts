/**
 * Text layout engine for the card canvas.
 *
 * Handles inline-icon tokens (`{{name}}`, `{{category.name}}`) and a
 * small subset of inline-markup tags that override per-run styling:
 *
 *     [b]bold[/b]      — bold
 *     [i]italic[/i]    — italic
 *     [u]under[/u]     — underline
 *     [c=#ff0000]x[/c] — colour override (any hex)
 *
 * Tags can nest. Style is tracked on a stack while parsing; each
 * resulting text atom snapshots the current style, which propagates
 * through word splitting and line packing into `Run`s the renderer
 * then emits as per-run `<text>` elements.
 *
 * Glyph widths are approximated (no canvas measurement available
 * SSR-side). resvg uses the real metrics on export, so minor visual
 * drift between preview and export is expected but small.
 */

import type { AssetRef, NamedIcon } from "@/model/types";

export interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface TextRun {
  kind: "text";
  value: string;
  width: number;
  style?: RunStyle;
}
export interface IconRun {
  kind: "icon";
  name: string;
  asset?: AssetRef;
  width: number;
}
export type Run = TextRun | IconRun;

export interface Line {
  runs: Run[];
  width: number;
}

const AVG_CHAR_EM = 0.55;

export interface MeasureOpts {
  fontSize: number;
  letterSpacing: number;
  family?: string;
  weight?: number;
  italic?: boolean;
  bold?: boolean;
}
// Icon token regex (used during parsing below).
const ICON_HEAD = /^\{\{([A-Za-z0-9_-]+)(?:\.([A-Za-z0-9_-]+))?\}\}/;
// Markup tag head regex. Matches `[b]`, `[/b]`, `[i]`, `[/i]`, `[u]`,
// `[/u]`, `[c=#rrggbb]`, or `[/c]`.
const TAG_HEAD = /^\[(\/?[biu]|\/?c(?:=#[0-9a-fA-F]{3,8})?)\]/;

/** Resolve a `{{name}}` or `{{category.name}}` token. */
export function findIconInGallery(
  icons: NamedIcon[],
  category: string | null,
  name: string,
): NamedIcon | null {
  for (const i of icons) {
    if ((i.category ?? null) === category && i.name === name) return i;
  }
  return null;
}

export function approxTextWidth(text: string, fontSize: number, letterSpacing: number): number {
  return text.length * (fontSize * AVG_CHAR_EM + letterSpacing);
}

// Shared measurement context. Created lazily so SSR / worker contexts
// that lack `document` fall through to the approximation path.
let measureCtx: CanvasRenderingContext2D | null | undefined;
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    if (typeof document === "undefined") { measureCtx = null; return null; }
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
    return measureCtx;
  } catch {
    measureCtx = null;
    return null;
  }
}

/**
 * Real-glyph width via canvas `measureText` when a 2D context is
 * available, otherwise the em-average approximation. Uses the same
 * `font` shorthand the browser applies to `<text style="font-family">`
 * so the measured width matches what SVG renders (assuming the font
 * has loaded — close enough for pre-load frames too).
 */
export function measureTextWidth(text: string, opts: MeasureOpts): number {
  if (!text) return 0;
  const { fontSize, letterSpacing, family, weight, italic, bold } = opts;
  const ctx = getMeasureCtx();
  if (!ctx) return approxTextWidth(text, fontSize, letterSpacing);
  const fam = family || "Arial";
  const w = bold ? Math.min(900, Math.max(700, (weight ?? 400) + 300)) : (weight ?? 400);
  // Quote the family name so multi-word / digit-leading / reserved-word
  // families parse as a single family instead of silently falling through
  // to the next candidate (which would return widths for the wrong font
  // and skew alignment).
  const quoted = /^["'].*["']$/.test(fam) ? fam : `"${fam.replace(/"/g, '\\"')}"`;
  ctx.font = `${italic ? "italic " : ""}${w} ${fontSize}px ${quoted}`;
  const m = ctx.measureText(text);
  return m.width + letterSpacing * Math.max(0, text.length - 1);
}

type Atom =
  | { kind: "text"; value: string; style?: RunStyle }
  | { kind: "icon"; name: string; asset?: AssetRef }
  | { kind: "break" };

/**
 * Parse `content` into a flat list of atoms, consuming icon tokens and
 * style tags as they're encountered. Unknown `{{...}}` tokens fall
 * through as literal text. Stray `[...]` that doesn't match a known
 * tag is also treated as literal text.
 */
export function tokenize(content: string, icons: NamedIcon[], assets: AssetRef[]): Atom[] {
  const atoms: Atom[] = [];
  const stack: RunStyle[] = [{}];

  const currentStyle = (): RunStyle => stack[stack.length - 1];
  const pushStyle = (patch: RunStyle) => {
    stack.push({ ...currentStyle(), ...patch });
  };
  const popStyleKey = (key: keyof RunStyle) => {
    // Walk back to the first style-patch that SET this key and pop all
    // frames above it. Tolerates mismatched tags by simply clearing
    // the key on the top frame if no opener exists.
    for (let i = stack.length - 1; i > 0; i--) {
      if (key in stack[i] && stack[i][key] !== stack[i - 1][key]) {
        stack.splice(i, 1);
        return;
      }
    }
    const top = { ...currentStyle() };
    delete top[key];
    stack[stack.length - 1] = top;
  };

  let buf = "";
  const flushText = () => {
    if (!buf) return;
    const style = currentStyle();
    const hasStyle = Object.keys(style).length > 0;
    atoms.push({ kind: "text", value: buf, ...(hasStyle ? { style: { ...style } } : {}) });
    buf = "";
  };

  let i = 0;
  while (i < content.length) {
    const ch = content[i];

    // Newline → paragraph break.
    if (ch === "\n") {
      flushText();
      atoms.push({ kind: "break" });
      i++;
      continue;
    }

    // Icon token.
    if (ch === "{" && content[i + 1] === "{") {
      const m = ICON_HEAD.exec(content.slice(i));
      if (m) {
        flushText();
        const [raw, first, second] = m;
        const category = second !== undefined ? first : null;
        const iconName = second ?? first;
        const icon = findIconInGallery(icons, category, iconName);
        if (icon) {
          const asset = assets.find((a) => a.id === icon.assetId);
          atoms.push({ kind: "icon", name: iconName, asset });
        } else {
          // Unknown icon — keep as literal text so the typo is visible.
          const style = currentStyle();
          const hasStyle = Object.keys(style).length > 0;
          atoms.push({ kind: "text", value: raw, ...(hasStyle ? { style: { ...style } } : {}) });
        }
        i += raw.length;
        continue;
      }
    }

    // Markup tag.
    if (ch === "[") {
      const m = TAG_HEAD.exec(content.slice(i));
      if (m) {
        const body = m[1];
        if (body === "b" || body === "i" || body === "u") {
          flushText();
          const key = body === "b" ? "bold" : body === "i" ? "italic" : "underline";
          pushStyle({ [key]: true });
          i += m[0].length;
          continue;
        }
        if (body === "/b" || body === "/i" || body === "/u") {
          flushText();
          const key = body[1] === "b" ? "bold" : body[1] === "i" ? "italic" : "underline";
          popStyleKey(key);
          i += m[0].length;
          continue;
        }
        if (body === "/c") {
          flushText();
          popStyleKey("color");
          i += m[0].length;
          continue;
        }
        const cMatch = /^c=(#[0-9a-fA-F]{3,8})$/.exec(body);
        if (cMatch) {
          flushText();
          pushStyle({ color: cMatch[1] });
          i += m[0].length;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }
  flushText();
  return atoms;
}

/** Check whether two run styles are equivalent (for run merging). */
function sameStyle(a?: RunStyle, b?: RunStyle): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.bold === b.bold && a.italic === b.italic
      && a.underline === b.underline && a.color === b.color;
}

export function layoutRuns(
  content: string,
  icons: NamedIcon[],
  assets: AssetRef[],
  opts: {
    fontSize: number; iconSize: number; letterSpacing: number; maxWidth: number;
    uppercase?: boolean; family?: string; weight?: number; italic?: boolean;
  },
): Line[] {
  const { fontSize, iconSize, letterSpacing, maxWidth, uppercase, family, weight, italic } = opts;
  const atoms = tokenize(content, icons, assets);
  if (atoms.length === 0) return [{ runs: [], width: 0 }];

  type Unit =
    | { kind: "word"; value: string; width: number; style?: RunStyle }
    | { kind: "space"; value: string; width: number; style?: RunStyle }
    | { kind: "break" }
    | { kind: "icon"; name: string; asset?: AssetRef; width: number };

  const measure = (s: string, st?: RunStyle): number => measureTextWidth(s, {
    fontSize, letterSpacing, family, weight,
    italic: st?.italic ?? italic,
    bold: st?.bold,
  });

  const units: Unit[] = [];
  for (const a of atoms) {
    if (a.kind === "break") { units.push({ kind: "break" }); continue; }
    if (a.kind === "icon")  { units.push({ kind: "icon", name: a.name, asset: a.asset, width: iconSize }); continue; }
    const parts = (uppercase ? a.value.toUpperCase() : a.value).split(/(\s+)/);
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) units.push({ kind: "space", value: p, width: measure(p, a.style), style: a.style });
      else units.push({ kind: "word", value: p, width: measure(p, a.style), style: a.style });
    }
  }

  const lines: Line[] = [];
  let runs: Run[] = [];
  let lineW = 0;
  let pendingSpace: { value: string; width: number; style?: RunStyle } | null = null;

  const flushLine = () => {
    lines.push({ runs: mergeAdjacentText(runs), width: lineW });
    runs = [];
    lineW = 0;
    pendingSpace = null;
  };

  const pushText = (value: string, width: number, style?: RunStyle) => {
    runs.push(style ? { kind: "text", value, width, style } : { kind: "text", value, width });
    lineW += width;
  };
  const pushIcon = (name: string, asset: AssetRef | undefined, width: number) => {
    runs.push({ kind: "icon", name, asset, width });
    lineW += width;
  };

  for (const u of units) {
    if (u.kind === "break") { flushLine(); continue; }
    if (u.kind === "space") {
      pendingSpace = { value: u.value, width: u.width, style: u.style };
      continue;
    }
    const itemW = u.width;
    const spaceW = pendingSpace?.width ?? 0;
    if (runs.length > 0 && lineW + spaceW + itemW > maxWidth) {
      flushLine();
      pendingSpace = null;
    }
    if (pendingSpace) {
      pushText(pendingSpace.value, pendingSpace.width, pendingSpace.style);
      pendingSpace = null;
    }
    if (u.kind === "word") pushText(u.value, itemW, u.style);
    else                   pushIcon(u.name, u.asset, itemW);
  }
  flushLine();
  if (lines.length === 0) lines.push({ runs: [], width: 0 });
  return lines;
}

function mergeAdjacentText(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (r.kind === "text" && prev && prev.kind === "text" && sameStyle(prev.style, r.style)) {
      prev.value += r.value;
      prev.width += r.width;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

export function ellipsizeLine(line: Line, maxWidth: number, fontSize: number, letterSpacing: number): Line {
  if (line.width <= maxWidth) return line;
  const runs = [...line.runs];
  const ellipsis = "…";
  const ellipsisW = approxTextWidth(ellipsis, fontSize, letterSpacing);

  let total = line.width;
  while (runs.length > 0 && total + ellipsisW > maxWidth) {
    const last = runs[runs.length - 1];
    if (last.kind === "icon") {
      total -= last.width;
      runs.pop();
      continue;
    }
    const text = last.value;
    if (text.length === 0) {
      runs.pop();
      continue;
    }
    const trimmed = text.slice(0, -1);
    const newW = approxTextWidth(trimmed, fontSize, letterSpacing);
    total = total - last.width + newW;
    last.value = trimmed;
    last.width = newW;
    if (trimmed.length === 0) runs.pop();
  }
  const last = runs[runs.length - 1];
  if (last && last.kind === "text") {
    last.value += ellipsis;
    last.width += ellipsisW;
    total += ellipsisW;
  } else {
    runs.push({ kind: "text", value: ellipsis, width: ellipsisW });
    total += ellipsisW;
  }
  return { runs, width: total };
}
