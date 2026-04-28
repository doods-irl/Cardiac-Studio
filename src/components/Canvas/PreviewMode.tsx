import { useMemo } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { renderTemplate } from "@/engine/render/svg";
import { hasTauri, assetFileUrl } from "@/io/tauri";
import type { AssetRef } from "@/model/types";

export function PreviewMode() {
  const loaded = useDoc((s) => s.loaded);
  const tplId  = useEditor((s) => s.activeTemplateId);
  const setTab = useEditor((s) => s.setTab);
  const setRec = useEditor((s) => s.setActiveRecord);
  const activeRec = useEditor((s) => s.activeRecordId);

  const tpl = useMemo(
    () => loaded?.project.templates.find((t) => t.id === tplId) ?? null,
    [loaded, tplId],
  );
  if (!loaded || !tpl) return <div />;

  const rows = tpl.datasetId ? (loaded.records[tpl.datasetId] ?? []) : [];
  // `border-radius: X% / Y%` gives an elliptical corner where X is the
  // horizontal radius as a % of width and Y is vertical as a % of height.
  // We pick both so the corner stays geometrically square (the card's
  // `cornerRadiusMm` in both dimensions) at any preview tile size.
  const cornerMm = tpl.canvas.cornerRadiusMm ?? 0;
  const rx = tpl.canvas.widthMm  > 0 ? (cornerMm / tpl.canvas.widthMm)  * 100 : 0;
  const ry = tpl.canvas.heightMm > 0 ? (cornerMm / tpl.canvas.heightMm) * 100 : 0;
  const frameRadius = `${rx}% / ${ry}%`;

  return (
    <div className="preview-wrap">
      <div className="head">
        <div className="title">Deck Preview</div>
        <div className="subtitle">{loaded.project.meta.name}</div>
        <div className="chip">{rows.length} cards · {tpl.canvas.dpi} DPI · PNG</div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-hint" style={{ padding: 40, textAlign: "center", fontStyle: "normal" }}>
          No records in this dataset yet. Switch to the Data tab to add some.
        </div>
      ) : (
        <div className="preview-grid">
          {rows.map((r, i) => {
            const node = renderTemplate(tpl.canvas, tpl.root, {
              record: r,
              assets: loaded.project.assets,
              variables: loaded.project.variables ?? [],
              palette: loaded.project.palette ?? [],
              icons: loaded.project.icons ?? [],
              assetUrl: (a: AssetRef) => {
                if (a.path.startsWith("data:") || a.path.startsWith("http")) return a.path;
                if (!hasTauri()) return "";
                return assetFileUrl(`${loaded.path.replace(/\\/g, "/").replace(/\/$/, "")}/${a.path}`);
              },
              selectedId: null,
            });
            const rec = r as { name?: string; type?: string };
            const active = r.id === activeRec;
            return (
              <div key={r.id}
                className={"preview-tile " + (active ? "active" : "")}
                onClick={() => { setRec(r.id); setTab("design"); }}>
                <div className="ord">
                  <span>{String(i + 1).padStart(2, "0")} / {rows.length}</span>
                </div>
                <div className="card-frame" style={{ borderRadius: frameRadius }}>{node}</div>
                <div className="name">{rec.name ?? r.id.slice(-6)}</div>
                <div className="sub">{rec.type ?? ""}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
