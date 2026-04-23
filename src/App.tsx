import { useEffect } from "react";
import { AppShell } from "@/components/Shell/AppShell";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { newProject } from "@/engine/format/load";
import { autosaveProject } from "@/engine/format/save";
import { registerProjectFonts } from "@/engine/format/assets";
import { defaultDataset } from "@/model/defaults";
import { listFamilies } from "@/model/fonts";
import type { Element, ElementGroup, TextElement, StatElement } from "@/model/types";

export default function App() {
  const loaded = useDoc((s) => s.loaded);
  const dirty  = useDoc((s) => s.dirty);
  const load   = useDoc((s) => s.load);
  const setEditor = useEditor.setState;

  // Boot: in a fresh dev session, open with a seeded in-memory project
  // so the editor is immediately usable. Production builds show the
  // Welcome screen (see AppShell). We gate on Vite's DEV flag rather
  // than hasTauri() because Tauri 2 dev ALSO needs the auto-seed —
  // the previous `!hasTauri()` check was only working accidentally
  // because Tauri 2 stopped exposing the `__TAURI__` global by
  // default, making hasTauri() return false inside the desktop shell.
  useEffect(() => {
    if (loaded || !import.meta.env.DEV) return;
    (async () => {
      const p = await newProject("/in-memory/Untitled.cardiac", "Untitled");
      // Also seed default records so the grid has something to show.
      const ds = p.project.datasets[0];
      if (ds) {
        const { records } = defaultDataset();
        p.records[ds.id] = records;
      }
      load(p);
      setEditor({
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId: ds ? p.records[ds.id]?.[0]?.id ?? null : null,
      });
    })();
  }, [loaded, load, setEditor]);

  // Autosave every 30s while dirty.
  useEffect(() => {
    if (!loaded) return;
    const iv = setInterval(() => {
      if (!useDoc.getState().dirty) return;
      const cur = useDoc.getState().loaded;
      if (!cur) return;
      autosaveProject(cur).catch((e) => console.warn("[autosave]", e));
    }, 30_000);
    return () => clearInterval(iv);
  }, [loaded]);

  // Tab title reflects dirty state.
  useEffect(() => {
    const base = loaded ? `Cardiac — ${loaded.project.meta.name}` : "Cardiac";
    document.title = dirty ? `${base} •` : base;
  }, [loaded, dirty]);

  // Register every font in the project with `document.fonts` so the
  // picker can select them and the SVG renderer can actually display
  // them. Runs on initial load and whenever the font list changes —
  // keyed on the assetId signature so adding/removing a font forces
  // re-registration but regular edits (e.g. selecting a family) don't.
  const fontSig = loaded
    ? loaded.project.fonts.map((f) => `${f.assetId}:${f.family}:${f.weight}:${f.italic ? 1 : 0}`).join("|")
    : "";
  useEffect(() => {
    if (!loaded) return;
    registerProjectFonts(loaded.path, loaded.project.assets, loaded.project.fonts)
      .catch((e) => console.warn("[fonts] project font registration failed", e));
  }, [loaded?.path, fontSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the font list changes (first import especially), remap any
  // text or stat element whose stored `family` isn't in the current
  // picker to the first available family. Without this, newly-imported
  // fonts don't apply to existing text elements until each one is
  // individually selected in the right panel (which runs the same
  // repair in a useEffect there).
  useEffect(() => {
    if (!loaded) return;
    const families = listFamilies(loaded.project.fonts.map((f) => f.family));
    if (families.length === 0) return;
    const target = families[0];
    const needsRepair = (el: Element): boolean => {
      if ((el.type === "text" || el.type === "stat")) {
        const fam = (el as TextElement | StatElement).style?.family;
        if (fam && !families.includes(fam)) return true;
      }
      if (el.type === "group") return el.children.some(needsRepair);
      return false;
    };
    const any = loaded.project.templates.some((t) => needsRepair(t.root));
    if (!any) return;

    useDoc.getState().mutate((p) => {
      const mapEl = (el: Element): Element => {
        if (el.type === "text") {
          const t = el as TextElement;
          if (t.style?.family && !families.includes(t.style.family)) {
            return { ...t, style: { ...t.style, family: target } };
          }
          return t;
        }
        if (el.type === "stat") {
          const s = el as StatElement;
          if (s.style?.family && !families.includes(s.style.family)) {
            return { ...s, style: { ...s.style, family: target } };
          }
          return s;
        }
        if (el.type === "group") {
          return { ...el, children: el.children.map(mapEl) };
        }
        return el;
      };
      return {
        ...p,
        project: {
          ...p.project,
          templates: p.project.templates.map((t) => ({
            ...t, root: mapEl(t.root) as ElementGroup,
          })),
        },
      };
    });
  }, [fontSig]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AppShell />;
}
