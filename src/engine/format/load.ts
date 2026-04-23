import type { LoadedProject, Project } from "@/model/types";
import { invoke, hasTauri } from "@/io/tauri";
import { seedStarter, defaultDataset } from "@/model/defaults";

/** Open an existing project folder from disk. */
export async function openProject(path: string): Promise<LoadedProject> {
  if (!hasTauri()) throw new Error("openProject requires the desktop shell");
  const raw = (await invoke.openProject(path)) as LoadedProject;
  return raw;
}

/** Create a new project folder and seed it with a starter template + dataset. */
export async function newProject(path: string, name: string): Promise<LoadedProject> {
  // The `/in-memory/` prefix is a sentinel the boot seed uses to ask
  // for a scratch project that never hits disk — dev-mode quickstart,
  // unit tests, and the non-Tauri browser runtime all go through it.
  // Always fabricate for this path (bypass Rust) so the boot flow can
  // work inside a Tauri dev shell without the Rust side rejecting the
  // pseudo-path.
  const isInMemory = path.startsWith("/in-memory/");
  if (isInMemory || !hasTauri()) {
    return fabricateInMemoryProject(path, name);
  }
  const raw = (await invoke.newProject(path, name)) as LoadedProject;
  const seeded: Project = seedStarter(raw.project);
  const tplDatasetId = seeded.templates[0]?.datasetId ?? null;
  const records = tplDatasetId ? { [tplDatasetId]: [] } : {};
  return { ...raw, project: seeded, records };
}

function fabricateInMemoryProject(path: string, name: string): LoadedProject {
  const now = new Date().toISOString();
  const base: Project = {
    meta: { name, description: "", author: "" },
    canvasDefaults: {
      widthMm: 63.5, heightMm: 88.9, dpi: 300,
      bleedMm: 3, marginMm: 3, safeAreaMm: 5,
    },
    templates: [], styles: [], palette: [], datasets: [],
    fonts: [], assets: [], variables: [],
    icons: [], iconCategories: [],
    imageGallery: [], imageCategories: [],
    exportProfiles: [],
  };
  const seeded = seedStarter(base);
  const dsid = seeded.templates[0]?.datasetId ?? null;
  const { records } = defaultDataset();
  return {
    path,
    manifest: {
      format: "cardiac",
      schemaVersion: 1,
      appVersion: "0.1.0-browser",
      projectId: "browser-" + Math.random().toString(36).slice(2),
      created: now, modified: now, name,
    },
    project: seeded,
    records: dsid ? { [dsid]: records } : {},
  };
}
