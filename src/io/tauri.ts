/**
 * Thin wrappers over Tauri invoke() so the UI can stay call-site clean and
 * the Tauri API can be stubbed in a non-Tauri (browser) dev mode.
 *
 * We use the npm-package `@tauri-apps/api/core` invoke rather than the
 * legacy `__TAURI__` global. Tauri 2 stopped exposing that global by
 * default — it's only present when `app.withGlobalTauri: true` is set
 * in `tauri.conf.json`. `__TAURI_INTERNALS__` is the new always-on
 * global, but the JS API package reads it itself, so we just call the
 * package's `invoke` and trust it to find the right bridge.
 */

import { invoke as tauriInvoke, convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getInvoke(): InvokeFn {
  if (hasTauri()) return tauriInvoke as InvokeFn;
  // Non-Tauri runtime (browser, unit tests). Stub throws so callers
  // can detect it — `hasTauri()` gates are the sanctioned way to
  // branch around Tauri-only paths.
  return (async (cmd: string) => {
    throw new Error(`Tauri not available — command "${cmd}" unavailable outside the desktop shell`);
  }) as InvokeFn;
}

export const invoke = {
  appVersion: () => getInvoke()<string>("app_version"),
  newProject: (path: string, name: string) =>
    getInvoke()<unknown>("new_project", { args: { path, name } }),
  openProject: (path: string) =>
    getInvoke()<unknown>("open_project", { path }),
  saveProject: (req: unknown) =>
    getInvoke()<unknown>("save_project", { req }),
  autosaveProject: (req: unknown) =>
    getInvoke()<unknown>("autosave_project", { req }),
  listBackups: (path: string) =>
    getInvoke()<unknown>("list_backups", { path }),
  restoreBackup: (projectPath: string, backupPath: string) =>
    getInvoke()<void>("restore_backup", { projectPath_: projectPath, backupPath }),
  importImage: (projectPath: string, sourcePath: string) =>
    getInvoke()<unknown>("import_image", { args: { projectPath, sourcePath } }),
  importFont: (projectPath: string, sourcePath: string, family: string, weight?: number) =>
    getInvoke()<unknown>("import_font", { args: { projectPath, sourcePath, family, weight } }),
  listAssets: (projectPath: string) =>
    getInvoke()<unknown>("list_assets", { projectPath }),
  exportCardPng: (args: {
    projectPath: string; outPath: string; svg: string; widthPx: number; heightPx: number;
  }) => getInvoke()<string>("export_card_png", { args }),
  exportDeckPngs: (args: {
    projectPath: string; outDir: string;
    items: { filename: string; svg: string }[];
    widthPx: number; heightPx: number;
  }) => getInvoke()<string[]>("export_deck_pngs", { args }),
};

/**
 * Cross-platform confirmation dialog. Returns `true` if the user
 * confirmed, `false` if they declined or the dialog failed.
 *
 * Tauri 2 hijacks the browser `window.confirm` to route through its
 * dialog plugin, which makes it async (returns a Promise<boolean>) —
 * so code that does `if (!window.confirm(...))` evaluates a Promise
 * as truthy and misbehaves. This helper awaits the Tauri plugin
 * explicitly via a dynamic import and falls back to the synchronous
 * browser `window.confirm` when Tauri isn't present.
 */
export async function confirmDialog(
  message: string,
  opts?: { title?: string; okLabel?: string; cancelLabel?: string; kind?: "warning" | "info" },
): Promise<boolean> {
  if (hasTauri()) {
    try {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      return await ask(message, {
        title:        opts?.title        ?? "Cardiac",
        okLabel:      opts?.okLabel      ?? "OK",
        cancelLabel:  opts?.cancelLabel  ?? "Cancel",
        kind:         opts?.kind         ?? "warning",
      });
    } catch (e) {
      console.warn("[confirm] Tauri dialog failed, falling back to window.confirm", e);
    }
  }
  // Browser fallback — synchronous, returns boolean directly.
  return typeof window !== "undefined" ? window.confirm(message) : false;
}

/**
 * Build a URL the webview can fetch for a file inside the project
 * folder. In Tauri this produces an `asset.localhost` URL backed by
 * the asset-protocol scope; in the browser we can't resolve the path
 * (no filesystem access) so we return "" — callers should check.
 *
 * Inputs MUST be absolute project-path + relative asset path joined —
 * e.g. `C:/Users/foo/decks/my.cardiac/assets/img/card.png` or the
 * POSIX equivalent. Slashes are normalised to forward here.
 */
export function assetFileUrl(absoluteFilePath: string): string {
  if (!hasTauri()) return "";
  const normalised = absoluteFilePath.replace(/\\/g, "/");
  return tauriConvertFileSrc(normalised);
}

export function hasTauri(): boolean {
  // Tauri 2 exposes `__TAURI_INTERNALS__` by default. The old
  // `__TAURI__` global is only injected when `app.withGlobalTauri` is
  // true in `tauri.conf.json` — don't rely on it. Check both so the
  // function keeps working across Tauri v1, v2 (default), and v2
  // (withGlobalTauri: true) projects.
  const g = globalThis as unknown as {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };
  return !!g.__TAURI__ || !!g.__TAURI_INTERNALS__;
}
