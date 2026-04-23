import { useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { renderTemplateToSvg, canvasPixelSize, safeFilename } from "@/engine/export/png";
import { invoke, hasTauri } from "@/io/tauri";

export function ExportPanel() {
  const loaded = useDoc((s) => s.loaded)!;
  const tplId  = useEditor((s) => s.activeTemplateId);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [format, setFormat] = useState<"PNG" | "PDF (sheet)" | "ZIP">("PNG");
  const [dpi, setDpi] = useState<150 | 300 | 600>(300);
  const [bleed, setBleed] = useState<"None" | "Include" | "Crop marks">("Include");

  const tpl = loaded.project.templates.find((t) => t.id === tplId);
  if (!tpl) return null;
  const ds  = tpl.datasetId ? loaded.project.datasets.find((d) => d.id === tpl.datasetId) : undefined;
  const rows = ds ? loaded.records[ds.id] ?? [] : [];
  const includeBleed = bleed !== "None";
  const { widthPx, heightPx } = canvasPixelSize({ ...tpl.canvas, dpi }, includeBleed);

  const addLog = (s: string) => setLog((l) => [...l, s]);

  const exportDeck = async () => {
    if (!hasTauri()) { alert("Export requires the desktop build."); return; }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: "Choose output folder" });
      if (!dir) return;
      setBusy(true);
      addLog(`▶ Rendering ${rows.length} cards → ${dir}`);
      const items = rows.map((r, i) => ({
        filename: safeFilename((r as { name?: string }).name ?? "card", i),
        svg: renderTemplateToSvg(tpl, r, loaded.project.assets, loaded.path, {
          variables: loaded.project.variables,
          icons: loaded.project.icons,
          palette: loaded.project.palette,
        }),
      }));
      const written = await invoke.exportDeckPngs({
        projectPath: loaded.path,
        outDir: dir as string,
        items, widthPx, heightPx,
      });
      addLog(`✓ wrote ${written.length} files`);
    } catch (e) { addLog(`✗ ${e}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="export-wrap">
      <div className="title">Export Deck</div>
      <div className="intro">
        Render every record through the current template. Files are written as{" "}
        <span className="mono">{`{idx}-{slug}.{ext}`}</span>.
      </div>
      <div className="export-grid">
        <Card k="Format" v={format} opts={["PNG", "PDF (sheet)", "ZIP"]}
              onPick={(o) => setFormat(o as typeof format)} />
        <Card k="DPI" v={String(dpi)} opts={["150", "300", "600"]}
              onPick={(o) => setDpi(Number(o) as typeof dpi)} />
        <Card k="Bleed" v={bleed} opts={["None", "Include", "Crop marks"]}
              onPick={(o) => setBleed(o as typeof bleed)} />
        <Card k="Pixel size" v={`${widthPx}×${heightPx}`} opts={[]} onPick={() => {}} />
      </div>
      <button className="export-run" disabled={busy || rows.length === 0}
              onClick={exportDeck}>
        ▶ Run Export · {rows.length} Cards
      </button>
      <div className="export-log">
        {log.length === 0 ? "(log empty)" : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

function Card({ k, v, opts, onPick }: { k: string; v: string; opts: string[]; onPick: (o: string) => void }) {
  return (
    <div className="export-card">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {opts.length > 0 && (
        <div className="opts">
          {opts.map((o) => (
            <span key={o} className={o === v ? "on" : ""} onClick={() => onPick(o)}
                  style={{ cursor: "pointer" }}>{o}</span>
          ))}
        </div>
      )}
    </div>
  );
}
