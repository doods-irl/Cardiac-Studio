import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { renderTemplate, renderGhostOverlay } from "@/engine/render/svg";
import { findElement } from "@/model/selectors";
import type { AssetRef, DataRecord, Element, ElementGroup } from "@/model/types";
import { hasTauri } from "@/io/tauri";
import { Icon } from "@/components/Shell/Icons";

const MM_TO_PX = 4; // px per mm at zoom = 1

export function CanvasArea() {
  // ── Hooks (must run in the same order every render — don't early
  //    return above this block). See the gating at the bottom of the
  //    hook section for the null/loading branch.
  const loaded = useDoc((s) => s.loaded);
  const tplId  = useEditor((s) => s.activeTemplateId);
  const recId  = useEditor((s) => s.activeRecordId);
  const zoom   = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const selectElement = useEditor((s) => s.selectElement);
  const selectedId   = useEditor((s) => s.selectedElementId);
  const showSafeArea = useEditor((s) => s.showSafeArea);
  const showTrimmed  = useEditor((s) => s.showTrimmed);
  const showBleed    = useEditor((s) => s.showBleed);
  const resizeFromAnchor = useEditor((s) => s.resizeFromAnchor);
  const toggleTrimmed  = useEditor((s) => s.toggleTrimmed);
  const toggleSafeArea = useEditor((s) => s.toggleSafeArea);
  const toggleBleed    = useEditor((s) => s.toggleBleed);
  const toggleResizeFromAnchor = useEditor((s) => s.toggleResizeFromAnchor);
  const updateElement = useDoc((s) => s.updateElement);
  const showDefaults = useEditor((s) => s.showDefaults);
  const layerHoverId = useEditor((s) => s.hoveredLayerId);
  const tool    = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  type Handle = "tl" | "tr" | "bl" | "br" | "tm" | "bm" | "lm" | "rm";
  type Drag =
    | { kind: "move"; id: string; startX: number; startY: number; origX: number; origY: number }
    | {
        kind: "resize"; id: string; handle: Handle;
        startX: number; startY: number;
        origX: number; origY: number; origW: number; origH: number;
        origAnchorX: number; origAnchorY: number;
      }
    | { kind: "pan"; startX: number; startY: number; origPanX: number; origPanY: number };
  const [dragging, setDragging] = useState<Drag | null>(null);
  // Id of the element the cursor is currently hovering over while in
  // select mode. Drives the translucent purple preview overlay so the
  // user can see what a click would pick.
  const [hoverId, setHoverId] = useState<string | null>(null);

  // `tpl` is derived, not a hook — but hooks below read it. Compute a
  // null-safe value here so every useMemo below can run unconditionally
  // and then the component gates on `tpl` after all hooks have fired.
  const tpl = loaded && tplId
    ? loaded.project.templates.find((t) => t.id === tplId) ?? null
    : null;

  const record: DataRecord | undefined = useMemo(() => {
    if (showDefaults) return undefined;
    if (!loaded || !tpl?.datasetId) return undefined;
    const rows = loaded.records[tpl.datasetId] ?? [];
    return rows.find((r) => r.id === recId) ?? rows[0];
  }, [loaded, tpl?.datasetId, recId, showDefaults]);

  const assets: AssetRef[] = loaded?.project.assets ?? [];
  const variables = loaded?.project.variables ?? [];
  const icons     = loaded?.project.icons ?? [];
  const palette   = loaded?.project.palette ?? [];

  const loadedPath = loaded?.path ?? "";
  const ctx = {
    record,
    assets,
    variables,
    palette,
    icons,
    assetUrl: (a: AssetRef) => projectAssetUrl(loadedPath, a.path),
    selectedId,
    showTrimmed,
    showDefaults,
  };
  const node = useMemo(
    () => tpl ? renderTemplate(tpl.canvas, tpl.root, ctx) : null,
    [tpl?.canvas, tpl?.root, record, assets, variables, palette, icons, selectedId, loadedPath, showTrimmed, showDefaults],
  );
  const ghost = useMemo(
    () => tpl && showTrimmed ? renderGhostOverlay(tpl.canvas, tpl.root, ctx) : null,
    [tpl?.canvas, tpl?.root, record, assets, variables, palette, icons, loadedPath, showTrimmed, showDefaults],
  );

  const selEl: Element | undefined = useMemo(() => {
    if (!tpl || !selectedId) return undefined;
    return findElement(tpl.root, selectedId);
  }, [tpl?.root, selectedId]);

  // World-space bounds of the selection. The element's stored x/y is
  // local to its parent group; the HTML selection overlay sits in the
  // card's root coordinate space, so we sum up each ancestor's local
  // offset to get the correct on-canvas position.
  const selBounds = useMemo(() => {
    if (!tpl || !selEl) return null;
    return worldBoxOf(tpl.root, selEl.id);
  }, [tpl?.root, selEl]);

  // World-space bounds for the hover preview. Only shown in select mode
  // and suppressed when hovering the already-selected element (the
  // selection outline is enough). Also skips hidden elements so the
  // overlay doesn't appear over invisible content.
  const hoverBounds = useMemo(() => {
    if (!tpl || tool !== "select" || !hoverId || hoverId === selectedId) return null;
    const el = findElement(tpl.root, hoverId);
    if (!el || el.hidden) return null;
    return worldBoxOf(tpl.root, hoverId);
  }, [tpl?.root, tool, hoverId, selectedId]);

  // Layer-panel hover → canvas highlight. Mirrors the select-mode
  // hover overlay. For groups we expand to every descendant leaf so
  // the user sees which elements are *inside* the group, not a vague
  // outer box that may not even cover them. Hidden elements / groups
  // are skipped to avoid highlighting invisible content.
  const layerHoverBounds = useMemo(() => {
    if (!tpl || !layerHoverId) return [];
    const el = findElement(tpl.root, layerHoverId);
    if (!el || el.hidden) return [];
    return collectLeafWorldBoxes(tpl.root, layerHoverId);
  }, [tpl?.root, layerHoverId]);

  const pxPerMm = MM_TO_PX * zoom;
  const mmPerPx = 1 / pxPerMm;
  const tplId_ = tpl?.id;
  useEffect(() => {
    if (!dragging || !tplId_) return;
    const move = (e: MouseEvent) => {
      if (dragging.kind === "pan") {
        setPan({
          x: dragging.origPanX + (e.clientX - dragging.startX),
          y: dragging.origPanY + (e.clientY - dragging.startY),
        });
        return;
      }
      const dx = (e.clientX - dragging.startX) * mmPerPx;
      const dy = (e.clientY - dragging.startY) * mmPerPx;
      if (dragging.kind === "move") {
        updateElement(tplId_, dragging.id, {
          x: dragging.origX + dx,
          y: dragging.origY + dy,
        });
        return;
      }
      const useAnchor = resizeFromAnchor !== e.altKey;
      const { next } = computeResize(dragging, dx, dy, useAnchor);
      updateElement(tplId_, dragging.id, next);
    };
    const up = () => setDragging(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, [dragging, mmPerPx, tplId_, updateElement, resizeFromAnchor]);

  // ── End hooks. Safe to branch on data from here on. ─────────────────
  if (!loaded || !tplId) return null;
  if (!tpl) return <div className="canvas-area" />;

  const W = tpl.canvas.widthMm;
  const H = tpl.canvas.heightMm;
  const stageW = W * pxPerMm;
  const stageH = H * pxPerMm;

  const onCardMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = (e.target as SVGElement).closest("[data-element-id]");
    const id = target?.getAttribute("data-element-id") ?? null;

    if (tool === "modify") {
      // Selection is locked: never change it, but let the user drag the
      // currently-selected element from anywhere on the card.
      if (!selectedId) return;
      const el = findElement(tpl.root, selectedId);
      if (!el || el.locked) return;
      setDragging({
        kind: "move", id: selectedId,
        startX: e.clientX, startY: e.clientY,
        origX: el.x, origY: el.y,
      });
      e.preventDefault();
      return;
    }

    // select tool: click to select only; drag-to-move is reserved for modify.
    selectElement(id);
  };

  const onCardMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "select") { if (hoverId) setHoverId(null); return; }
    const target = (e.target as SVGElement).closest("[data-element-id]");
    const id = target?.getAttribute("data-element-id") ?? null;
    if (id !== hoverId) setHoverId(id);
  };
  const onCardMouseLeave = () => {
    if (hoverId) setHoverId(null);
  };

  /** Pan-tool drag: track start + original pan, apply delta to `pan` state. */
  const onViewportMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (tool !== "pan") return;
    setDragging({
      kind: "pan",
      startX: e.clientX, startY: e.clientY,
      origPanX: pan.x, origPanY: pan.y,
    });
    e.preventDefault();
  };

  const onHandleDown = (handle: Handle) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!selEl || selEl.locked) return;
    setDragging({
      kind: "resize",
      id: selEl.id,
      handle,
      startX: e.clientX, startY: e.clientY,
      origX: selEl.x, origY: selEl.y,
      origW: selEl.w, origH: selEl.h,
      origAnchorX: selEl.anchor?.x ?? 0.5,
      origAnchorY: selEl.anchor?.y ?? 0.5,
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    // Clamp matches the setZoom bounds in the editor store so the
    // pan math below uses the actual ratio applied rather than the
    // requested one (avoids a small drift when we bump into a bound).
    const newZoom = Math.max(0.1, Math.min(4, zoom * factor));
    const actualFactor = newZoom / zoom;
    // Keep the point under the cursor stationary as we zoom. Compute
    // cursor position in the canvas-area's local space, then scale the
    // pan vector around that anchor so the world coordinate at the
    // cursor is unchanged after the zoom step.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    setPan({
      x: cx - (cx - pan.x) * actualFactor,
      y: cy - (cy - pan.y) * actualFactor,
    });
    setZoom(newZoom);
  };

  const corner = tpl.canvas.cornerRadiusMm ?? 0;
  const stageCorner = (corner / W) * stageW;

  return (
    <>
      <div className="canvas-toolbar">
        <button className={"tool " + (showBleed ? "active" : "")}
                onClick={toggleBleed} title="Toggle bleed guide">✀ Bleed</button>
        <button className={"tool " + (showSafeArea ? "active" : "")}
                onClick={toggleSafeArea} title="Toggle safe area">⌖ Safe</button>
        <button className={"tool " + (showTrimmed ? "active" : "")}
                onClick={toggleTrimmed} title="Toggle trim preview">▥ Trim</button>
        <button className={"tool " + (resizeFromAnchor ? "active" : "")}
                onClick={toggleResizeFromAnchor}
                title="Resize from anchor (hold Alt to invert while dragging)">
          ⊕ Anchor
        </button>
        <button className="tool" onClick={() => setZoom(zoom / 1.2)} title="Zoom out">−</button>
        <button className="tool zoom-chip" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                title="Reset zoom & pan">{Math.round(zoom * 100)}%</button>
        <button className="tool" onClick={() => setZoom(zoom * 1.2)} title="Zoom in">+</button>
        <button className="tool" onClick={() => {
          fitToScreen(stageRef.current, tpl.canvas, setZoom);
          setPan({ x: 0, y: 0 });
        }} title="Fit">Fit</button>
        <div className="spacer" />
        <div className="readout">
          {selEl && <span>X <span className="v">{selEl.x.toFixed(1)}</span></span>}
          {selEl && <span>Y <span className="v">{selEl.y.toFixed(1)}</span></span>}
        </div>
      </div>

      <div
        className={"canvas-area tool-" + tool + (dragging?.kind === "pan" ? " panning" : "")}
        ref={stageRef}
        onWheel={onWheel}
        onMouseDown={onViewportMouseDown}
      >
        <div className="tool-dock" onMouseDown={(e) => e.stopPropagation()}>
          <button className={"tool-sq " + (tool === "select" ? "active" : "")}
            onClick={() => setTool("select")} title="Select (V)">
            <Icon name="cursor" size={16} />
          </button>
          <button className={"tool-sq " + (tool === "modify" ? "active" : "")}
            onClick={() => setTool("modify")}
            title="Modify — move the current selection (M)">
            <Icon name="move" size={16} />
          </button>
          <button className={"tool-sq " + (tool === "pan" ? "active" : "")}
            onClick={() => setTool("pan")} title="Pan (H)">
            <Icon name="hand" size={16} />
          </button>
        </div>
        <div
          className="card-viewport"
          ref={viewportRef}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <div className="card-outer" onClick={(e) => e.stopPropagation()}>
            {ghost && (
              <div
                className="ghost-layer"
                style={{
                  position: "absolute",
                  left: -ghost.slackMm * pxPerMm,
                  top:  -ghost.slackMm * pxPerMm,
                  width:  stageW + ghost.slackMm * 2 * pxPerMm,
                  height: stageH + ghost.slackMm * 2 * pxPerMm,
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              >
                {ghost.element}
              </div>
            )}
            {showBleed && (
              <div className="bleed-ring" style={{
                inset: `-${tpl.canvas.bleedMm * pxPerMm}px`,
                borderRadius: stageCorner + tpl.canvas.bleedMm * pxPerMm,
              }} />
            )}
            {showSafeArea && (
              <div className="safe-ring" style={{
                inset: `${tpl.canvas.safeAreaMm * pxPerMm}px`,
                borderRadius: Math.max(0, stageCorner - tpl.canvas.safeAreaMm * pxPerMm),
              }} />
            )}
            <div className="card-svg-wrap"
                 onMouseDown={onCardMouseDown}
                 onMouseMove={onCardMouseMove}
                 onMouseLeave={onCardMouseLeave}
                 style={{ width: stageW, height: stageH, borderRadius: stageCorner }}>
              {node}
            </div>
            {hoverBounds && (
              <div className="hover-highlight" style={{
                left: hoverBounds.x * pxPerMm,
                top:  hoverBounds.y * pxPerMm,
                width:  hoverBounds.w * pxPerMm,
                height: hoverBounds.h * pxPerMm,
              }} />
            )}
            {layerHoverBounds.map((b, i) => (
              <div key={i} className="hover-highlight" style={{
                left: b.x * pxPerMm,
                top:  b.y * pxPerMm,
                width:  b.w * pxPerMm,
                height: b.h * pxPerMm,
              }} />
            ))}
            {selEl && selBounds && selEl.type !== "group" && (
              <div className="selection-box" style={{
                left: selBounds.x * pxPerMm,
                top:  selBounds.y * pxPerMm,
                width:  selBounds.w * pxPerMm,
                height: selBounds.h * pxPerMm,
              }}>
                <div className="selection-label">
                  {selEl.name} · {selEl.w.toFixed(1)}×{selEl.h.toFixed(1)}mm
                </div>
                {(["tl","tr","bl","br","tm","bm","lm","rm"] as const).map((p) => (
                  <div
                    key={p}
                    className={"handle " + p}
                    onMouseDown={onHandleDown(p)}
                  />
                ))}
                {/* Anchor point indicator. Small ring at the element's pivot. */}
                {(() => {
                  const ax = selEl.anchor?.x ?? 0.5;
                  const ay = selEl.anchor?.y ?? 0.5;
                  return (
                    <div
                      className="anchor-dot"
                      style={{ left: `${ax * 100}%`, top: `${ay * 100}%` }}
                    />
                  );
                })()}
              </div>
            )}
            {/* Groups aren't resizable; we show just a draggable anchor
                dot at the group's pivot. Clicking and dragging it moves
                the group regardless of the current tool mode. */}
            {selEl && selBounds && selEl.type === "group" && (() => {
              const ax = selEl.anchor?.x ?? 0.5;
              const ay = selEl.anchor?.y ?? 0.5;
              const px = (selBounds.x + selBounds.w * ax) * pxPerMm;
              const py = (selBounds.y + selBounds.h * ay) * pxPerMm;
              return (
                <div
                  className="group-anchor-handle"
                  style={{ left: px, top: py }}
                  title={`${selEl.name} — drag to move`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (selEl.locked) return;
                    setDragging({
                      kind: "move", id: selEl.id,
                      startX: e.clientX, startY: e.clientY,
                      origX: selEl.x, origY: selEl.y,
                    });
                  }}
                />
              );
            })()}
          </div>
        </div>
      </div>
    </>
  );
}

