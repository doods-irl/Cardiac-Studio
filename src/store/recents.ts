import { create } from "zustand";

/**
 * Recently-opened projects, persisted in localStorage on the user's
 * machine. The list is per-machine (a paths-on-disk pointer is useless
 * elsewhere), so localStorage — bound to the Tauri webview's profile —
 * is the right home. We don't use the Tauri store plugin because that
 * would require a Rust-side capability and a build step for what's
 * essentially a UI-only convenience list.
 *
 * In-memory paths (the `/in-memory/...` sentinel used by the dev seed
 * and the browser fallback) are excluded from tracking — they don't
 * round-trip through disk so a recent entry pointing at one would
 * never reopen successfully.
 */

export interface RecentProject {
  /** Absolute disk path to the `.cardiac` folder. */
  path: string;
  /** Display name (project meta name, falls back to folder basename). */
  name: string;
  /** Last-touched timestamp in ms since epoch. */
  at: number;
}

const STORAGE_KEY = "cardiac.recentProjects.v1";
const MAX_ENTRIES = 10;

interface RecentsState {
  list: RecentProject[];
  add: (entry: { path: string; name: string }) => void;
  remove: (path: string) => void;
  clear: () => void;
}

function isInMemoryPath(p: string): boolean {
  return p.startsWith("/in-memory/");
}

function readStorage(): RecentProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is RecentProject =>
        e && typeof e.path === "string" && typeof e.name === "string" && typeof e.at === "number")
      .filter((e) => !isInMemoryPath(e.path))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeStorage(list: RecentProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    // Quota or disabled storage — log and move on; not worth interrupting work.
    console.warn("[recents] failed to persist", e);
  }
}

export const useRecents = create<RecentsState>((set, get) => ({
  list: readStorage(),
  add: ({ path, name }) => {
    if (!path || isInMemoryPath(path)) return;
    const trimmedName = name.trim() || path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
    const entry: RecentProject = { path, name: trimmedName, at: Date.now() };
    const prev = get().list.filter((e) => e.path !== path);
    const next = [entry, ...prev].slice(0, MAX_ENTRIES);
    writeStorage(next);
    set({ list: next });
  },
  remove: (path) => {
    const next = get().list.filter((e) => e.path !== path);
    writeStorage(next);
    set({ list: next });
  },
  clear: () => {
    writeStorage([]);
    set({ list: [] });
  },
}));

/** Format a timestamp as a short relative phrase ("2h ago", "Yesterday", "12 Mar"). */
export function formatRelativeTime(at: number, now = Date.now()): string {
  const diffMs = now - at;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  const d = new Date(at);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}
