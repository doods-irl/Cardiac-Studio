import type { LoadedProject, Project } from "@/model/types";
import { invoke, hasTauri } from "@/io/tauri";
import { seedStarter, defaultDataset } from "@/model/defaults";

/** Open an existing project folder from disk. */
export async function openProject(path: string): Promise<LoadedProject> {
  if (!hasTauri()) throw new Error("openProject requires the desktop shell");
  const raw = (await invoke.openProject(path)) as LoadedProject;
  // Self-repair for projects that were created under earlier code that
  // didn't persist the seeded starter template — the disk has an empty
  // `templates` array, which would otherwise render a blank editor with
  // no way in. The UI forbids deleting the last template, so an empty
  // project on disk is definitionally an un-seeded new project and safe
  // to re-seed.
  const needsSeed = (raw.project.templates?.length ?? 0) === 0
                 && (raw.project.datasets?.length ?? 0) === 0;
  if (!needsSeed) return raw;
  const seeded: Project = seedStarter(raw.project);
  const tplDatasetId = seeded.templates[0]?.datasetId ?? null;
  const seededRecords = tplDatasetId
    ? { [tplDatasetId]: defaultDataset().records }
    : {};
  const repaired: LoadedProject = { ...raw, project: seeded, records: seededRecords };
  try {
    const savedManifest = (await invoke.saveProject({
      path: repaired.path,
      manifest: repaired.manifest,
      project: repaired.project,
      records: repaired.records,
    })) as LoadedProject["manifest"];
    return { ...repaired, manifest: savedManifest };
  } catch (e) {
    console.warn("[openProject] failed to persist self-repaired project", e);
    return repaired;
  }
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
  // Seed the first dataset with its default records too, so a fresh
  // project isn't missing card content the moment it opens.
  const seededRecords = tplDatasetId
    ? { [tplDatasetId]: defaultDataset().records }
    : {};
  const loaded: LoadedProject = { ...raw, project: seeded, records: seededRecords };

  // Immediately persist the seeded state to disk. Without this, the
  // freshly-written project.json from Rust still carries empty
  // templates/datasets — a user who creates a project and closes
  // without editing would reopen to a blank view because what the
  // Rust side reads back wasn't the seeded shape.
  try {
    const savedManifest = (await invoke.saveProject({
      path: loaded.path,
      manifest: loaded.manifest,
      project: loaded.project,
      records: loaded.records,
    })) as LoadedProject["manifest"];
    return { ...loaded, manifest: savedManifest };
  } catch (e) {
    // Don't fail the whole create flow if the save fails — the user
    // still gets the seeded in-memory editor and can save manually.
    console.warn("[newProject] failed to persist seeded project", e);
    return loaded;
  }
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