function fitToScreen(container: HTMLElement | null, canvas: { widthMm: number; heightMm: number }, setZoom: (z: number) => void) {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const z = Math.min(
    (rect.width - 100)  / (canvas.widthMm  * MM_TO_PX),
    (rect.height - 80)  / (canvas.heightMm * MM_TO_PX),
  );
  setZoom(Math.max(0.2, z));
}

/**
 * Compute a resize based on handle direction and the user's delta.
 *
 * Two modes:
 *   - `useAnchor === false` (default): the edge OPPOSITE the dragged
 *     handle stays fixed. Standard vector-editor behaviour.
 *   - `useAnchor === true`: the element's anchor point stays fixed in
 *     canvas space. Both edges scale around the pivot.
 *
 * If the anchor sits on the same axis as the handle being dragged
 * (e.g. anchor at x=0 and dragging the left handle) the anchor-axis
 * falls back to opposite-fixed on that axis — there's no geometrically
 * sensible anchor-pinned resize there.
 */
function computeResize(
  d: Extract<{
    kind: "resize"; id: string;
    handle: "tl" | "tr" | "bl" | "br" | "tm" | "bm" | "lm" | "rm";
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
    origAnchorX: number; origAnchorY: number;
  }, { kind: "resize" }>,
  dx: number,
  dy: number,
  useAnchor: boolean,
): { next: { x: number; y: number; w: number; h: number } } {
  const MIN = 0.5;
  const h = d.handle;
  const hx = (h === "tl" || h === "bl" || h === "lm") ? 0
           : (h === "tm" || h === "bm") ? 0.5 : 1;
  const hy = (h === "tl" || h === "tr" || h === "tm") ? 0
           : (h === "lm" || h === "rm") ? 0.5 : 1;

  let nw = d.origW, nh = d.origH;
  let nx = d.origX, ny = d.origY;

  const axisActiveX = hx !== 0.5;
  const axisActiveY = hy !== 0.5;

  // ── X axis ────────────────────────────────────────────────────────
  if (axisActiveX) {
    const gap = d.origAnchorX - hx;  // handle-to-anchor distance, normalized
    if (useAnchor && Math.abs(gap) > 0.001) {
      // Anchor-pinned: scale around origAnchor. new_w is derived from
      // how far the handle must move so the anchor absolute x stays.
      nw = Math.max(MIN, d.origW - dx / gap);
      const anchorAbs = d.origX + d.origW * d.origAnchorX;
      nx = anchorAbs - nw * d.origAnchorX;
    } else {
      // Opposite-fixed fallback (or when anchor coincides with handle).
      if (hx === 0) {
        nw = Math.max(MIN, d.origW - dx);
        nx = d.origX + (d.origW - nw);
      } else {
        nw = Math.max(MIN, d.origW + dx);
      }
    }
  }

  // ── Y axis ────────────────────────────────────────────────────────
  if (axisActiveY) {
    const gap = d.origAnchorY - hy;
    if (useAnchor && Math.abs(gap) > 0.001) {
      nh = Math.max(MIN, d.origH - dy / gap);
      const anchorAbs = d.origY + d.origH * d.origAnchorY;
      ny = anchorAbs - nh * d.origAnchorY;
    } else {
      if (hy === 0) {
        nh = Math.max(MIN, d.origH - dy);
        ny = d.origY + (d.origH - nh);
      } else {
        nh = Math.max(MIN, d.origH + dy);
      }
    }
  }

  return { next: { x: nx, y: ny, w: nw, h: nh } };
}

