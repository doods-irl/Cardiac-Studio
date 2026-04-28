import { useEffect, useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { saveProject } from "@/engine/format/save";
import { newProject, openProject } from "@/engine/format/load";
import { hasTauri } from "@/io/tauri";
import { defaultDataset } from "@/model/defaults";
import { confirmAction, showAlert } from "./Dialog";
import { useRecents } from "@/store/recents";

export function TitleBar() {
  const loaded = useDoc((s) => s.loaded);
  const dirty  = useDoc((s) => s.dirty);
  const past   = useDoc((s) => s.past.length);
  const future = useDoc((s) => s.future.length);
  const undo   = useDoc((s) => s.undo);
  const redo   = useDoc((s) => s.redo);
  const load   = useDoc((s) => s.load);
  const lastSavedAt = useDoc((s) => s.lastSavedAt);

  // Flash a "Saved" chip for ~1.2s after every successful save, no
  // matter how the save was triggered (Save button, Ctrl+S, autosave,
  // external callsite). We key off `lastSavedAt` rather than wiring a
  // callback so the chip survives a React remount mid-save.
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    if (!lastSavedAt) return;
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), 1200);
    return () => clearTimeout(t);
  }, [lastSavedAt]);

  // Track window maximised state so we can swap the middle button's
  // glyph between "maximise" and "restore". Tauri fires a "Resized"
  // event on maximise/unmaximise so we listen for that rather than
  // polling.
  const [isMax, setIsMax] = useState(false);
  useEffect(() => {
    if (!hasTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const w = getCurrentWindow();
        setIsMax(await w.isMaximized());
        unlisten = await w.onResized(async () => {
          setIsMax(await w.isMaximized());
        });
      } catch (e) {
        console.warn("[titlebar] window listener failed", e);
      }
    })();
    return () => { unlisten?.(); };
  }, []);

  const win = async (op: "minimize" | "toggleMaximize" | "close") => {
    if (!hasTauri()) {
      // Non-desktop runtime — window ops are a no-op here, but log
      // loudly so we don't ship a silently-broken button.
      console.warn("[titlebar] window op ignored — Tauri not detected");
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const w = getCurrentWindow();
      if (op === "minimize")        await w.minimize();
      else if (op === "close")      await w.close();
      else                          await w.toggleMaximize();
    } catch (e) {
      // Surface the actual Tauri error to the console — the most
      // common cause is a missing `core:window:allow-*` permission
      // in `src-tauri/capabilities/default.json`, which requires a
      // cargo rebuild to take effect.
      console.error(`[titlebar] window op "${op}" failed`, e);
    }
  };

  const addRecent = useRecents((s) => s.add);

  const onSave = async () => {
    if (!loaded) return;
    try {
      const saved = await saveProject(loaded);
      useDoc.getState().markSaved(saved.manifest);
      addRecent({ path: loaded.path, name: loaded.project.meta.name || "" });
    } catch (e) {
      console.error("[save]", e);
      await showAlert({ title: "Save failed", message: String(e), tone: "error" });
    }
  };

  const confirmDiscard = async (): Promise<boolean> => {
    if (!dirty) return true;
    return await confirmAction({
      title: "Unsaved changes",
      message: "You have unsaved changes. Discard them and continue?",
      okLabel: "Discard",
      cancelLabel: "Cancel",
      danger: true,
    });
  };

  const onNew = async () => {
    if (!(await confirmDiscard())) return;
    try {
      let path = "/in-memory/Untitled.cardiac";
      let name = "Untitled";
      if (hasTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const picked = await save({
          title: "New Cardiac project",
          defaultPath: "MyDeck.cardiac",
          filters: [{ name: "Cardiac project", extensions: ["cardiac"] }],
        });
        if (!picked) return;
        path = picked as string;
        const parts = path.replace(/\\/g, "/").split("/");
        name = parts[parts.length - 1].replace(/\.cardiac$/, "");
      }
      const p = await newProject(path, name);
      const ds = p.project.datasets[0];
      if (ds && (!p.records[ds.id] || p.records[ds.id].length === 0)) {
        const { records } = defaultDataset();
        p.records[ds.id] = records;
      }
      load(p);
      addRecent({ path: p.path, name: p.project.meta.name || name });
      useEditor.setState({
        tab: "design",
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   ds ? p.records[ds.id]?.[0]?.id ?? null : null,
        selectedElementId: null,
        selectedVariableId: null,
      });
    } catch (e) {
      console.error(e);
      await showAlert({ title: "Couldn't create project", message: String(e), tone: "error" });
    }
  };

  const onOpen = async () => {
    if (!hasTauri()) {
      await showAlert({ title: "Desktop only", message: "Open requires the desktop build.", tone: "warning" });
      return;
    }
    if (!(await confirmDiscard())) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: "Open Cardiac project folder" });
      if (!picked) return;
      const p = await openProject(picked as string);
      load(p);
      addRecent({ path: p.path, name: p.project.meta.name || "" });
      useEditor.setState({
        tab: "design",
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   null,
        selectedElementId: null,
        selectedVariableId: null,
      });
    } catch (e) {
      console.error(e);
      await showAlert({ title: "Couldn't open project", message: String(e), tone: "error" });
    }
  };

  // `data-tauri-drag-region` makes the tagged element initiate a window
  // drag when the user presses on it. We tag the brand + project block
  // (and their text children) so you can grab the app from the left
  // two-thirds of the title bar. Action buttons and window controls
  // carry `data-tauri-drag-region="false"` so clicks still register.

  return (
    <header className="title-bar">
      <div className="brand" data-tauri-drag-region>
        <img className="mark" src="/logo.png" alt="Cardiac logo"
          draggable={false} data-tauri-drag-region />
        <div className="word" data-tauri-drag-region>Cardiac</div>
      </div>
      <div className="project" data-tauri-drag-region>
        {loaded ? (
          <>
            <span className="name" data-tauri-drag-region>{loaded.project.meta.name || "Untitled"}</span>
            {dirty && <span className="unsaved" title="Unsaved changes" data-tauri-drag-region>●</span>}
            {savedFlash && !dirty && (
              <span className="saved-chip" title="Project saved" data-tauri-drag-region>
                ✓ Saved
              </span>
            )}
            <span className="path" data-tauri-drag-region>{loaded.path}</span>
          </>
        ) : null}
      </div>
      <div className="actions">
        <button onClick={onNew}  title="Start a new blank project">New</button>
        <button onClick={onOpen} title="Open a different project">Open</button>
        <button onClick={undo} disabled={past === 0} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={redo} disabled={future === 0} title="Redo (Ctrl+Shift+Z)">Redo</button>
        <button onClick={onSave} disabled={!loaded || !dirty} title="Save (Ctrl+S)">Save</button>
      </div>
      <div className="win-ctrls" aria-label="Window controls">
        <button className="win-ctrl" title="Minimise" aria-label="Minimise"
          onClick={() => win("minimize")}>
          {/* ── underscore-ish bar */}
          <svg viewBox="0 0 10 10" width="10" height="10"><path d="M1 8 H9" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
        </button>
        <button className="win-ctrl" title={isMax ? "Restore" : "Maximise"} aria-label={isMax ? "Restore" : "Maximise"}
          onClick={() => win("toggleMaximize")}>
          {isMax ? (
            <svg viewBox="0 0 10 10" width="10" height="10">
              {/* two stacked squares for restore */}
              <path d="M3 1 H9 V7" stroke="currentColor" strokeWidth="1.2" fill="none" />
              <rect x="1" y="3" width="6" height="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" width="10" height="10">
              <rect x="1" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          )}
        </button>
        <button className="win-ctrl close" title="Close" aria-label="Close"
          onClick={() => win("close")}>
          <svg viewBox="0 0 10 10" width="10" height="10">
            <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </button>
      </div>
    </header>
  );
}
