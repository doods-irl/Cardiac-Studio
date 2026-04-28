import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
// Layer DnD implementation notes:
//   HTML5 drag-and-drop is unreliable in several environments (WebView2
//   on some Windows builds, extensions that intercept drag, inherited
//   `user-select: none`, custom MIME types getting dropped). We bypass
//   the platform drag API entirely and implement drag with pointer
//   events + window listeners. This is how Figma, Linear, VS Code's
//   file tree, etc. all do it — it works in every webview.
//
//   Flow:
//     mousedown on a row   → stash { id, startX, startY } in a ref
//     window mousemove     → once past a 5 px threshold, mark drag
//                            "active", position a floating ghost, and
//                            hit-test the row under the cursor via
//                            document.elementFromPoint. Set hover state.
//     window mouseup       → if active and a hover target is set, call
//                            moveElementTo. Clear all state.
//   A class `layers-dragging` on <body> forces the `grabbing` cursor
//   globally while the drag is live.
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { newId } from "@/model/ids";
import type {
  BackgroundElement, Element, ElementGroup, FrameElement, IconElement,
  ImageElement, ShapeElement, StatElement, TextElement,
} from "@/model/types";
import { DEFAULT_TEXT_STYLE } from "@/model/defaults";
import { ContextMenu, type ContextMenuItem } from "@/components/Panels/ContextMenu";
import { confirmAction } from "@/components/Shell/Dialog";
import {
  setElementClipboard, getElementClipboard, hasElementClipboard,
} from "@/io/clipboard";

type LeftTab = "card" | "layers" | "palette" | "variables";

export function LeftPanel() {
  const loaded = useDoc((s) => s.loaded);
  const [tab, setTab] = useState<LeftTab>("card");
  const mainTab = useEditor((s) => s.tab);

  if (!loaded) return null;

  // Data tab gets its own left panel — a dataset switcher — because
  // the normal design-side tabs (Card / Layers / Palette / Vars)
  // aren't what you want while wrangling records.
  if (mainTab === "data") return <div className="panel"><DatasetsView /></div>;

  const tplId = useEditor.getState().activeTemplateId;
  const tpl = loaded.project.templates.find((t) => t.id === tplId);
  const layerCount = tpl ? countElements(tpl.root) : 0;

  const varCount = (loaded.project.variables ?? []).length;

  return (
    <div className="panel">
      <div className="subtabs">
        <button className={tab === "card" ? "on" : ""} onClick={() => setTab("card")}>
          Card <span className="badge">{loaded.project.templates.length}</span>
        </button>
        <button className={tab === "layers" ? "on" : ""} onClick={() => setTab("layers")}>
          Layers <span className="badge">{layerCount}</span>
        </button>
        <button className={tab === "palette" ? "on" : ""} onClick={() => setTab("palette")}>
          Palette
        </button>
        <button className={tab === "variables" ? "on" : ""} onClick={() => setTab("variables")}>
          Vars <span className="badge">{varCount}</span>
        </button>
      </div>

      {tab === "card"      && <CardView />}
      {tab === "layers"    && <LayersView />}
      {tab === "palette"   && <PaletteView />}
      {tab === "variables" && <VariablesView />}
    </div>
  );
}

function countElements(root: Element): number {
  if (root.type !== "group") return 1;
  let n = 0;
  for (const c of root.children) n += countElements(c);
  return n;
}

// ─── Layers ─────────────────────────────────────────────────────────────

type DropPos = "child" | "before" | "after";

