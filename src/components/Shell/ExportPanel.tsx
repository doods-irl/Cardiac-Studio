import { useEffect, useMemo, useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { renderTemplateToSvg, canvasPixelSize, safeFilename } from "@/engine/export/png";
import { invoke, hasTauri } from "@/io/tauri";
import { showAlert } from "./Dialog";

type Format = "PNG" | "PDF (sheet)";
type Bleed = "None" | "Include" | "Crop marks";

const PAGE_SIZES: Record<string, { widthMm: number; heightMm: number }> = {
  "A4 portrait":     { widthMm: 210,   heightMm: 297 },
  "A4 landscape":    { widthMm: 297,   heightMm: 210 },
  "Letter portrait": { widthMm: 215.9, heightMm: 279.4 },
  "Letter landscape":{ widthMm: 279.4, heightMm: 215.9 },
};

const PAGE_MARGIN_MM = 10;

export function ExportPanel() {
  const loaded = useDoc((s) => s.loaded)!;
  const activeTplId = useEditor((s) => s.activeTemplateId);

  // Deck (template) picked for export — defaults to whatever was active
  // in the design view, but the user can switch to any other template
  // here without leaving the export panel. If the active template
  // changes (e.g. user creates a new card while the panel is open) we
  // *don't* override their choice — they're driving now.
  const [tplId, setTplId] = useState<string | null>(activeTplId);
  useEffect(() => {
    if (tplId == null && activeTplId != null) setTplId(activeTplId);
  }, [activeTplId, tplId]);
  const tpl = loaded.project.templates.find((t) => t.id === tplId)
           ?? loaded.project.templates.find((t) => t.id === activeTplId)
           ?? loaded.project.templates[0];

  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [format, setFormat] = useState<Format>("PNG");
  const [dpi, setDpi] = useState<150 | 300 | 600>(300);
  const [bleed, setBleed] = useState<Bleed>("Include");
  const [pageSize, setPageSize] = useState<keyof typeof PAGE_SIZES>("A4 portrait");

  // Card count per template — used by the deck picker chips. Recomputed
  // when records change so the picker stays accurate.
  const tplRowCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of loaded.project.templates) {
      m[t.id] = (t.datasetId ? loaded.records[t.datasetId]?.length : 0) ?? 0;
    }
    return m;
  }, [loaded.project.templates, loaded.records]);

  if (!tpl) return null;

  const ds   = tpl.datasetId ? loaded.project.datasets.find((d) => d.id === tpl.datasetId) : undefined;
  const rows = ds ? loaded.records[ds.id] ?? [] : [];
  const includeBleed = bleed !== "None";
  const { widthPx, heightPx } = canvasPixelSize({ ...tpl.canvas, dpi }, includeBleed);
  const cardWidthMm  = tpl.canvas.widthMm  + (includeBleed ? tpl.canvas.bleedMm * 2 : 0);
  const cardHeightMm = tpl.canvas.heightMm + (includeBleed ? tpl.canvas.bleedMm * 2 : 0);

  const addLog = (s: string) => setLog((l) => [...l, s]);

  const buildItems = () => rows.map((r, i) => ({
    filename: safeFilename((r as { name?: string }).name ?? "card", i),
    svg: renderTemplateToSvg(tpl, r, loaded.project.assets, loaded.path, {
      variables: loaded.project.variables,
      icons:     loaded.project.icons,
      palette:   loaded.project.palette,
    }),
  }));

  const exportPng = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, title: "Choose output folder" });
    if (!dir) return;
    setBusy(true);
    addLog(`▶ ${tpl.name}: rendering ${rows.length} PNGs → ${dir}`);
    const written = await invoke.exportDeckPngs({
      projectPath: loaded.path,
      outDir: dir as string,
      items: buildItems(),
      widthPx, heightPx,
    });
    addLog(`✓ wrote ${written.length} files`);
  };

  const exportPdf = async () => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const defaultName = (tpl.name || "deck").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
    const out = await save({
      title: "Save deck PDF",
      defaultPath: `${defaultName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!out) return;
    const page = PAGE_SIZES[pageSize];
    setBusy(true);
    addLog(`▶ ${tpl.name}: composing ${rows.length} cards on ${pageSize} → ${out}`);
    const result = await invoke.exportDeckPdf({
      projectPath: loaded.path,
      outPath: out as string,
      items: buildItems(),
      widthPx, heightPx,
      cardWidthMm, cardHeightMm,
      pageWidthMm:  page.widthMm,
      pageHeightMm: page.heightMm,
      marginMm: PAGE_MARGIN_MM,
      bleedMm: includeBleed ? tpl.canvas.bleedMm : 0,
      cropMarks: bleed === "Crop marks",
    });
    addLog(`✓ wrote ${result}`);
  };

  const exportDeck = async () => {
    if (!hasTauri()) {
      await showAlert({ title: "Desktop only", message: "Export requires the desktop build.", tone: "warning" });
      return;
    }
    if (rows.length === 0) {
      await showAlert({ title: "Nothing to export", message: "This deck has no records yet.", tone: "warning" });
      return;
    }
    try {
      if (format === "PNG") await exportPng();
      else                  await exportPdf();
    } catch (e) {
      addLog(`✗ ${e}`);
      await showAlert({ title: "Export failed", message: String(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export-wrap">
      <div className="title">Export Deck</div>
      <div className="intro">
        Render every record through the chosen deck. PNG writes one file per card;
        PDF (sheet) lays cards onto printable pages.
      </div>

      <div className="deck-picker">
        <span className="deck-picker-label">Deck</span>
        <div className="deck-tabs">
          {loaded.project.templates.map((t) => (
            <button key={t.id}
              className={"deck-tab" + (t.id === tpl.id ? " on" : "")}
              onClick={() => setTplId(t.id)}
              disabled={busy}
              title={`${t.canvas.widthMm}×${t.canvas.heightMm}mm · ${tplRowCounts[t.id] ?? 0} card${(tplRowCounts[t.id] ?? 0) === 1 ? "" : "s"}`}
            >
              <span className="deck-tab-name">{t.name}</span>
              <span className="deck-tab-count">{tplRowCounts[t.id] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="export-grid">
        <Card k="Format" v={format} opts={["PNG", "PDF (sheet)"]}
              onPick={(o) => setFormat(o as Format)} />
        <Card k="DPI" v={String(dpi)} opts={["150", "300", "600"]}
              onPick={(o) => setDpi(Number(o) as typeof dpi)} />
        <Card k="Bleed" v={bleed} opts={["None", "Include", "Crop marks"]}
              onPick={(o) => setBleed(o as Bleed)} />
        {format === "PDF (sheet)" ? (
          <Card k="Page" v={pageSize} opts={Object.keys(PAGE_SIZES)}
                onPick={(o) => setPageSize(o as keyof typeof PAGE_SIZES)} />
        ) : (
          <Card k="Pixel size" v={`${widthPx}×${heightPx}`} opts={[]} onPick={() => {}} />
        )}
      </div>
      <button className="export-run" disabled={busy || rows.length === 0}
              onClick={exportDeck}>
        ▶ Run Export · {rows.length} Card{rows.length === 1 ? "" : "s"}
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
