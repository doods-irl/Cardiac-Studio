import { renderToStaticMarkup } from "react-dom/server";
import type {
  AssetRef, CanvasSpec, DataRecord, ElementGroup, NamedIcon, PaletteColor,
  Template, Variable,
} from "@/model/types";
import { renderTemplate } from "@/engine/render/svg";

export interface RenderToSvgContext {
  variables?: Variable[];
  icons?: NamedIcon[];
  palette?: PaletteColor[];
}

/**
 * Serialise a template + record to a self-contained SVG string.
 * Asset hrefs are rewritten to `file://` URLs so `resvg` can resolve
 * them from disk in the Rust exporter.
 */
export function renderTemplateToSvg(
  tpl: Template,
  record: DataRecord | undefined,
  assets: AssetRef[],
  projectPath: string,
  ctxExtras?: RenderToSvgContext,
): string {
  const canvas: CanvasSpec = tpl.canvas;
  const root: ElementGroup = tpl.root;
  const node = renderTemplate(canvas, root, {
    record,
    assets,
    variables: ctxExtras?.variables,
    icons:     ctxExtras?.icons,
    palette:   ctxExtras?.palette,
    assetUrl: (a) => fileUrl(projectPath, a.path),
  });
  return renderToStaticMarkup(node);
}

export function canvasPixelSize(canvas: CanvasSpec, includeBleed = false): { widthPx: number; heightPx: number } {
  const dpi = canvas.dpi;
  const mm = (n: number) => (n / 25.4) * dpi;
  const w = includeBleed ? canvas.widthMm + canvas.bleedMm * 2 : canvas.widthMm;
  const h = includeBleed ? canvas.heightMm + canvas.bleedMm * 2 : canvas.heightMm;
  return { widthPx: Math.round(mm(w)), heightPx: Math.round(mm(h)) };
}

function fileUrl(root: string, relPath: string): string {
  const normRoot = root.replace(/\\/g, "/");
  const normRel = relPath.replace(/\\/g, "/");
  const joined = normRoot.endsWith("/") ? normRoot + normRel : `${normRoot}/${normRel}`;
  // Windows: `file:///C:/...`; POSIX: `file:///...`
  const leading = joined.startsWith("/") ? "" : "/";
  return `file://${leading}${joined}`;
}

export function safeFilename(name: string, index: number): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "card";
  const idx = String(index + 1).padStart(2, "0");
  return `${idx}-${base}.png`;
}
