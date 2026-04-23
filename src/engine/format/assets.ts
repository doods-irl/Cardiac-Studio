/**
 * Cross-platform asset import helpers. In a Tauri shell they dispatch to
 * the Rust `import_image` / `import_font` commands, which content-address
 * the file into `assets/images` or `assets/fonts` inside the project
 * folder. In browser dev mode they fall back to reading the file into a
 * data URL so the editor stays live without a real filesystem.
 */

import { newId } from "@/model/ids";
import type { AssetRef, FontRef } from "@/model/types";
import { hasTauri, invoke, assetFileUrl } from "@/io/tauri";

/**
 * Register a font so `font-family: <family>` in CSS / SVG resolves to
 * its file. Safe to call on any platform — silently no-ops if the
 * FontFace API isn't available. Deduplicates against `document.fonts`
 * so re-registering the same family+weight after a reload doesn't
 * stack duplicate font faces.
 *
 * Logs success at info level so a quick glance at the console confirms
 * registration is happening; logs the failing URL on error so CSP /
 * 404 / protocol issues are easy to spot.
 */
export async function registerFontFace(
  family: string, weight: number, italic: boolean, fileUrl: string,
): Promise<void> {
  if (!fileUrl) {
    console.warn("[fonts] skip register — empty URL", { family, weight });
    return;
  }
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const fs = document.fonts as FontFaceSet & {
    add(f: FontFace): void; forEach(cb: (f: FontFace) => void): void;
  };
  // Skip if already registered — iterate because FontFaceSet has no
  // direct "get by family+weight" lookup.
  let existing = false;
  fs.forEach((f) => {
    if (f.family === family && f.weight === String(weight)
        && f.style === (italic ? "italic" : "normal")) {
      existing = true;
    }
  });
  if (existing) return;
  try {
    const face = new FontFace(family, `url("${fileUrl}")`, {
      weight: String(weight),
      style: italic ? "italic" : "normal",
    });
    await face.load();
    fs.add(face);
    console.info(`[fonts] registered ${family} ${weight}${italic ? " italic" : ""}`);
  } catch (e) {
    // Most common cause is CSP blocking `font-src`: the browser
    // refused to fetch `fileUrl`. Second-most is the file not
    // existing at that URL (asset protocol scope / path mismatch).
    console.error(`[fonts] FAILED to register ${family} from ${fileUrl}`, e);
  }
}

/**
 * Register every font in a loaded project so the design surface and
 * SVG renderer can actually use them. Called once after project load
 * and again whenever fonts change (imports / removals).
 */
export async function registerProjectFonts(
  projectPath: string,
  assets: AssetRef[],
  fonts: FontRef[],
): Promise<void> {
  // Skip "bundled" placeholders (legacy starter fonts with no file) —
  // nothing to register, the family name resolves via system fallback.
  const live = fonts.filter((f) => f.assetId);
  await Promise.all(live.map(async (f) => {
    const asset = assets.find((a) => a.id === f.assetId && a.kind === "font");
    if (!asset) return;
    const url = asset.path.startsWith("data:")
      ? asset.path
      : assetFileUrl(`${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${asset.path}`);
    await registerFontFace(f.family, f.weight, f.italic, url);
  }));
}

const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.svg,image/*";
const FONT_ACCEPT  = ".ttf,.otf,.woff,.woff2,font/*";
const IMAGE_EXTS   = ["png", "jpg", "jpeg", "webp", "gif", "svg"];
const FONT_EXTS    = ["ttf", "otf", "woff", "woff2"];

/** Open a file picker, return a chosen local path (Tauri) or File (browser). */
async function pickFile(opts: {
  title: string;
  filters: { name: string; extensions: string[] }[];
  accept: string;
  /** When true, force the browser file input path even inside Tauri.
   *  Used when the target "project" is the in-memory dev sentinel,
   *  which has no real folder Rust could copy the file into. */
  forceBrowser?: boolean;
})
  : Promise<{ tauriPath: string } | { browserFile: File } | null>
{
  if (hasTauri() && !opts.forceBrowser) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      title: opts.title,
      filters: opts.filters,
    });
    if (!picked) return null;
    return { tauriPath: picked as string };
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = opts.accept;
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? { browserFile: f } : null);
    };
    input.click();
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function imageDimsFromDataUrl(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Multi-import variant of `importImage`. Returns one AssetRef per file
 * the user picked, in picker order. Works in Tauri (native multi-select
 * dialog) and browser (multi-file <input type=file>).
 */
export async function importImages(projectPath: string): Promise<AssetRef[]> {
  // Tauri import copies files into the project folder via Rust — but
  // in-memory dev projects have no real folder, so fall through to the
  // browser path (data-URL) for those. Keeps `tauri:dev` working with
  // the seeded scratch project.
  if (hasTauri() && !isInMemoryProject(projectPath)) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "Import images",
      filters: [{ name: "Images", extensions: IMAGE_EXTS }],
    });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    const out: AssetRef[] = [];
    for (const path of paths) {
      const res = await invoke.importImage(projectPath, path as string) as {
        id: string; path: string; originalName: string; hash: string;
        width?: number; height?: number;
      };
      out.push({
        id: res.id, kind: "image", path: res.path,
        originalName: res.originalName, hash: res.hash,
        width: res.width, height: res.height,
      });
    }
    return out;
  }
  // Browser fallback: reads each file as a data URL. One-at-a-time in
  // serial so we don't keep huge arrays of in-flight readers.
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_ACCEPT;
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      const out: AssetRef[] = [];
      for (const f of files) {
        const dataUrl = await readAsDataUrl(f);
        const dims = await imageDimsFromDataUrl(dataUrl);
        out.push({
          id: newId(), kind: "image", path: dataUrl,
          originalName: f.name, hash: `inmem-${f.size}-${f.lastModified}`,
          width: dims?.w, height: dims?.h,
        });
      }
      resolve(out);
    };
    input.click();
  });
}

