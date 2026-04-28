import { useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { newProject, openProject } from "@/engine/format/load";
import { hasTauri } from "@/io/tauri";
import { defaultDataset } from "@/model/defaults";
import { showAlert } from "./Dialog";
import { useRecents, formatRelativeTime, type RecentProject } from "@/store/recents";

export function Welcome() {
  const load = useDoc((s) => s.load);
  const [busy, setBusy] = useState(false);
  const recents = useRecents((s) => s.list);
  const addRecent    = useRecents((s) => s.add);
  const removeRecent = useRecents((s) => s.remove);
  const clearRecents = useRecents((s) => s.clear);

  const onNew = async () => {
    setBusy(true);
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
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   ds ? p.records[ds.id]?.[0]?.id ?? null : null,
      });
    } catch (e) {
      console.error(e);
      await showAlert({
        title: "Couldn't create project",
        message: String(e),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const onOpen = async () => {
    if (!hasTauri()) {
      await showAlert({
        title: "Desktop only",
        message: "Open requires the desktop build (Tauri).",
        tone: "warning",
      });
      return;
    }
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: "Open Cardiac project folder" });
      if (!picked) return;
      const p = await openProject(picked as string);
      load(p);
      addRecent({ path: p.path, name: p.project.meta.name || "" });
      useEditor.setState({
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   null,
      });
    } catch (e) {
      console.error(e);
      await showAlert({
        title: "Couldn't open project",
        message: String(e),
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const onOpenRecent = async (entry: RecentProject) => {
    if (!hasTauri()) {
      await showAlert({
        title: "Desktop only",
        message: "Opening from the recents list requires the desktop build.",
        tone: "warning",
      });
      return;
    }
    setBusy(true);
    try {
      const p = await openProject(entry.path);
      load(p);
      addRecent({ path: p.path, name: p.project.meta.name || entry.name });
      useEditor.setState({
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   null,
      });
    } catch (e) {
      console.error(e);
      // Project moved or deleted — drop it from the list and tell the user.
      removeRecent(entry.path);
      await showAlert({
        title: "Couldn't open project",
        message: `${entry.name} could not be opened. It may have been moved or deleted.\n\n${e}`,
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="welcome">
      <div className="card">
        <h1><span className="accent">Cardiac</span></h1>
        <p>
          Design a card once, generate a full deck from structured data.
          Local-only, no cloud. Your project lives in a <code>.cardiac</code> folder on disk.
        </p>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={onNew}>New project</button>
          <button disabled={busy} onClick={onOpen}>Open…</button>
        </div>

        <div className="recents">
          <div className="recents-head">
            <span className="recents-title">Recent projects</span>
            {recents.length > 0 && (
              <button className="recents-clear" onClick={clearRecents}>Clear</button>
            )}
          </div>
          {recents.length === 0 ? (
            <div className="recents-empty">No recent projects yet.</div>
          ) : (
            <div className="recents-list">
              {recents.map((r) => (
                <RecentRow key={r.path}
                  entry={r} disabled={busy}
                  onOpen={() => onOpenRecent(r)}
                  onRemove={() => removeRecent(r.path)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RecentRow({
  entry, disabled, onOpen, onRemove,
}: {
  entry: RecentProject;
  disabled: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <button
      className="recent-row"
      disabled={disabled}
      onClick={onOpen}
      title={entry.path}
    >
      <span className="recent-meta">
        <span className="recent-name">{entry.name}</span>
        <span className="recent-path">{entry.path}</span>
      </span>
      <span className="recent-when">{formatRelativeTime(entry.at)}</span>
      <span
        className="recent-remove"
        role="button"
        title="Remove from recents"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
      >×</span>
    </button>
  );
}
