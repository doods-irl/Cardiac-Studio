import { useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { newProject, openProject } from "@/engine/format/load";
import { hasTauri } from "@/io/tauri";
import { defaultDataset } from "@/model/defaults";

export function Welcome() {
  const load = useDoc((s) => s.load);
  const [busy, setBusy] = useState(false);

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
      useEditor.setState({
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   ds ? p.records[ds.id]?.[0]?.id ?? null : null,
      });
    } catch (e) {
      console.error(e);
      alert(`Could not create project: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  const onOpen = async () => {
    if (!hasTauri()) { alert("Open requires the desktop build (Tauri)."); return; }
    setBusy(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, title: "Open Cardiac project folder" });
      if (!picked) return;
      const p = await openProject(picked as string);
      load(p);
      useEditor.setState({
        activeTemplateId: p.project.templates[0]?.id ?? null,
        activeRecordId:   null,
      });
    } catch (e) {
      console.error(e);
      alert(`Could not open project: ${e}`);
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
      </div>
    </div>
  );
}
