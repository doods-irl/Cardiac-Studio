import type { LoadedProject } from "@/model/types";
import { invoke, hasTauri } from "@/io/tauri";

export async function saveProject(p: LoadedProject): Promise<LoadedProject> {
  if (!hasTauri()) {
    console.warn("[save] Tauri not available; skipping disk write.");
    return p;
  }
  const req = {
    path: p.path,
    manifest: p.manifest,
    project: p.project,
    records: p.records,
  };
  const m = await invoke.saveProject(req) as LoadedProject["manifest"];
  return { ...p, manifest: m };
}

export async function autosaveProject(p: LoadedProject): Promise<LoadedProject> {
  if (!hasTauri()) return p;
  const req = { path: p.path, manifest: p.manifest, project: p.project, records: p.records };
  const m = await invoke.autosaveProject(req) as LoadedProject["manifest"];
  return { ...p, manifest: m };
}