function LayersView() {
  const loaded = useDoc((s) => s.loaded)!;
  const tplId  = useEditor((s) => s.activeTemplateId);
  const selId  = useEditor((s) => s.selectedElementId);
  const select = useEditor((s) => s.selectElement);
  const collapsed       = useEditor((s) => s.collapsed);
  const toggleCollapsed = useEditor((s) => s.toggleCollapsed);
  const setHoveredLayer = useEditor((s) => s.setHoveredLayer);
  const updateElement = useDoc((s) => s.updateElement);
  const moveElementTo = useDoc((s) => s.moveElementTo);
  const duplicateElement = useDoc((s) => s.duplicateElement);
  const deleteElement    = useDoc((s) => s.deleteElement);
  const wrapInGroup      = useDoc((s) => s.wrapInGroup);
  const unwrapGroup      = useDoc((s) => s.unwrapGroup);
  const pasteElement     = useDoc((s) => s.pasteElement);
  const selectEl         = useEditor((s) => s.selectElement);

  // Right-click context menu state. `target` is the layer the user
  // right-clicked; `x/y` are viewport coords for the floating menu.
  const [ctx, setCtx] = useState<{ x: number; y: number; el: Element } | null>(null);

  // Inline rename state: which layer's name is being edited. When
  // non-null, the row renders an <input> in place of the static span.
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // When the canvas (or some other surface) changes the selection,
  // scroll the matching row in the layer tree into view. `block:
  // "nearest"` avoids a jarring scroll when the row is already
  // visible. We skip the effect during drag so drop-hover classes
  // don't cause auto-scroll.
  useEffect(() => {
    if (!selId) return;
    if (dragRef.current?.active) return;
    const node = document.querySelector<HTMLElement>(`[data-layer-id="${selId}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selId]);

  // Clear the canvas hover highlight when this view unmounts (e.g.
  // the user switches to the Palette subtab while the cursor happens
  // to sit on a row) — the mouseLeave handler doesn't fire in that
  // case, so the overlay would otherwise linger.
  useEffect(() => () => setHoveredLayer(null), [setHoveredLayer]);

  // Drag state: a ref for the drag itself (no re-renders per mousemove),
  // React state for the visual drop indicator and floating ghost.
  const dragRef = useRef<{
    id: string; name: string;
    startX: number; startY: number;
    active: boolean;
  } | null>(null);
  const hoverRef = useRef<{ id: string; pos: DropPos } | null>(null);
  const justDraggedRef = useRef(false);
  const [hover, _setHover] = useState<{ id: string; pos: DropPos } | null>(null);
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);

  const setHover = (h: { id: string; pos: DropPos } | null) => {
    hoverRef.current = h;
    _setHover(h);
  };

  const tpl = loaded.project.templates.find((t) => t.id === tplId);

  // Window-level drag listeners, only attached when a template exists.
  useEffect(() => {
    if (!tpl) return;
    const templateId = tpl.id;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.active) {
        if (Math.hypot(dx, dy) < 5) return;  // not enough motion yet
        d.active = true;
        document.body.classList.add("layers-dragging");
      }
      setGhost({ name: d.name, x: e.clientX, y: e.clientY });

      // Hit-test which row is under the cursor, pick a drop zone.
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const row = el?.closest("[data-layer-id]") as HTMLElement | null;
      if (!row) { setHover(null); return; }
      const targetId = row.getAttribute("data-layer-id")!;
      if (targetId === d.id) { setHover(null); return; }
      const rect = row.getBoundingClientRect();
      const pct = (e.clientY - rect.top) / rect.height;
      const pos: DropPos = pct < 0.3 ? "before" : pct > 0.7 ? "after" : "child";
      const cur = hoverRef.current;
      if (!cur || cur.id !== targetId || cur.pos !== pos) setHover({ id: targetId, pos });
    };

    const onUp = () => {
      const d = dragRef.current;
      const h = hoverRef.current;
      justDraggedRef.current = !!d?.active;
      if (d?.active && h) {
        // The layer list is rendered with each group's children in
        // reverse of the stored array (top of list = last in array =
        // rendered on top). moveElementTo's "before"/"after" operate
        // on the stored array, so "drop above in display" needs to be
        // translated to "after in stored" and vice versa.
        const storedPos: "before" | "after" | "child" =
          h.pos === "before" ? "after" :
          h.pos === "after"  ? "before" : "child";
        moveElementTo(templateId, d.id, h.id, storedPos);
        select(d.id);
      }
      dragRef.current = null;
      setGhost(null);
      setHover(null);
      document.body.classList.remove("layers-dragging");
    };

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dragRef.current) {
        dragRef.current = null;
        setGhost(null);
        setHover(null);
        document.body.classList.remove("layers-dragging");
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onEsc);
      document.body.classList.remove("layers-dragging");
    };
  }, [tpl?.id, moveElementTo, select]);

  if (!tpl) return null;

  // Flatten with parent awareness. Children are listed in REVERSE array
  // order so the top-most element (last in array, on top visually) is
  // at the top of the list.
  type Row = {
    el: Element;
    depth: number;
    isGroup: boolean;
    hasChildren: boolean;
    isCollapsed: boolean;
  };
  const rows: Row[] = [];
  const walk = (el: Element, depth: number, isChild: boolean) => {
    if (isChild) {
      const isGroup = el.type === "group";
      const hasChildren = isGroup && el.children.length > 0;
      const isCollapsed = !!collapsed[el.id];
      rows.push({ el, depth, isGroup, hasChildren, isCollapsed });
    }
    if (el.type === "group" && !(isChild && collapsed[el.id])) {
      for (let i = el.children.length - 1; i >= 0; i--) {
        walk(el.children[i], depth + 1, true);
      }
    }
  };
  walk(tpl.root, 0, false);

  const startDrag = (e: React.MouseEvent, el: Element) => {
    if (e.button !== 0) return;
    // Don't start drag when the mousedown landed on an interactive
    // control within the row — let its own click handler run.
    const t = e.target as HTMLElement;
    if (t.closest(".ctrl") || t.closest(".caret")) return;
    dragRef.current = {
      id: el.id, name: el.name,
      startX: e.clientX, startY: e.clientY,
      active: false,
    };
  };

  const onRowClick = (id: string) => {
    if (justDraggedRef.current) {
      // Swallow the click that follows a drag so we don't accidentally
      // re-select the dropped element's original position or similar.
      justDraggedRef.current = false;
      return;
    }
    select(id);
  };

  return (
    <>
      <div className="section-head">
        <span className="title">Element tree</span>
        <AddElementMenu tplId={tpl.id} />
      </div>
      <div className="panel-body layers-body" style={{ padding: 0 }}>
        {rows.length === 0 && (
          <div className="empty-hint">
            <div className="kicker">// Hint</div>
            No elements yet. Click <strong>+ Add</strong> above to drop in a Text, Shape, Image, Frame, Stat, Icon, Background, or Group.
          </div>
        )}
        {rows.map(({ el, depth, isGroup, hasChildren, isCollapsed }) => {
          const isSel = el.id === selId;
          const bound = !!el.bindings && Object.keys(el.bindings).length > 0;
          const isHover = hover?.id === el.id;
          const cls = [
            "row-item layer-row",
            isSel ? "active" : "",
            isHover && hover.pos === "child"  ? "drop-into"   : "",
            isHover && hover.pos === "before" ? "drop-before" : "",
            isHover && hover.pos === "after"  ? "drop-after"  : "",
          ].filter(Boolean).join(" ");
          return (
            <div key={el.id}
              className={cls}
              style={{ paddingLeft: 12 + depth * 14 }}
              data-layer-id={el.id}
              onMouseDown={(e) => startDrag(e, el)}
              onMouseEnter={() => {
                // Skip while the user is reordering rows — otherwise
                // every row the ghost passes over flashes its canvas
                // highlight, which is noisy and misleading.
                if (dragRef.current?.active) return;
                setHoveredLayer(el.id);
              }}
              onMouseLeave={() => {
                if (dragRef.current?.active) return;
                setHoveredLayer(null);
              }}
              onClick={() => onRowClick(el.id)}
              onDoubleClick={(e) => {
                // Only treat as rename when the dblclick landed on the
                // name span (not the caret / icons / ctrls). We read
                // the closest .name ancestor rather than using the
                // name span's own onDoubleClick so dblclick on padding
                // inside the row doesn't accidentally start a rename.
                const t = e.target as HTMLElement;
                if (t.closest(".name")) setRenamingId(el.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                select(el.id);
                setCtx({ x: e.clientX, y: e.clientY, el });
              }}>
              <button
                className={"caret " + (isGroup && hasChildren ? "" : "hidden")}
                draggable={false}
                onClick={(e) => { e.stopPropagation(); if (isGroup) toggleCollapsed(el.id); }}
                title={isCollapsed ? "Expand" : "Collapse"}>
                {isGroup && hasChildren ? (isCollapsed ? "▸" : "▾") : ""}
              </button>
              <span className="glyph">{iconFor(el.type)}</span>
              {renamingId === el.id ? (
                <InlineRename
                  initial={el.name}
                  onCommit={(name) => {
                    setRenamingId(null);
                    if (name && name !== el.name) {
                      updateElement(tpl.id, el.id, { name });
                    }
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <span className="name">
                  {el.name}
                  {bound && <span className="binding-chip small" title="has bindings">BND</span>}
                </span>
              )}
              <span className="ctrl-group" onClick={(e) => e.stopPropagation()}>
                <button className={"ctrl " + (el.hidden ? "off" : "")}
                  draggable={false}
                  title={el.hidden ? "Show" : "Hide"}
                  onClick={() => updateElement(tpl.id, el.id, { hidden: !el.hidden })}>
                  {el.hidden ? "⦸" : "◉"}
                </button>
                <button className={"ctrl " + (el.locked ? "" : "off")}
                  draggable={false}
                  title={el.locked ? "Unlock" : "Lock"}
                  onClick={() => updateElement(tpl.id, el.id, { locked: !el.locked })}>
                  {el.locked ? "▣" : "▢"}
                </button>
              </span>
            </div>
          );
        })}
      </div>
      {ghost && (
        <div className="drag-ghost"
             style={{ left: ghost.x, top: ghost.y }}>
          {ghost.name}
        </div>
      )}
      {ctx && (() => {
        const target = ctx.el;
        const isGroup = target.type === "group";
        const clipHas = hasElementClipboard();
        const items: ContextMenuItem[] = [
          {
            label: "Duplicate", glyph: "⎘", hint: "Ctrl+D",
            onSelect: () => duplicateElement(tpl.id, target.id),
          },
          {
            label: "Copy", glyph: "📋", hint: "Ctrl+C",
            onSelect: () => setElementClipboard(target),
          },
          {
            label: "Paste", glyph: "📥", hint: "Ctrl+V",
            disabled: !clipHas,
            onSelect: () => {
              const clip = getElementClipboard();
              if (!clip) return;
              const newId = pasteElement(tpl.id, clip);
              selectEl(newId);
            },
          },
          ...(isGroup ? [{
            label: "Paste inside", glyph: "📥",
            disabled: !clipHas,
            onSelect: () => {
              const clip = getElementClipboard();
              if (!clip) return;
              const newId = pasteElement(tpl.id, clip, target.id);
              selectEl(newId);
            },
          } as ContextMenuItem] : []),
          {
            separator: true,
            label: target.hidden ? "Show" : "Hide", glyph: target.hidden ? "◉" : "⦸",
            onSelect: () => updateElement(tpl.id, target.id, { hidden: !target.hidden }),
          },
          {
            label: target.locked ? "Unlock" : "Lock", glyph: target.locked ? "▢" : "▣",
            onSelect: () => updateElement(tpl.id, target.id, { locked: !target.locked }),
          },
          {
            separator: true,
            label: "Rename…", glyph: "✎", hint: "dbl-click",
            onSelect: () => setRenamingId(target.id),
          },
          isGroup
            ? {
                label: "Unwrap group", glyph: "⤴",
                onSelect: () => unwrapGroup(tpl.id, target.id),
              }
            : {
                label: "Wrap in group", glyph: "◫",
                onSelect: () => wrapInGroup(tpl.id, target.id),
              },
          {
            separator: true,
            label: "Delete", glyph: "✕", hint: "Del", danger: true,
            onSelect: () => deleteElement(tpl.id, target.id),
          },
        ];
        return <ContextMenu x={ctx.x} y={ctx.y} items={items} onClose={() => setCtx(null)} />;
      })()}
    </>
  );
}

/**
 * In-place rename input used by the layer tree. Auto-focuses on mount,
 * selects all text so the user can type-to-replace, commits on Enter
 * or blur, cancels on Escape. We keep a local draft string and only
 * propagate on commit so in-flight edits don't thrash the doc store
 * (and don't stack up in undo history).
 */
function InlineRename({
  initial, onCommit, onCancel,
}: {
  initial: string;
  onCommit: (next: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="name layer-rename"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter")      { e.preventDefault(); onCommit(draft.trim()); }
        else if (e.key === "Escape"){ e.preventDefault(); onCancel(); }
      }}
      onBlur={() => onCommit(draft.trim())}
    />
  );
}

function iconFor(type: Element["type"]): string {
  switch (type) {
    case "text": return "T";
    case "image": return "▣";
    case "shape": return "◆";
    case "background": return "▭";
    case "group": return "◫";
    case "frame": return "⬚";
    case "icon": return "★";
    case "stat": return "⬢";
    case "mask": return "⬭";
    default: return "?";
  }
}

// ─── Add element dropdown menu ──────────────────────────────────────────

const ADD_ITEMS: { icon: string; label: string; type: Element["type"] }[] = [
  { icon: "T", label: "Text",       type: "text" },
  { icon: "◆", label: "Rectangle",  type: "shape" },
  { icon: "○", label: "Ellipse",    type: "shape" },
  { icon: "▣", label: "Image",      type: "image" },
  { icon: "⬚", label: "Frame",      type: "frame" },
  { icon: "⬢", label: "Stat",       type: "stat" },
  { icon: "★", label: "Icon",       type: "icon" },
  { icon: "▭", label: "Background", type: "background" },
  { icon: "◫", label: "Group",      type: "group" },
];

function AddElementMenu({ tplId }: { tplId: string }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addEl = useDoc((s) => s.addElement);
  const select = useEditor((s) => s.selectElement);

  const open = pos !== null;

  // Outside click / Escape close. Listens on the whole window because
  // with `position: fixed` the menu lives outside the .add-menu-wrap
  // tree, so we can't rely on React's event bubbling to detect outside
  // clicks.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setPos(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    window.addEventListener("scroll", () => setPos(null), true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const push = (type: Element["type"], label: string) => {
    const factory: Record<string, (label: string) => Element> = {
      text: makeText, shape: (l) => makeShape(l === "Ellipse" ? "ellipse" : "rect"),
      image: makeImage, frame: makeFrame, stat: makeStat,
      icon: makeIcon, background: makeBackground, group: makeGroup,
    };
    const make = factory[type];
    if (!make) return;
    const el = make(label);
    addEl(tplId, el);
    select(el.id);
    setPos(null);
  };

  const toggleOpen = () => {
    if (open) { setPos(null); return; }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Start by anchoring the menu's left edge to the button's left
    // edge, drop it just below. On the next effect we'll clamp if
    // it'd overflow the viewport on the right.
    setPos({ left: rect.left, top: rect.bottom + 6 });
  };

  // After render, clamp the menu inside the viewport so it's never
  // cut off by the window edge. We can safely measure now because
  // the menu is in the DOM at position `pos` and has its real width.
  useEffect(() => {
    if (!open || !menuRef.current || !btnRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    const btn  = btnRef.current.getBoundingClientRect();
    const margin = 6;
    let left = pos.left;
    let top  = pos.top;
    if (left + menu.width + margin > window.innerWidth) {
      // Pin the menu's right edge to the button's right edge instead.
      left = Math.max(margin, btn.right - menu.width);
    }
    if (top + menu.height + margin > window.innerHeight) {
      // Flip above the button if there's no room below.
      top = Math.max(margin, btn.top - menu.height - 6);
    }
    if (left !== pos.left || top !== pos.top) setPos({ left, top });
  }, [open, pos?.left, pos?.top]);

  // The menu is rendered via a portal into `document.body` to escape
  // the Layers panel's DOM subtree. `.panel` has `container-type:
  // inline-size` (for subtab container queries), and any non-normal
  // `container-type` turns itself into the containing block for
  // `position: fixed` descendants — so without the portal, the menu
  // was anchored to the panel and clipped by it, regardless of
  // z-index. See CSS Containment spec.
  return (
    <>
      <button ref={btnRef} className="action"
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}>
        + Add
      </button>
      {open && createPortal(
        <div ref={menuRef} className="add-menu" role="menu"
          style={{ left: pos.left, top: pos.top }}>
          {ADD_ITEMS.map((it) => (
            <button key={it.label} onClick={() => push(it.type, it.label)}>
              <span className="add-menu-glyph">{it.icon}</span>
              <span>{it.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ─── Factory functions ─────────────────────────────────────────────────

function makeText(): TextElement {
  return {
    id: newId(), type: "text", name: "Text",
    x: 5, y: 5, w: 40, h: 10,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 0,
    content: "New text",
    style: { ...DEFAULT_TEXT_STYLE, color: "#111111" },
    overflow: "shrink",
    padding: { t: 0, r: 0, b: 0, l: 0 },
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeShape(shape: "rect" | "ellipse"): ShapeElement {
  return {
    id: newId(), type: "shape", name: shape === "rect" ? "Rectangle" : "Ellipse",
    x: 10, y: 10, w: 30, h: 20,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 0,
    shape,
    fill: { kind: "solid", color: "#f5d06f" },
    stroke: { color: "#000000", width: 0.3 },
    cornerRadius: shape === "rect" ? 1 : 0,
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeImage(): ImageElement {
  return {
    id: newId(), type: "image", name: "Image",
    x: 5, y: 5, w: 40, h: 40,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 0,
    fit: "cover",
    focal: { x: 0.5, y: 0.5 },
    corner: 1,
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeBackground(): BackgroundElement {
  return {
    id: newId(), type: "background", name: "Background",
    x: 0, y: 0, w: 63.5, h: 88.9,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: -10,
    fill: { kind: "solid", color: "#d9d9d9" },
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeFrame(): FrameElement {
  return {
    id: newId(), type: "frame", name: "Frame",
    x: 3, y: 3, w: 57, h: 83,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 1,
    fill: { kind: "solid", color: "#ffffff" },
    stroke: { color: "#000000", width: 0.4 },
    cornerRadius: 2,
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeStat(): StatElement {
  return {
    id: newId(), type: "stat", name: "Stat",
    x: 50, y: 5, w: 10, h: 10,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 20,
    value: 0,
    shape: "circle",
    style: { ...DEFAULT_TEXT_STYLE, weight: 800, size: 5, color: "#ffffff", align: "center", valign: "middle" },
    background: { kind: "solid", color: "#1a1a1a" },
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeIcon(): IconElement {
  return {
    id: newId(), type: "icon", name: "Icon",
    x: 5, y: 5, w: 10, h: 10,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 20,
    anchor: { x: 0.5, y: 0.5 },
  };
}
function makeGroup(): ElementGroup {
  return {
    id: newId(), type: "group", name: "Group",
    x: 10, y: 10, w: 40, h: 40,
    rotation: 0, opacity: 1, locked: false, hidden: false, zIndex: 0,
    anchor: { x: 0.5, y: 0.5 },
    children: [],
  };
}

// ─── Card (formerly Templates) ─────────────────────────────────────────

function CardView() {
  const loaded = useDoc((s) => s.loaded)!;
  const activeId = useEditor((s) => s.activeTemplateId);
  const setActive = useEditor((s) => s.setActiveTemplate);
  const addTemplate       = useDoc((s) => s.addTemplate);
  const duplicateTemplate = useDoc((s) => s.duplicateTemplate);
  const removeTemplate    = useDoc((s) => s.removeTemplate);
  const mutate            = useDoc((s) => s.mutate);

  // Right-click menu on card rows — mirrors the Layers pattern so the
  // UX is consistent across left-panel lists.
  const [ctx, setCtx] = useState<{
    x: number; y: number; tpl: { id: string; name: string };
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const templates = loaded.project.templates;

  const renameTemplate = (id: string, name: string) => {
    mutate((p) => ({
      ...p,
      project: {
        ...p.project,
        templates: p.project.templates.map((t) => t.id === id ? { ...t, name } : t),
      },
    }));
  };

  return (
    <>
      <div className="section-head">
        <span className="title">Cards</span>
        <button className="action" onClick={addTemplate}>+ New</button>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {templates.map((t) => (
          <div
            key={t.id}
            className={"row-item " + (t.id === activeId ? "active" : "")}
            onClick={() => setActive(t.id)}
            onDoubleClick={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest(".name")) setRenamingId(t.id);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setCtx({ x: e.clientX, y: e.clientY, tpl: { id: t.id, name: t.name } });
            }}>
            <span className="glyph">▤</span>
            {renamingId === t.id ? (
              <InlineRename
                initial={t.name}
                onCommit={(name) => {
                  setRenamingId(null);
                  if (name && name !== t.name) renameTemplate(t.id, name);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <span className="name">{t.name}</span>
            )}
            <span className="meta">{t.canvas.widthMm.toFixed(0)}×{t.canvas.heightMm.toFixed(0)}mm</span>
          </div>
        ))}
      </div>
      <div className="empty-hint">
        <div className="kicker">// Canvas</div>
        {templates[0]?.name} · {loaded.project.canvasDefaults.widthMm} × {loaded.project.canvasDefaults.heightMm}mm ·{" "}
        {loaded.project.canvasDefaults.dpi}dpi · {loaded.project.canvasDefaults.bleedMm}mm bleed
      </div>
      {ctx && (() => {
        const { tpl } = ctx;
        const canDelete = templates.length > 1;
        const items: ContextMenuItem[] = [
          {
            label: "Duplicate", glyph: "⎘",
            onSelect: () => {
              const newTplId = duplicateTemplate(tpl.id);
              if (newTplId) setActive(newTplId);
            },
          },
          {
            label: "Rename…", glyph: "✎", hint: "dbl-click",
            onSelect: () => setRenamingId(tpl.id),
          },
          {
            separator: true,
            label: canDelete ? "Delete" : "Delete (at least 1 card required)",
            glyph: "✕", danger: true, disabled: !canDelete,
            onSelect: async () => {
              if (!canDelete) return;
              const ok = await confirmAction({
                title: "Delete card",
                message:
                  `Delete card "${tpl.name}"? This goes into undo for the session, ` +
                  `but won't persist across restarts.`,
                okLabel: "Delete",
                danger: true,
              });
              if (!ok) return;
              removeTemplate(tpl.id);
              // If we just deleted the active one, pick another.
              if (tpl.id === activeId) {
                const next = templates.find((t) => t.id !== tpl.id);
                setActive(next?.id ?? null);
              }
            },
          },
        ];
        return <ContextMenu x={ctx.x} y={ctx.y} items={items} onClose={() => setCtx(null)} />;
      })()}
    </>
  );
}

// ─── Palette ──────────────────────────────────────────────────────────

function PaletteView() {
  const loaded = useDoc((s) => s.loaded)!;
  const selectedElId  = useEditor((s) => s.selectedElementId);
  const activeTplId   = useEditor((s) => s.activeTemplateId);
  const addPaletteColor       = useDoc((s) => s.addPaletteColor);
  const removePaletteColor    = useDoc((s) => s.removePaletteColor);
  const updatePaletteColor    = useDoc((s) => s.updatePaletteColor);
  const duplicatePaletteColor = useDoc((s) => s.duplicatePaletteColor);
  const updateElement         = useDoc((s) => s.updateElement);
  const [flash, setFlash]     = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{
    x: number; y: number; entry: { id: string; name: string; hex: string };
  } | null>(null);

  const palette = loaded.project.palette;

  /** Click: apply hex to the selected element's primary colour.
   *  Shift-click: delete the swatch. */
  const onApply = (c: { id: string; hex: string }, e: React.MouseEvent) => {
    if (e.shiftKey) { removePaletteColor(c.id); return; }
    if (!activeTplId || !selectedElId) {
      // No selection — flash "copied" and copy the hex as a useful fallback.
      setFlash(c.hex);
      setTimeout(() => setFlash((f) => (f === c.hex ? null : f)), 900);
      navigator.clipboard?.writeText(c.hex).catch(() => { /* denied */ });
      return;
    }
    const tpl = loaded.project.templates.find((t) => t.id === activeTplId);
    const el = tpl ? findInTree(tpl.root, selectedElId) : null;
    if (!el) return;
    const patch = primaryColorPatch(el, c.hex);
    if (patch) updateElement(activeTplId, el.id, patch);
  };

  const onAdd = () => {
    // Seed a random mid-tone hex so the user has something non-white
    // to start editing; focus the new swatch's name field.
    const hex = "#" + Math.floor(Math.random() * 0xcccccc + 0x333333).toString(16).padStart(6, "0");
    const id = addPaletteColor(hex);
    setFocusId(id);
  };

  return (
    <>
      <div className="section-head">
        <span className="title">Palette</span>
        <button className="action" title="Add a new swatch"
          onClick={onAdd}>+ Add</button>
      </div>
      <div className="empty-hint" style={{ padding: "6px 20px 8px 20px", marginBottom: 0 }}>
        Click a chip to apply it; shift-click to remove; right-click for
        more options (duplicate for quick variations). Double-click to
        recolour; rename inline.
      </div>
      <div style={{ padding: "4px 20px 20px 20px" }}>
        <div className="swatch-grid">
          {palette.map((c) => (
            <PaletteSwatch
              key={c.id}
              entry={c}
              flash={flash === c.hex}
              autoFocus={focusId === c.id}
              onApply={(e) => onApply(c, e)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtx({ x: e.clientX, y: e.clientY, entry: c });
              }}
              onRename={(name) => {
                updatePaletteColor(c.id, { name });
                setFocusId(null);
              }}
              onRecolour={(hex) => updatePaletteColor(c.id, { hex })}
            />
          ))}
        </div>
      </div>
      {ctx && (() => {
        const { entry } = ctx;
        const items: ContextMenuItem[] = [
          {
            label: "Duplicate", glyph: "⎘",
            onSelect: () => {
              const newIdValue = duplicatePaletteColor(entry.id);
              if (newIdValue) setFocusId(newIdValue);
            },
          },
          {
            label: "Rename…", glyph: "✎",
            onSelect: () => setFocusId(entry.id),
          },
          {
            label: "Recolour…", glyph: "◉",
            onSelect: () => {
              // Trigger the hidden native color picker on the swatch.
              const node = document.querySelector(
                `[data-swatch-id="${entry.id}"] input[type="color"]`,
              ) as HTMLInputElement | null;
              node?.click();
            },
          },
          {
            separator: true,
            label: "Delete", glyph: "✕", danger: true,
            onSelect: () => removePaletteColor(entry.id),
          },
        ];
        return <ContextMenu x={ctx.x} y={ctx.y} items={items} onClose={() => setCtx(null)} />;
      })()}
    </>
  );
}

function PaletteSwatch({
  entry, flash, autoFocus, onApply, onContextMenu, onRename, onRecolour,
}: {
  entry: { id: string; name: string; hex: string };
  flash: boolean;
  autoFocus: boolean;
  onApply: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRename: (name: string) => void;
  onRecolour: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [autoFocus]);
  const [draft, setDraft] = useState(entry.name);
  useEffect(() => setDraft(entry.name), [entry.name]);
  const commit = () => {
    if (draft.trim() && draft !== entry.name) onRename(draft.trim());
    else setDraft(entry.name);
  };
  return (
    <div className="swatch-item" title={`${entry.name} · ${entry.hex}`}
      data-swatch-id={entry.id}
      onContextMenu={onContextMenu}>
      <button
        className="swatch-chip"
        style={{ background: entry.hex }}
        onClick={onApply}
        onDoubleClick={(e) => {
          // Open the native color picker by clicking the hidden input.
          const root = (e.currentTarget.parentElement as HTMLElement | null);
          const picker = root?.querySelector('input[type="color"]') as HTMLInputElement | null;
          picker?.click();
        }}
        title="Click to apply · shift-click to remove · double-click to recolour · right-click for more"
      >
        {flash && <span className="swatch-copied">COPIED</span>}
      </button>
      <input
        className="swatch-color-input"
        type="color"
        value={entry.hex}
        onChange={(e) => onRecolour(e.target.value)}
        aria-label="Swatch colour"
      />
      <input
        ref={inputRef}
        className="swatch-name-input"
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setDraft(entry.name); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <div className="swatch-hex">{entry.hex.toUpperCase()}</div>
    </div>
  );
}

// ─── Variables (own subtab) ────────────────────────────────────────────

function VariablesView() {
  const loaded = useDoc((s) => s.loaded)!;
  const selectedVarId = useEditor((s) => s.selectedVariableId);
  const selectVar   = useEditor((s) => s.selectVariable);
  const addVariable = useDoc((s) => s.addVariable);
  const variables = loaded.project.variables ?? [];

  return (
    <>
      <div className="section-head">
        <span className="title">Variables</span>
        <button className="action" onClick={() => {
          const id = addVariable();
          selectVar(id);
        }}>+ New</button>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {variables.length === 0 && (
          <div className="empty-hint">
            <div className="kicker">// Hint</div>
            Variables are named lookup tables — map rarity → image, faction → colour, etc.
            Bind an element property through a variable in the element's Bindings tab.
          </div>
        )}
        {variables.map((v) => (
          <div key={v.id}
            className={"row-item " + (v.id === selectedVarId ? "active" : "")}
            onClick={() => selectVar(v.id)}>
            <span className="glyph">𝑥</span>
            <span className="name">{v.name}</span>
            <span className="meta">{v.valueType}/{v.keyType} · {Object.keys(v.entries).length}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Palette helpers ───────────────────────────────────────────────────

function findInTree(root: Element, id: string): Element | null {
  if (root.id === id) return root;
  if (root.type === "group") {
    for (const c of root.children) {
      const r = findInTree(c, id);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Build the patch that applies `hex` as the element's "primary" colour,
 * picking the property most likely to match user intent per type:
 *   - text / stat: text colour
 *   - shape / frame / background: fill colour
 *   - image: border colour (if present), else no-op
 *   - icon: tint
 */
function primaryColorPatch(el: Element, hex: string): Partial<Element> | null {
  switch (el.type) {
    case "text":
      return { style: { ...(el as TextElement).style, color: hex } } as any;
    case "stat":
      return { style: { ...(el as StatElement).style, color: hex } } as any;
    case "shape":
    case "frame":
    case "background":
      return { fill: { kind: "solid", color: hex } } as any;
    case "icon":
      return { tint: hex } as any;
    case "image": {
      const img = el as ImageElement;
      if (img.border) return { border: { ...img.border, color: hex } } as any;
      return null;
    }
    default:
      return null;
  }
}

// ─── Data-tab dataset switcher ─────────────────────────────────────────

function DatasetsView() {
  const loaded = useDoc((s) => s.loaded)!;
  const activeDatasetId = useEditor((s) => s.activeDatasetId);
  const setActiveDataset = useEditor((s) => s.setActiveDataset);
  const addDataset = useDoc((s) => s.addDataset);
  const mutate = useDoc((s) => s.mutate);
  const activeTplId = useEditor((s) => s.activeTemplateId);

  const datasets = loaded.project.datasets;
  const tpl = loaded.project.templates.find((t) => t.id === activeTplId);
  // The grid's fallback: when no activeDatasetId is set, it shows the
  // active template's attached dataset. Highlight that one so users
  // aren't confused about what they're editing.
  const effectiveId = activeDatasetId ?? tpl?.datasetId ?? null;
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const renameDataset = (id: string, name: string) => {
    mutate((p) => ({
      ...p,
      project: {
        ...p.project,
        datasets: p.project.datasets.map((d) => d.id === id ? { ...d, name } : d),
      },
    }));
  };

  return (
    <>
      <div className="section-head">
        <span className="title">Datasets</span>
        <button className="action" onClick={() => {
          const id = addDataset();
          setActiveDataset(id);
        }}>+ New</button>
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        {datasets.length === 0 && (
          <div className="empty-hint">
            <div className="kicker">// Hint</div>
            No datasets yet — click <strong>+ New</strong> to create one.
          </div>
        )}
        {datasets.map((ds) => {
          const isActive = ds.id === effectiveId;
          const rowCount = (loaded.records[ds.id] ?? []).length;
          return (
            <div key={ds.id}
              className={"row-item " + (isActive ? "active" : "")}
              onClick={() => setActiveDataset(ds.id)}
              onDoubleClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(".name")) setRenamingId(ds.id);
              }}>
              <span className="glyph">▦</span>
              {renamingId === ds.id ? (
                <InlineRename
                  initial={ds.name}
                  onCommit={(name) => {
                    setRenamingId(null);
                    if (name && name !== ds.name) renameDataset(ds.id, name);
                  }}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <span className="name">{ds.name}</span>
              )}
              <span className="meta">{ds.fields.length} col{ds.fields.length === 1 ? "" : "s"} · {rowCount} row{rowCount === 1 ? "" : "s"}</span>
            </div>
          );
        })}
      </div>
      <div className="empty-hint" style={{ borderTop: "1px solid var(--line)" }}>
        <div className="kicker">// Hint</div>
        Click a dataset to edit its records. The active template still
        renders against its own attached dataset — use the Canvas panel
        (design tab) to change which dataset drives the cards.
      </div>
    </>
  );
}