/**
 * The `/in-memory/` sentinel means "dev-mode scratch project that has
 * no real folder on disk". Any code path that would otherwise route
 * file I/O through the Rust side (which needs a real folder) should
 * fall back to browser-style data-URL handling for these projects.
 */
function isInMemoryProject(projectPath: string): boolean {
  return projectPath.startsWith("/in-memory/");
}

export async function importFonts(projectPath: string): Promise<Array<{ asset: AssetRef; font: FontRef }>> {
  // In-memory dev projects have no real folder — use the browser
  // path so the font is stored as a `data:` URL on the AssetRef and
  // registered via the same URL. Works identically inside the Tauri
  // shell (the native dialog is skipped; a browser file input picks
  // the file instead, which is fine for dev).
  if (hasTauri() && !isInMemoryProject(projectPath)) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: true,
      title: "Import fonts",
      filters: [{ name: "Fonts", extensions: FONT_EXTS }],
    });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    const out: Array<{ asset: AssetRef; font: FontRef }> = [];
    for (const path of paths) {
      const family = (path as string).split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "Font";
      const res = await invoke.importFont(projectPath, path as string, family, 400) as {
        id: string; path: string; originalName: string; hash: string;
        family?: string; weight?: number;
      };
      const asset: AssetRef = {
        id: res.id, kind: "font", path: res.path,
        originalName: res.originalName, hash: res.hash,
        family: res.family ?? family, weight: res.weight ?? 400,
      };
      const font: FontRef = {
        id: newId(), family: asset.family!, assetId: asset.id,
        weight: asset.weight ?? 400, italic: false, bundled: false,
      };
      // Register immediately so the family is usable in the picker
      // and preview without waiting for a reload.
      const url = assetFileUrl(
        `${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${asset.path}`,
      );
      await registerFontFace(font.family, font.weight, font.italic, url);
      out.push({ asset, font });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = FONT_ACCEPT;
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files ? Array.from(input.files) : [];
      const out: Array<{ asset: AssetRef; font: FontRef }> = [];
      for (const f of files) {
        const dataUrl = await readAsDataUrl(f);
        const family = f.name.replace(/\.[^.]+$/, "");
        const asset: AssetRef = {
          id: newId(), kind: "font", path: dataUrl,
          originalName: f.name, hash: `inmem-${f.size}`,
          family, weight: 400,
        };
        const font: FontRef = {
          id: newId(), family, assetId: asset.id,
          weight: 400, italic: false, bundled: false,
        };
        await registerFontFace(family, 400, false, dataUrl);
        out.push({ asset, font });
      }
      resolve(out);
    };
    input.click();
  });
}

export async function importImage(projectPath: string): Promise<AssetRef | null> {
  const picked = await pickFile({
    title: "Import image",
    accept: IMAGE_ACCEPT,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
    forceBrowser: isInMemoryProject(projectPath),
  });
  if (!picked) return null;

  if ("tauriPath" in picked) {
    const res = await invoke.importImage(projectPath, picked.tauriPath) as {
      id: string; path: string; originalName: string; hash: string;
      width?: number; height?: number;
    };
    return {
      id: res.id, kind: "image", path: res.path,
      originalName: res.originalName, hash: res.hash,
      width: res.width, height: res.height,
    };
  }

  const dataUrl = await readAsDataUrl(picked.browserFile);
  const dims = await imageDimsFromDataUrl(dataUrl);
  return {
    id: newId(),
    kind: "image",
    path: dataUrl,
    originalName: picked.browserFile.name,
    hash: `inmem-${picked.browserFile.size}`,
    width: dims?.w, height: dims?.h,
  };
}

export async function importFont(
  projectPath: string,
  family: string,
  weight: number,
): Promise<{ asset: AssetRef; font: FontRef } | null> {
  const picked = await pickFile({
    title: "Import font",
    accept: FONT_ACCEPT,
    filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
    forceBrowser: isInMemoryProject(projectPath),
  });
  if (!picked) return null;

  let asset: AssetRef;
  let registerUrl: string;
  if ("tauriPath" in picked) {
    const res = await invoke.importFont(projectPath, picked.tauriPath, family, weight) as {
      id: string; path: string; originalName: string; hash: string;
      family?: string; weight?: number;
    };
    asset = {
      id: res.id, kind: "font", path: res.path,
      originalName: res.originalName, hash: res.hash,
      family: res.family ?? family, weight: res.weight ?? weight,
    };
    registerUrl = assetFileUrl(
      `${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${asset.path}`,
    );
  } else {
    const dataUrl = await readAsDataUrl(picked.browserFile);
    asset = {
      id: newId(), kind: "font", path: dataUrl,
      originalName: picked.browserFile.name,
      hash: `inmem-${picked.browserFile.size}`,
      family, weight,
    };
    registerUrl = dataUrl;
  }

  // Register with the browser so Design preview + SVG export can
  // resolve the family to this file. Same code path for Tauri and
  // browser — different URL scheme (asset.localhost vs data:).
  await registerFontFace(family, weight, false, registerUrl);

  const font: FontRef = {
    id: newId(), family, assetId: asset.id,
    weight, italic: false, bundled: false,
  };
  return { asset, font };
}
