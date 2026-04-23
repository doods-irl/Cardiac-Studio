import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { findElement } from "@/model/selectors";

export function StatusBar() {
  const loaded = useDoc((s) => s.loaded);
  const dirty  = useDoc((s) => s.dirty);
  const tplId  = useEditor((s) => s.activeTemplateId);
  const recId  = useEditor((s) => s.activeRecordId);
  const selId  = useEditor((s) => s.selectedElementId);

  if (!loaded) return <footer className="status-bar" />;

  const tpl = loaded.project.templates.find((t) => t.id === tplId);
  const ds  = tpl && tpl.datasetId ? loaded.project.datasets.find((d) => d.id === tpl.datasetId) : undefined;
  const rows = ds ? loaded.records[ds.id] ?? [] : [];
  const activeRec = recId ? rows.find((r) => r.id === recId) : rows[0];
  const selEl = tpl && selId ? findElement(tpl.root, selId) : undefined;

  const canvasStr = tpl
    ? `${tpl.canvas.widthMm}×${tpl.canvas.heightMm}mm · ${tpl.canvas.dpi}dpi`
    : "—";

  return (
    <footer className="status-bar">
      <div className={"cell " + (dirty ? "warn" : "ok")}>
        <span className="k">{dirty ? "Unsaved" : "Saved"}</span>
        <span className="v">{dirty ? "pending" : "ok"}</span>
      </div>
      <div className="cell"><span className="k">Canvas</span><span className="v">{canvasStr}</span></div>
      <div className="cell"><span className="k">Template</span><span className="v">{tpl?.name ?? "—"}</span></div>
      <div className="cell"><span className="k">Dataset</span><span className="v">{ds?.name ?? "none"} · {rows.length} rows</span></div>
      <div className="cell">
        <span className="k">Active</span>
        <span className="v">{(activeRec as { name?: string } | undefined)?.name ?? "—"}</span>
      </div>
      <div className="spacer" />
      <div className="cell"><span className="k">Sel</span><span className="v">{selEl?.name ?? "—"}</span></div>
      <div className="cell"><span className="k">v0.1.0</span></div>
    </footer>
  );
}
