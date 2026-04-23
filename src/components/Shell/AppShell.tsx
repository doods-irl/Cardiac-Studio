import { useCallback } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { TitleBar } from "./TitleBar";
import { Tabs } from "./Tabs";
import { Welcome } from "./Welcome";
import { StatusBar } from "./StatusBar";
import { LeftPanel } from "@/components/Panels/LeftPanel";
import { RightPanel } from "@/components/Panels/RightPanel";
import { CanvasArea } from "@/components/Canvas/CanvasArea";
import { DataGrid } from "@/components/Grid/DataGrid";
import { PreviewMode } from "@/components/Canvas/PreviewMode";
import { ExportPanel } from "@/components/Shell/ExportPanel";
import { AssetsPanel } from "@/components/Shell/AssetsPanel";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

/** Min / max clamps for user-resizable panels. */
const MIN_LEFT  = 180, MAX_LEFT  = 520;
const MIN_RIGHT = 220, MAX_RIGHT = 560;
const MIN_GRID  = 120, MAX_GRID  = 640;

export function AppShell() {
  const loaded = useDoc((s) => s.loaded);
  const tab = useEditor((s) => s.tab);

  const leftW  = useEditor((s) => s.leftPanelWidth);
  const rightW = useEditor((s) => s.rightPanelWidth);
  const gridH  = useEditor((s) => s.gridHeight);
  const setLeftW  = useEditor((s) => s.setLeftPanelWidth);
  const setRightW = useEditor((s) => s.setRightPanelWidth);
  const setGridH  = useEditor((s) => s.setGridHeight);

  useKeyboardShortcuts();

  const leftHandle  = useResizeDrag({ axis: "x", getOrig: () => leftW,  onChange: setLeftW,  min: MIN_LEFT,  max: MAX_LEFT  });
  const rightHandle = useResizeDrag({ axis: "x", getOrig: () => rightW, onChange: setRightW, min: MIN_RIGHT, max: MAX_RIGHT, invert: true });
  const gridHandle  = useResizeDrag({ axis: "y", getOrig: () => gridH,  onChange: setGridH,  min: MIN_GRID,  max: MAX_GRID,  invert: true });

  if (!loaded) return <Welcome />;

  /**
   * Workspace is a 5-column × 3-row CSS grid:
   *   col 1: left panel · col 2: h-handle · col 3: centre
   *   col 4: h-handle   · col 5: right panel
   *   row 1: main · row 2: v-handle · row 3: data grid
   *
   * Handles get fixed 4 px tracks; panels get explicit widths from
   * state. The layout collapses for Data mode (full-width grid).
   */

  return (
    <div className="shell">
      <TitleBar />
      <Tabs />

      {tab === "design" && (
        <div className="workspace" style={{
          gridTemplateColumns: `${leftW}px 4px 1fr 4px ${rightW}px`,
          gridTemplateRows:    `1fr 4px ${gridH}px`,
        }}>
          <div className="left"><LeftPanel /></div>
          <div className="ws-handle ws-handle-v ws-handle-left"  onMouseDown={leftHandle}  />
          <div className="centre"><CanvasArea /></div>
          <div className="ws-handle ws-handle-v ws-handle-right" onMouseDown={rightHandle} />
          <div className="right"><RightPanel /></div>
          <div className="ws-handle ws-handle-h ws-handle-grid"  onMouseDown={gridHandle}  />
          <div className="bottom"><DataGrid /></div>
        </div>
      )}
      {tab === "data" && (
        <div className="workspace data-mode" style={{
          gridTemplateColumns: `${leftW}px 4px 1fr`,
          gridTemplateRows:    `1fr`,
        }}>
          <div className="left"><LeftPanel /></div>
          <div className="ws-handle ws-handle-v ws-handle-left" onMouseDown={leftHandle} />
          <div className="centre" style={{ overflow: "hidden" }}>
            <DataGrid fullscreen />
          </div>
        </div>
      )}
      {tab === "assets"  && <AssetsPanel />}
      {tab === "preview" && <PreviewMode />}
      {tab === "export"  && <ExportPanel />}

      <StatusBar />
    </div>
  );
}

/**
 * Drag-to-resize for a workspace handle. `getOrig` snapshots the
 * current size at drag start; `onChange` receives each clamped new
 * size. `invert` flips the sign (used by the right panel — dragging
 * leftward grows it — and the grid — dragging upward grows it).
 */
function useResizeDrag(opts: {
  axis: "x" | "y";
  getOrig: () => number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  invert?: boolean;
}) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const start = opts.axis === "x" ? e.clientX : e.clientY;
    const orig = opts.getOrig();
    document.body.style.cursor = opts.axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const cur = opts.axis === "x" ? ev.clientX : ev.clientY;
      let delta = cur - start;
      if (opts.invert) delta = -delta;
      const next = Math.max(opts.min, Math.min(opts.max, orig + delta));
      opts.onChange(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.axis, opts.invert, opts.min, opts.max]);
}