/**
 * World-space bounds of a nested element.
 *
 * Each element's stored x/y is local to its parent group. The HTML
 * selection overlay lives in the card's root coordinate space, so for
 * nested elements we need to sum their ancestors' local offsets to get
 * the right on-canvas position.
 *
 * We walk starting from the root group's **children** (not the root
 * itself), because the renderer never applies the root group's own
 * translate — top-level children are rendered at their local (x, y)
 * directly in canvas space.
 *
 * Note: rotation on ancestor groups isn't accounted for — the overlay
 * will still box-align but won't rotate with the group. Good enough
 * for the common case; revisit if rotated nested groups become a
 * real workflow.
 */
/**
 * Collect world-space bounds for the element identified by `id`. If
 * the element is a leaf, returns a single box. If it's a group, returns
 * one box per descendant leaf so the highlight follows the children's
 * actual footprint rather than the group's loose outer rect.
 */
function collectLeafWorldBoxes(root: ElementGroup, id: string): Array<{ x: number; y: number; w: number; h: number }> {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  const pushLeaves = (el: Element, ax: number, ay: number) => {
    if (el.type === "group") {
      for (const c of el.children) pushLeaves(c, ax + el.x, ay + el.y);
    } else {
      out.push({ x: ax + el.x, y: ay + el.y, w: el.w, h: el.h });
    }
  };
  const find = (group: ElementGroup, ax: number, ay: number): boolean => {
    for (const c of group.children) {
      if (c.id === id) {
        if (c.type === "group") {
          for (const cc of c.children) pushLeaves(cc, ax + c.x, ay + c.y);
        } else {
          out.push({ x: ax + c.x, y: ay + c.y, w: c.w, h: c.h });
        }
        return true;
      }
      if (c.type === "group") {
        if (find(c, ax + c.x, ay + c.y)) return true;
      }
    }
    return false;
  };
  find(root, 0, 0);
  return out;
}

function worldBoxOf(root: ElementGroup, id: string): { x: number; y: number; w: number; h: number } | null {
  const walk = (group: ElementGroup, ax: number, ay: number): { x: number; y: number; w: number; h: number } | null => {
    for (const c of group.children) {
      const wx = ax + c.x;
      const wy = ay + c.y;
      if (c.id === id) return { x: wx, y: wy, w: c.w, h: c.h };
      if (c.type === "group") {
        const r = walk(c, wx, wy);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(root, 0, 0);
}

function projectAssetUrl(projectPath: string, rel: string): string {
  if (rel.startsWith("data:") || rel.startsWith("http")) return rel;
  if (hasTauri()) {
    const g = globalThis as unknown as { __TAURI__?: { core?: { convertFileSrc?: (s: string) => string } } };
    const fileUrl = `${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${rel}`;
    if (g.__TAURI__?.core?.convertFileSrc) return g.__TAURI__.core.convertFileSrc(fileUrl);
    return fileUrl;
  }
  return "";
}
