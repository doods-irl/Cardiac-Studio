import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import type {
  Element, TextElement, ImageElement, ShapeElement, Binding, Effect,
  Variable, BackgroundElement, FrameElement, StatElement, Fill,
} from "@/model/types";
import { findElement } from "@/model/selectors";
import { listFamilies, weightsForFamily } from "@/model/fonts";
import { importImage } from "@/engine/format/assets";
import { IconAutocompleteTextarea } from "./IconAutocompleteTextarea";
import { CsvListInput } from "./CsvListInput";
import { DragNumber } from "./DragNumber";
import { AnchorPicker } from "./AnchorPicker";
import { AlignButtons, computeAlign, type AlignDir } from "./AlignButtons";
import { CARD_PRESETS } from "@/model/cardPresets";
import { Icon } from "@/components/Shell/Icons";
import { PalettePicker } from "./PalettePicker";
import { confirmAction } from "@/components/Shell/Dialog";

type InnerTab = "props" | "bind" | "fx";

export function RightPanel() {
  const loaded = useDoc((s) => s.loaded);
  const tplId  = useEditor((s) => s.activeTemplateId);
  const selId  = useEditor((s) => s.selectedElementId);
  const selVar = useEditor((s) => s.selectedVariableId);

  const tpl = loaded?.project.templates.find((t) => t.id === tplId);
  const el  = useMemo(() => tpl && selId ? findElement(tpl.root, selId) : undefined, [tpl, selId]);

  if (!loaded || !tpl) return null;
  if (selVar) return <VariableEditorPanel variableId={selVar} />;
  if (!el)    return <CanvasProps />;
  return <ElementInspector el={el} />;
}

// ─── Inner tabs ────────────────────────────────────────────────────────

function InnerTabs({ tab, setTab, bindCount }: {
  tab: InnerTab; setTab: (t: InnerTab) => void; bindCount: number;
}) {
  return (
    <div className="subtabs">
      <button className={tab === "props" ? "on" : ""} onClick={() => setTab("props")}>
        Properties
      </button>
      <button className={tab === "bind" ? "on" : ""} onClick={() => setTab("bind")}>
        Bindings <span className="badge">{bindCount}</span>
      </button>
      <button className={tab === "fx" ? "on" : ""} onClick={() => setTab("fx")}>
        Effects
      </button>
    </div>
  );
}

// ─── Element inspector ────────────────────────────────────────────────

function ElementInspector({ el }: { el: Element }) {
  const [tab, setTab] = useState<InnerTab>("props");
  const bindCount = Object.keys(el.bindings ?? {}).length;
  return (
    <div className="panel">
      <InnerTabs tab={tab} setTab={setTab} bindCount={bindCount} />
      {tab === "props" && <PropsTab el={el} />}
      {tab === "bind"  && <BindingsTab el={el} />}
      {tab === "fx"    && <EffectsTab el={el} />}
    </div>
  );
}

function PropsTab({ el }: { el: Element }) {
  return (
    <>
      <div className="section-head">
        <span className="title">{el.name}</span>
        <span className="count">{el.type.toUpperCase()}</span>
      </div>

      <div className="prop-section">
        <div className="prop-head">
          <span>Transform</span>
          <span className="muted">mm</span>
        </div>
        <div className="prop-body">
          <div className="xywh">
            <div><div className="k">X</div>
              <DragNumber value={el.x} step={0.1}
                onChange={(v) => updateField(el, { x: v } as any)} />
            </div>
            <div><div className="k">Y</div>
              <DragNumber value={el.y} step={0.1}
                onChange={(v) => updateField(el, { y: v } as any)} />
            </div>
            <div><div className="k">W</div>
              <DragNumber value={el.w} step={0.1} min={0.1}
                onChange={(v) => resizeW(el, v)} />
            </div>
            <div><div className="k">H</div>
              <DragNumber value={el.h} step={0.1} min={0.1}
                onChange={(v) => resizeH(el, v)} />
            </div>
          </div>

          <div className="prop-row" style={{ marginTop: 10 }}>
            <label>Rotate</label>
            <DragNumber value={el.rotation} step={1} unit="°"
              onChange={(v) => updateField(el, { rotation: v } as any)} />
          </div>
          <div className="prop-row">
            <label>Opacity</label>
            <DragNumber value={el.opacity} step={0.01} min={0} max={1}
              onChange={(v) => updateField(el, { opacity: v } as any)} />
          </div>

          <div className="prop-row" style={{ alignItems: "flex-start" }}>
            <label>Anchor</label>
            <AnchorPicker
              value={el.anchor ?? { x: 0.5, y: 0.5 }}
              onChange={(a) => updateField(el, { anchor: a } as any)} />
          </div>
          <div className="prop-row" style={{ alignItems: "flex-start" }}>
            <label>Align to canvas</label>
            <AlignToCanvasRow el={el} />
          </div>
        </div>
      </div>

      {el.type === "text"       && <TextSection el={el as TextElement} />}
      {el.type === "shape"      && <ShapeSection el={el as ShapeElement} />}
      {el.type === "image"      && <ImageSection el={el as ImageElement} />}
      {el.type === "background" && <BgSection el={el as BackgroundElement} />}
      {el.type === "frame"      && <FrameSection el={el as FrameElement} />}
      {el.type === "stat"       && <StatSection el={el as StatElement} />}
    </>
  );
}

function TextSection({ el }: { el: TextElement }) {
  const loaded = useDoc((s) => s.loaded)!;
  const families = listFamilies(loaded.project.fonts.map((f) => f.family));
  const weights  = weightsForFamily(el.style.family, loaded.project.fonts);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const setStyle = (patch: Partial<TextElement["style"]>) =>
    updateField(el, { style: { ...el.style, ...patch } } as any);

  // Auto-repair: if the element's stored font family is no longer
  // available (e.g. the user deleted a bundled font, or imported one
  // for the first time so the list went from "Arial fallback" to
  // "honeyblot_caps"), switch it to the first available so the
  // picker and canvas stay in sync. Without this the <select> shows
  // the first option visually but the underlying value is stale, and
  // the canvas keeps rendering the old (potentially unregistered,
  // falling-back-to-serif) family.
  useEffect(() => {
    if (families.length === 0) return;
    if (!families.includes(el.style.family)) {
      setStyle({ family: families[0] });
    }
  }, [el.id, el.style.family, families.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Wrap the current selection in the textarea with `[open]…[close]`
   * markup tags, or — if no selection — insert empty tags at the
   * caret and land the caret between them so the user can type inside.
   * Re-focuses the textarea and restores a sensible selection after
   * the external `onChange` state round-trip.
   */
  const wrap = (open: string, close: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? start;
    const content = el.content ?? "";
    const before = content.slice(0, start);
    const mid = content.slice(start, end);
    const after = content.slice(end);
    const next = `${before}${open}${mid}${close}${after}`;
    updateField(el, { content: next } as any);
    requestAnimationFrame(() => {
      ta.focus();
      if (mid.length === 0) {
        const caret = start + open.length;
        ta.setSelectionRange(caret, caret);
      } else {
        ta.setSelectionRange(start + open.length, end + open.length);
      }
    });
  };

  return (
    <div className="prop-section">
      <div className="prop-head"><span>Text</span></div>
      <div className="prop-body">
        {/* Rich-text formatting toolbar. Buttons wrap the current
            selection with inline markup; the renderer applies the
            styles per-run. Tags: [b][/b] · [i][/i] · [u][/u] ·
            [c=#hex][/c]. Right-click / context menu isn't wired yet —
            kept always-visible for discoverability. */}
        <div className="rich-toolbar">
          <button className="rt-btn" title="Bold · [b]…[/b]"
            onClick={() => wrap("[b]", "[/b]")}><b>B</b></button>
          <button className="rt-btn" title="Italic · [i]…[/i]"
            onClick={() => wrap("[i]", "[/i]")}><i>I</i></button>
          <button className="rt-btn" title="Underline · [u]…[/u]"
            onClick={() => wrap("[u]", "[/u]")}><u>U</u></button>
          <label className="rt-btn rt-color" title="Colour · [c=#hex]…[/c]">
            <span>●</span>
            <input type="color" onChange={(e) => wrap(`[c=${e.target.value}]`, "[/c]")} />
          </label>
          {loaded.project.palette.length > 0 && (
            <select className="rt-palette" defaultValue=""
              title="Wrap the selection in a palette colour"
              onChange={(e) => {
                const hex = e.target.value;
                if (!hex) return;
                wrap(`[c=${hex}]`, "[/c]");
                e.currentTarget.selectedIndex = 0;
              }}>
              <option value="">Palette…</option>
              {loaded.project.palette.map((c) => (
                <option key={c.id} value={c.hex}>{c.name} ({c.hex})</option>
              ))}
            </select>
          )}
        </div>
        <div className="prop-row" style={{ gridTemplateColumns: "80px 1fr", alignItems: "flex-start" }}>
          <label>Content</label>
          <IconAutocompleteTextarea
            rows={3}
            value={el.content}
            onChange={(v) => updateField(el, { content: v } as any)}
            icons={loaded.project.icons ?? []}
            assets={loaded.project.assets}
            textareaRef={taRef}
          />
        </div>
        <div className="prop-row">
          <label>Font</label>
          <select value={el.style.family} onChange={(e) => setStyle({ family: e.target.value })}>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="prop-row">
          <label>Weight</label>
          <select value={el.style.weight} onChange={(e) => setStyle({ weight: Number(e.target.value) })}>
            {(weights.length ? weights : [400, 700]).map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="prop-row">
          <label>Size</label>
          <DragNumber value={el.style.size} step={0.25} min={0.5} unit="mm"
            onChange={(v) => setStyle({ size: v })} />
        </div>
        <div className="prop-row">
          <label>Colour</label>
          <div className="control">
            <PalettePicker value={el.style.color}
              onChange={(hex) => setStyle({ color: hex })} />
            <input type="text" style={{ flex: 1 }} value={el.style.color}
              onChange={(e) => setStyle({ color: e.target.value })} />
          </div>
        </div>
        <div className="prop-row">
          <label>Align</label>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            {(["left","center","right","justify"] as const).map((a) => (
              <button key={a} className={el.style.align === a ? "on" : ""}
                onClick={() => setStyle({ align: a })}
                title={`Align ${a}`}>
                <Icon name={
                  a === "left" ? "textAlignLeft" :
                  a === "center" ? "textAlignCenter" :
                  a === "right" ? "textAlignRight" : "textAlignJustify"
                } size={14} />
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>V-align</label>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {(["top","middle","bottom"] as const).map((v) => (
              <button key={v} className={el.style.valign === v ? "on" : ""}
                onClick={() => setStyle({ valign: v })}
                title={`Align ${v}`}>
                <Icon name={
                  v === "top" ? "alignTop" :
                  v === "middle" ? "alignMiddleV" : "alignBottom"
                } size={14} />
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>Overflow</label>
          <div className="seg" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
            {(["wrap","shrink","clip","ellipsis","scale"] as const).map((o) => (
              <button key={o} className={el.overflow === o ? "on" : ""}
                onClick={() => updateField(el, { overflow: o } as any)}>
                {o === "ellipsis" ? "…" : o === "shrink" ? "S" : o === "wrap" ? "W" : o === "clip" ? "C" : "Sc"}
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>Icon mm</label>
          <DragNumber value={el.style.inlineIconSize ?? el.style.size}
            step={0.25} min={0.5}
            onChange={(v) => setStyle({ inlineIconSize: v })} />
        </div>
        <div className="prop-row">
          <label>Icon align</label>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {(["baseline", "center", "top"] as const).map((a) => (
              <button key={a}
                className={(el.style.inlineIconAlign ?? "center") === a ? "on" : ""}
                onClick={() => setStyle({ inlineIconAlign: a })}
                title={`Align inline icons ${a}`}>
                {a[0].toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>Stroke</label>
          <div className="control">
            <PalettePicker value={el.style.stroke?.color ?? "#000000"}
              onChange={(hex) => setStyle({ stroke: { color: hex, width: el.style.stroke?.width ?? 0 } })} />
            <DragNumber value={el.style.stroke?.width ?? 0} step={0.05} min={0} unit="mm"
              onChange={(v) => setStyle({ stroke: { color: el.style.stroke?.color ?? "#000000", width: v } })} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ShapeSection({ el }: { el: ShapeElement }) {
  return (
    <div className="prop-section">
      <div className="prop-head"><span>Shape</span></div>
      <div className="prop-body">
        <div className="prop-row">
          <label>Type</label>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {(["rect","ellipse","path"] as const).map((s) => (
              <button key={s} className={el.shape === s ? "on" : ""}
                onClick={() => updateField(el, { shape: s } as any)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>Fill</label>
          <div className="control">
            <PalettePicker value={el.fill?.kind === "solid" ? (el.fill as any).color : "#cccccc"}
              onChange={(hex) => updateField(el, {
                fill: { ...(el.fill ?? {}), kind: "solid", color: hex },
              } as any)} />
            <input type="text" style={{ flex: 1 }}
              value={el.fill?.kind === "solid" ? (el.fill as any).color.toUpperCase() : ""}
              onChange={(e) => updateField(el, {
                fill: { ...(el.fill ?? {}), kind: "solid", color: e.target.value },
              } as any)} />
          </div>
        </div>
        <div className="prop-row">
          <label>Fill α</label>
          <DragNumber value={fillOpacity(el.fill)} step={0.02} min={0} max={1}
            onChange={(v) => updateField(el, {
              fill: withFillOpacity(el.fill ?? { kind: "solid", color: "#cccccc" }, v),
            } as any)} />
        </div>
        <div className="prop-row">
          <label>Stroke</label>
          <div className="control">
            <PalettePicker value={el.stroke?.color ?? "#000000"}
              onChange={(hex) => updateField(el, {
                stroke: { ...(el.stroke ?? { width: 0.3 }), color: hex },
              } as any)} />
            <input type="text" style={{ flex: 1 }}
              value={(el.stroke?.color ?? "#000000").toUpperCase()}
              onChange={(e) => updateField(el, {
                stroke: { ...(el.stroke ?? { width: 0.3 }), color: e.target.value },
              } as any)} />
          </div>
        </div>
        <div className="prop-row">
          <label>Stroke w</label>
          <DragNumber value={el.stroke?.width ?? 0} step={0.1} min={0} unit="mm"
            onChange={(v) => updateField(el, {
              stroke: { ...(el.stroke ?? { color: "#000000" }), width: v },
            } as any)} />
        </div>
        <div className="prop-row">
          <label>Stroke α</label>
          <DragNumber value={el.stroke?.opacity ?? 1} step={0.02} min={0} max={1}
            onChange={(v) => updateField(el, {
              stroke: {
                ...(el.stroke ?? { color: "#000000", width: 0.3 }),
                opacity: v >= 1 ? undefined : v,
              },
            } as any)} />
        </div>
        <div className="prop-row">
          <label>Corner</label>
          <DragNumber value={el.cornerRadius ?? 0} step={0.25} min={0} unit="mm"
            onChange={(v) => updateField(el, { cornerRadius: v } as any)} />
        </div>
      </div>
    </div>
  );
}

function ImageSection({ el }: { el: ImageElement }) {
  const loaded = useDoc((s) => s.loaded)!;
  const addAsset = useDoc((s) => s.addAsset);
  const assets = loaded.project.assets.filter((a) => a.kind === "image");
  return (
    <div className="prop-section">
      <div className="prop-head"><span>Image</span></div>
      <div className="prop-body">
        <div className="prop-row">
          <label>Asset</label>
          <div className="control">
            <select value={el.assetId ?? ""} style={{ flex: 1 }}
              onChange={(e) => updateField(el, { assetId: e.target.value || undefined } as any)}>
              <option value="">— none —</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.originalName}</option>)}
            </select>
            <button className="icon-btn" title="Import image…"
              onClick={async () => {
                const a = await importImage(loaded.path);
                if (!a) return;
                addAsset(a);
                updateField(el, { assetId: a.id } as any);
              }}>↑</button>
          </div>
        </div>
        <div className="prop-row">
          <label>Fit</label>
          <div className="seg" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            {(["contain","cover","stretch","crop"] as const).map((f) => (
              <button key={f} className={el.fit === f ? "on" : ""}
                onClick={() => updateField(el, { fit: f } as any)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>Corner</label>
          <DragNumber value={el.corner} step={0.25} min={0} unit="mm"
            onChange={(v) => updateField(el, { corner: v } as any)} />
        </div>
        <div className="prop-row">
          <label>Alpha ▦</label>
          <div className="control">
            <PalettePicker value={el.alphaStroke?.color ?? "#000000"}
              onChange={(hex) => updateField(el, {
                alphaStroke: { ...(el.alphaStroke ?? { width: 0.4 }), color: hex },
              } as any)} />
            <DragNumber value={el.alphaStroke?.width ?? 0} step={0.05} min={0} unit="mm"
              onChange={(w) => updateField(el, {
                alphaStroke: w > 0 ? { color: el.alphaStroke?.color ?? "#000000", width: w } : undefined,
              } as any)} />
          </div>
        </div>

        {/* Hue / tint recolour: greyscale the image and tint with one
            hex. `strength` controls the mix — 0 unchanged, 1 fully
            desaturated-and-tinted. Pair with a palette binding on the
            tint colour for per-variant recolouring. */}
        <div className="prop-row">
          <label>Tint hue</label>
          <div className="control">
            <PalettePicker
              value={el.filter?.tint?.color ?? "#888888"}
              onChange={(hex) => updateField(el, {
                filter: {
                  ...(el.filter ?? {}),
                  tint: { color: hex, strength: el.filter?.tint?.strength ?? 1 },
                },
              } as any)} />
            <DragNumber
              value={el.filter?.tint?.strength ?? 0}
              step={0.05} min={0} max={1}
              onChange={(strength) => updateField(el, {
                filter: {
                  ...(el.filter ?? {}),
                  tint: strength > 0
                    ? { color: el.filter?.tint?.color ?? "#888888", strength }
                    : undefined,
                },
              } as any)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function BgSection({ el }: { el: BackgroundElement }) {
  const color = el.fill?.kind === "solid" ? el.fill.color : "#ffffff";
  return (
    <div className="prop-section">
      <div className="prop-head"><span>Background</span></div>
      <div className="prop-body">
        <div className="prop-row">
          <label>Colour</label>
          <div className="control">
            <PalettePicker value={color}
              onChange={(hex) => updateField(el, {
                fill: { ...(el.fill ?? {}), kind: "solid", color: hex },
              } as any)} />
            <input type="text" style={{ flex: 1 }} value={color.toUpperCase()}
              onChange={(e) => updateField(el, {
                fill: { ...(el.fill ?? {}), kind: "solid", color: e.target.value },
              } as any)} />
          </div>
        </div>
        <div className="prop-row">
          <label>Fill α</label>
          <DragNumber value={fillOpacity(el.fill)} step={0.02} min={0} max={1}
            onChange={(v) => updateField(el, {
              fill: withFillOpacity(el.fill ?? { kind: "solid", color: "#ffffff" }, v),
            } as any)} />
        </div>
      </div>
    </div>
  );
}

function FrameSection({ el }: { el: FrameElement }) {
  return (
    <div className="prop-section">
      <div className="prop-head"><span>Frame</span></div>
      <div className="prop-body">
        <div className="prop-row">
          <label>Fill</label>
          <div className="control">
            <PalettePicker value={el.fill?.kind === "solid" ? el.fill.color : "#ffffff"}
              onChange={(hex) => updateField(el, {
                fill: { ...(el.fill ?? {}), kind: "solid", color: hex },
              } as any)} />
            <input type="text" style={{ flex: 1 }}
              value={el.fill?.kind === "solid" ? (el.fill as any).color : ""}
              onChange={(e) => updateField(el, {
                fill: { ...(el.fill ?? {}), kind: "solid", color: e.target.value },
              } as any)} />
          </div>
        </div>
        <div className="prop-row">
          <label>Fill α</label>
          <DragNumber value={fillOpacity(el.fill)} step={0.02} min={0} max={1}
            onChange={(v) => updateField(el, {
              fill: withFillOpacity(el.fill ?? { kind: "solid", color: "#ffffff" }, v),
            } as any)} />
        </div>
        <div className="prop-row">
          <label>Stroke</label>
          <div className="control">
            <PalettePicker value={el.stroke?.color ?? "#000000"}
              onChange={(hex) => updateField(el, {
                stroke: { ...(el.stroke ?? { width: 0.4 }), color: hex },
              } as any)} />
            <DragNumber value={el.stroke?.width ?? 0} step={0.05} min={0} unit="mm"
              onChange={(v) => updateField(el, {
                stroke: { ...(el.stroke ?? { color: "#000000" }), width: v },
              } as any)} />
          </div>
        </div>
        <div className="prop-row">
          <label>Stroke α</label>
          <DragNumber value={el.stroke?.opacity ?? 1} step={0.02} min={0} max={1}
            onChange={(v) => updateField(el, {
              stroke: {
                ...(el.stroke ?? { color: "#000000", width: 0.4 }),
                opacity: v >= 1 ? undefined : v,
              },
            } as any)} />
        </div>
        <div className="prop-row">
          <label>Corner</label>
          <DragNumber value={el.cornerRadius ?? 0} step={0.25} min={0} unit="mm"
            onChange={(v) => updateField(el, { cornerRadius: v } as any)} />
        </div>
      </div>
    </div>
  );
}

function StatSection({ el }: { el: StatElement }) {
  return (
    <div className="prop-section">
      <div className="prop-head"><span>Stat</span></div>
      <div className="prop-body">
        <div className="prop-row">
          <label>Value</label>
          <DragNumber value={el.value} step={1} integer
            onChange={(v) => updateField(el, { value: v } as any)} />
        </div>
        <div className="prop-row">
          <label>Shape</label>
          <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            {(["circle","diamond","shield","rect"] as const).map((s) => (
              <button key={s} className={el.shape === s ? "on" : ""}
                onClick={() => updateField(el, { shape: s } as any)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="prop-row">
          <label>BG</label>
          <div className="control">
            <PalettePicker value={el.background?.kind === "solid" ? el.background.color : "#1a1a1a"}
              onChange={(hex) => updateField(el, {
                background: { ...(el.background ?? {}), kind: "solid", color: hex },
              } as any)} />
          </div>
        </div>
        <div className="prop-row">
          <label>BG α</label>
          <DragNumber value={fillOpacity(el.background)} step={0.02} min={0} max={1}
            onChange={(v) => updateField(el, {
              background: withFillOpacity(el.background ?? { kind: "solid", color: "#1a1a1a" }, v),
            } as any)} />
        </div>
      </div>
    </div>
  );
}

// ─── Bindings tab ──────────────────────────────────────────────────────

function BindingsTab({ el }: { el: Element }) {
  const loaded = useDoc((s) => s.loaded)!;
  const tplId  = useEditor.getState().activeTemplateId!;
  const tpl    = loaded.project.templates.find((t) => t.id === tplId)!;
  const ds     = tpl.datasetId ? loaded.project.datasets.find((d) => d.id === tpl.datasetId) : undefined;
  const bindings = el.bindings ?? {};
  const variables = loaded.project.variables ?? [];
  const palette = loaded.project.palette ?? [];
  const targetProps = targetsFor(el);

  const update = (path: string, patch: Partial<Binding> | null) => {
    const cur = { ...(el.bindings ?? {}) } as Record<string, Binding>;
    if (patch === null) delete cur[path];
    else cur[path] = { ...(cur[path] ?? {}), ...patch };
    updateField(el, { bindings: cur } as any);
  };
  const setVariable = (path: string, variableId: string | null) => {
    const b = bindings[path] ?? {};
    const other = (b.transforms ?? []).filter((t) => t.kind !== "var");
    if (variableId) update(path, { transforms: [...other, { kind: "var", variableId }] });
    else            update(path, { transforms: other.length ? other : undefined });
  };

  return (
    <>
      <div className="section-head">
        <span className="title">Bindings</span>
        <span className="count">{ds?.name ?? "no dataset"}</span>
      </div>
      <div className="prop-body" style={{ background: "var(--bg-2)" }}>
        {!ds && (
          <div className="empty-hint" style={{ padding: "4px 0" }}>
            Attach a dataset to this template (Canvas settings) to wire up bindings.
          </div>
        )}
        {ds && targetProps.map((tp) => {
          const b = bindings[tp];
          const currentVar = b?.transforms?.find((t) => t.kind === "var")?.variableId ?? "";
          const isColourTarget = /color$/i.test(tp) || tp === "tint";
          return (
            <div key={tp} className="binding-row">
              <div className="bhead">
                <span className="prop-name">{tp}</span>
                {b?.paletteId
                  ? <span className="binding-chip">PALETTE</span>
                  : b
                    ? <span className="binding-chip">LIVE</span>
                    : <span className="static-tag">STATIC</span>}
                {b && <button className="rm" onClick={() => update(tp, null)}>×</button>}
              </div>
              <select value={b?.field ?? ""}
                disabled={!!b?.paletteId}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) update(tp, null);
                  else update(tp, { field: v, paletteId: undefined });
                }}>
                <option value="">— static —</option>
                {ds.fields.map((f) => (
                  <option key={f.id} value={f.name}>{f.name}  ·  {f.type}</option>
                ))}
              </select>
              {variables.length > 0 && (
                <div className="transforms">
                  <select value={currentVar}
                    disabled={!!b?.paletteId}
                    onChange={(e) => setVariable(tp, e.target.value || null)}
                    style={{ flex: 1, minWidth: 0 }}>
                    <option value="">via —</option>
                    {variables.map((v) => (
                      <option key={v.id} value={v.id}>via {v.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {(isColourTarget || b?.paletteId) && palette.length > 0 && (
                <select
                  value={b?.paletteId ?? ""}
                  onChange={(e) => {
                    const pid = e.target.value || undefined;
                    // Clear field when switching to palette — keep things
                    // unambiguous (one source wins).
                    update(tp, pid ? { paletteId: pid, field: undefined } : { paletteId: undefined });
                  }}
                  style={{ marginTop: 4 }}
                  title="Bind this property to a palette entry — updates whenever the palette swatch changes"
                >
                  <option value="">— no palette —</option>
                  {palette.map((c) => (
                    <option key={c.id} value={c.id}>● {c.name} ({c.hex})</option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function targetsFor(el: Element): string[] {
  switch (el.type) {
    case "text":       return ["content", "style.color", "style.size", "style.family"];
    case "image":      return ["assetId", "corner", "opacity"];
    case "shape":      return ["fill.color", "stroke.color", "cornerRadius"];
    case "background": return ["fill.color"];
    case "stat":       return ["value"];
    case "frame":      return ["fill.color", "stroke.color"];
    case "icon":       return ["assetId"];
    default:           return ["opacity"];
  }
}

// ─── Effects tab ───────────────────────────────────────────────────────

function EffectsTab({ el }: { el: Element }) {
  const effects = el.effects ?? [];
  const find = (kind: Effect["kind"]) => effects.find((e) => e.kind === kind);

  const upsert = (kind: Effect["kind"], patch: Partial<Effect> | null) => {
    const rest = effects.filter((e) => e.kind !== kind);
    if (patch === null) {
      updateField(el, { effects: rest } as any);
      return;
    }
    const defaults: Record<Effect["kind"], Effect> = {
      dropShadow:  { kind: "dropShadow",  dx: 0.5, dy: 0.5, blur: 0.8, color: "#000000", opacity: 0.4 },
      glow:        { kind: "glow",        blur: 2,   color: "#ffd400", opacity: 0.8 },
      blur:        { kind: "blur",        blur: 1.2 },
      stroke:      { kind: "stroke",      width: 0.4, color: "#000000", opacity: 1 },
      innerShadow: { kind: "innerShadow", blur: 1 },
    };
    const existing = find(kind);
    const next = { ...defaults[kind], ...(existing ?? {}), ...patch, kind };
    updateField(el, { effects: [...rest, next] } as any);
  };

  return (
    <>
      <div className="section-head">
        <span className="title">Effects</span>
      </div>
      <div className="effects-pane">
        <EffectEditor
          name="Drop shadow"
          effect={find("dropShadow")}
          fields={["dx", "dy", "blur", "color", "opacity"]}
          onAdd={() => upsert("dropShadow", {})}
          onChange={(p) => upsert("dropShadow", p)}
          onRemove={() => upsert("dropShadow", null)}
        />
        <EffectEditor
          name="Glow"
          effect={find("glow")}
          fields={["blur", "color", "opacity"]}
          onAdd={() => upsert("glow", {})}
          onChange={(p) => upsert("glow", p)}
          onRemove={() => upsert("glow", null)}
        />
        <EffectEditor
          name="Blur"
          effect={find("blur")}
          fields={["blur"]}
          onAdd={() => upsert("blur", {})}
          onChange={(p) => upsert("blur", p)}
          onRemove={() => upsert("blur", null)}
        />
        <EffectEditor
          name="Stroke"
          effect={find("stroke")}
          fields={["width", "color", "opacity"]}
          onAdd={() => upsert("stroke", {})}
          onChange={(p) => upsert("stroke", p)}
          onRemove={() => upsert("stroke", null)}
        />
      </div>
    </>
  );
}

function EffectEditor({
  name, effect, fields, onAdd, onChange, onRemove,
}: {
  name: string;
  effect: Effect | undefined;
  fields: Array<"dx" | "dy" | "blur" | "color" | "opacity" | "width">;
  onAdd: () => void;
  onChange: (patch: Partial<Effect>) => void;
  onRemove: () => void;
}) {
  if (!effect) {
    return <button className="dashed" onClick={onAdd}>+ {name}</button>;
  }
  return (
    <div className="fx-card">
      <div className="fx-head">
        <span>{name}</span>
        <button className="icon-btn danger" onClick={onRemove} title="Remove">×</button>
      </div>
      {fields.includes("dx") && (
        <div className="prop-row"><label>dx</label>
          <DragNumber value={effect.dx ?? 0} step={0.1} unit="mm"
            onChange={(v) => onChange({ dx: v })} />
        </div>
      )}
      {fields.includes("dy") && (
        <div className="prop-row"><label>dy</label>
          <DragNumber value={effect.dy ?? 0} step={0.1} unit="mm"
            onChange={(v) => onChange({ dy: v })} />
        </div>
      )}
      {fields.includes("blur") && (
        <div className="prop-row"><label>Blur</label>
          <DragNumber value={effect.blur ?? 0} step={0.1} min={0} unit="mm"
            onChange={(v) => onChange({ blur: v })} />
        </div>
      )}
      {fields.includes("width") && (
        <div className="prop-row"><label>Width</label>
          <DragNumber value={effect.width ?? 0.4} step={0.05} min={0} unit="mm"
            onChange={(v) => onChange({ width: v })} />
        </div>
      )}
      {fields.includes("color") && (
        <div className="prop-row"><label>Colour</label>
          <PalettePicker value={effect.color ?? "#000000"}
            onChange={(hex) => onChange({ color: hex })} />
        </div>
      )}
      {fields.includes("opacity") && (
        <div className="prop-row"><label>Opacity</label>
          <DragNumber value={effect.opacity ?? 1} step={0.05} min={0} max={1}
            onChange={(v) => onChange({ opacity: v })} />
        </div>
      )}
    </div>
  );
}

// ─── Canvas settings (nothing selected) ────────────────────────────────

function CanvasProps() {
  const tplId = useEditor((s) => s.activeTemplateId)!;
  const loaded = useDoc((s) => s.loaded)!;
  const mutate = useDoc((s) => s.mutate);

  const tpl = loaded.project.templates.find((t) => t.id === tplId);
  if (!tpl) return <div className="panel" />;

  const set = (patch: Partial<typeof tpl.canvas>) => {
    mutate((p) => ({
      ...p,
      project: {
        ...p.project,
        templates: p.project.templates.map((t) =>
          t.id === tplId ? { ...t, canvas: { ...t.canvas, ...patch } } : t,
        ),
      },
    }));
  };

  return (
    <div className="panel">
      <div className="section-head">
        <span className="title">Canvas</span>
        <span className="count">{tpl.name}</span>
      </div>
      <div className="prop-section">
        <div className="prop-body">
          <div className="prop-row">
            <label>Name</label>
            <input type="text" value={tpl.name}
              onChange={(e) => {
                const name = e.target.value;
                mutate((p) => ({
                  ...p,
                  project: {
                    ...p.project,
                    templates: p.project.templates.map((t) =>
                      t.id === tplId ? { ...t, name } : t,
                    ),
                  },
                }));
              }} />
          </div>
          <div className="xywh c2">
            <div><div className="k">Width mm</div>
              <DragNumber value={tpl.canvas.widthMm} step={0.1} min={1}
                onChange={(v) => set({ widthMm: v })} />
            </div>
            <div><div className="k">Height mm</div>
              <DragNumber value={tpl.canvas.heightMm} step={0.1} min={1}
                onChange={(v) => set({ heightMm: v })} />
            </div>
          </div>
          <div className="xywh c3" style={{ marginTop: 8 }}>
            <div><div className="k">DPI</div>
              <DragNumber value={tpl.canvas.dpi} step={1} integer min={72}
                onChange={(v) => set({ dpi: v })} />
            </div>
            <div><div className="k">Bleed</div>
              <DragNumber value={tpl.canvas.bleedMm} step={0.1} min={0}
                onChange={(v) => set({ bleedMm: v })} />
            </div>
            <div><div className="k">Safe</div>
              <DragNumber value={tpl.canvas.safeAreaMm} step={0.1} min={0}
                onChange={(v) => set({ safeAreaMm: v })} />
            </div>
          </div>
          <div className="prop-row" style={{ marginTop: 10 }}>
            <label>Corner mm</label>
            <DragNumber value={tpl.canvas.cornerRadiusMm ?? 0} step={0.25} min={0} unit="mm"
              onChange={(v) => set({ cornerRadiusMm: v })} />
          </div>
          {/* Size presets: pick a common physical card format and set
              width, height, and corner radius in a single click. The
              sentinel empty option means the current dims don't match
              any known preset ("Custom"). */}
          <div className="prop-row" style={{ marginTop: 10 }}>
            <label>Preset</label>
            <select value={matchPreset(tpl.canvas)}
              onChange={(e) => {
                const p = CARD_PRESETS.find((x) => x.id === e.target.value);
                if (!p) return;
                set({ widthMm: p.widthMm, heightMm: p.heightMm, cornerRadiusMm: p.cornerMm });
              }}>
              <option value="">— Custom —</option>
              {CARD_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.widthMm}×{p.heightMm}mm
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <div className="prop-section">
        <div className="prop-head"><span>Dataset</span></div>
        <div className="prop-body">
          <div className="prop-row">
            <label>Source</label>
            <div className="control">
              <select value={tpl.datasetId ?? ""} style={{ flex: 1 }}
                onChange={(e) => {
                  const id = e.target.value || null;
                  mutate((p) => ({
                    ...p,
                    project: {
                      ...p.project,
                      templates: p.project.templates.map((t) => t.id === tplId ? { ...t, datasetId: id } : t),
                    },
                  }));
                }}>
                <option value="">(none)</option>
                {loaded.project.datasets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button
                className="icon-btn"
                title="Create a new dataset and attach it to this template"
                onClick={() => {
                  const newId = useDoc.getState().addDataset();
                  // Attach the freshly-created dataset to the current template.
                  mutate((p) => ({
                    ...p,
                    project: {
                      ...p.project,
                      templates: p.project.templates.map((t) =>
                        t.id === tplId ? { ...t, datasetId: newId } : t,
                      ),
                    },
                  }));
                }}
              >+ New</button>
            </div>
          </div>
        </div>
      </div>
      <div className="empty-hint">
        <div className="kicker">// Hint</div>
        Select an element on the canvas to edit its properties and bindings.
        Or pick a variable in the left panel to edit its lookup entries.
      </div>
    </div>
  );
}

// ─── Variable editor ───────────────────────────────────────────────────

function VariableEditorPanel({ variableId }: { variableId: string }) {
  const loaded = useDoc((s) => s.loaded)!;
  const update = useDoc((s) => s.updateVariable);
  const remove = useDoc((s) => s.removeVariable);
  const setEntry    = useDoc((s) => s.setVariableEntry);
  const renameEntry = useDoc((s) => s.renameVariableEntry);
  const removeEntry = useDoc((s) => s.removeVariableEntry);
  const addAsset = useDoc((s) => s.addAsset);
  const selectVar = useEditor((s) => s.selectVariable);

  const v = (loaded.project.variables ?? []).find((x) => x.id === variableId);
  if (!v) return <div className="panel"><div className="empty-hint">Variable not found.</div></div>;
  const assets = loaded.project.assets.filter((a) => a.kind === "image");

  return (
    <div className="panel">
      <div className="section-head">
        <span className="title">𝑥 {v.name}</span>
        <button className="action" onClick={async () => {
          const ok = await confirmAction({
            title: "Delete variable",
            message: `Delete variable "${v.name}"?`,
            okLabel: "Delete",
            danger: true,
          });
          if (ok) { remove(variableId); selectVar(null); }
        }}>× Delete</button>
      </div>
      <div className="prop-section">
        <div className="prop-body">
          <div className="prop-row"><label>Name</label>
            <input type="text" value={v.name}
              onChange={(e) => update(variableId, { name: e.target.value })} /></div>
          <div className="prop-row" style={{ gridTemplateColumns: "80px 1fr", alignItems: "flex-start" }}>
            <label>Desc</label>
            <textarea rows={2} value={v.description ?? ""}
              onChange={(e) => update(variableId, { description: e.target.value })} />
          </div>
          <div className="prop-row">
            <label>Key</label>
            <div className="seg" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              {(["text","number","enum"] as const).map((k) => (
                <button key={k} className={v.keyType === k ? "on" : ""}
                  onClick={() => {
                    if (k === v.keyType) return;
                    // Prune entries whose keys aren't valid for the new
                    // keyType: number keeps only parseable numeric keys,
                    // enum keeps only keys listed in enumOptions,
                    // text accepts everything. This avoids the stale
                    // "old text keys still showing" problem when the
                    // user swaps keyType.
                    const validKey = (key: string): boolean => {
                      if (k === "number") return Number.isFinite(Number(key));
                      if (k === "enum")   return (v.enumOptions ?? []).includes(key);
                      return true;
                    };
                    const filteredEntries: Record<string, unknown> = {};
                    for (const [key, val] of Object.entries(v.entries)) {
                      if (validKey(key)) filteredEntries[key] = val;
                    }
                    update(variableId, { keyType: k, entries: filteredEntries });
                  }}>{k}</button>
              ))}
            </div>
          </div>
          <div className="prop-row">
            <label>Value</label>
            <div className="seg vtype-seg" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
              {(
                [
                  { k: "image",   glyph: "▣", label: "Image" },
                  { k: "color",   glyph: "●", label: "Colour" },
                  { k: "text",    glyph: "T", label: "Text" },
                  { k: "number",  glyph: "#", label: "Number" },
                  { k: "boolean", glyph: "✓", label: "Boolean" },
                ] as const
              ).map(({ k, glyph, label }) => (
                <button key={k} className={v.valueType === k ? "on" : ""}
                  title={label}
                  onClick={() => update(variableId, { valueType: k as Variable["valueType"] })}>
                  <span className="vtype-glyph">{glyph}</span>
                </button>
              ))}
            </div>
          </div>
          {v.keyType === "enum" && (
            <div className="prop-row" style={{ gridTemplateColumns: "80px 1fr", alignItems: "flex-start" }}>
              <label>Enum</label>
              <CsvListInput multiline rows={2}
                placeholder="common, uncommon, rare"
                value={v.enumOptions ?? []}
                onChange={(next) => update(variableId, { enumOptions: next })} />
            </div>
          )}
        </div>
      </div>
      <div className="prop-section">
        <div className="prop-head"><span>Entries</span><span className="muted">{Object.keys(v.entries).length}</span></div>
        <VariableEntries v={v}
          assets={assets}
          onSetValue={(k, val) => setEntry(variableId, k, val)}
          onRenameKey={(a, b) => renameEntry(variableId, a, b)}
          onRemoveEntry={(k) => removeEntry(variableId, k)}
          onImportImage={async () => {
            const a = await importImage(loaded.path);
            if (!a) return null;
            addAsset(a);
            return a.id;
          }}
        />
      </div>
    </div>
  );
}

function VariableEntries({
  v, assets, onSetValue, onRenameKey, onRemoveEntry, onImportImage,
}: {
  v: Variable;
  assets: import("@/model/types").AssetRef[];
  onSetValue: (key: string, value: unknown) => void;
  onRenameKey: (oldKey: string, newKey: string) => void;
  onRemoveEntry: (key: string) => void;
  onImportImage: () => Promise<string | null>;
}) {
  const [newKey, setNewKey] = useState("");
  // Enum: the key list is always whatever enumOptions says (empty → no
  // rows), so stale entries from a previous text key type don't leak
  // into the UI. Other key types still use the entries map directly.
  const keys = v.keyType === "enum"
    ? (v.enumOptions ?? [])
    : Object.keys(v.entries);

  const renderValue = (k: string, val: unknown) => {
    switch (v.valueType) {
      case "image":
        return (
          <div className="control" style={{ width: "100%" }}>
            <select value={(val as string) ?? ""} style={{ flex: 1 }}
              onChange={(e) => onSetValue(k, e.target.value || undefined)}>
              <option value="">(none)</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.originalName}</option>)}
            </select>
            <button className="icon-btn" title="Import image…"
              onClick={async () => {
                const id = await onImportImage();
                if (id) onSetValue(k, id);
              }}>↑</button>
          </div>
        );
      case "color":
        return <PalettePicker value={(val as string) || "#ffffff"}
          onChange={(hex) => onSetValue(k, hex)} />;
      case "number":
        return <DragNumber value={Number(val ?? 0)} step={0.1}
          onChange={(v) => onSetValue(k, v)} />;
      case "boolean":
        return <input type="checkbox" checked={!!val}
          onChange={(e) => onSetValue(k, e.target.checked)} />;
      default:
        return <input type="text" value={(val as string) ?? ""}
          onChange={(e) => onSetValue(k, e.target.value)} />;
    }
  };

  return (
    <div className="prop-body">
      {keys.length === 0 && <div className="empty-hint" style={{ padding: 0 }}>No entries yet.</div>}
      {keys.map((k) => (
        <div key={k} className="prop-row" style={{ gridTemplateColumns: "84px 1fr auto", gap: 8 }}>
          {v.keyType === "enum"
            ? <label style={{ fontFamily: "var(--font-mono)", color: "var(--accent)", textTransform: "none", letterSpacing: 0 }}>{k}</label>
            : <input type="text" value={k} onChange={(e) => onRenameKey(k, e.target.value)} />
          }
          {renderValue(k, v.entries[k])}
          {v.keyType !== "enum"
            ? <button className="icon-btn danger" onClick={() => onRemoveEntry(k)}>×</button>
            : <span />
          }
        </div>
      ))}
      {v.keyType !== "enum" && (
        <div className="prop-row" style={{ gridTemplateColumns: "1fr auto", gap: 6, marginTop: 8 }}>
          <input type={v.keyType === "number" ? "number" : "text"}
            placeholder="new key" value={newKey}
            onChange={(e) => setNewKey(e.target.value)} />
          <button className="action" onClick={() => {
            const k = String(newKey).trim();
            if (!k) return;
            onSetValue(k, v.valueType === "boolean" ? false : v.valueType === "number" ? 0 : "");
            setNewKey("");
          }}>+ Add</button>
        </div>
      )}
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function AlignToCanvasRow({ el }: { el: Element }) {
  const loaded = useDoc((s) => s.loaded)!;
  const tplId  = useEditor((s) => s.activeTemplateId)!;
  const tpl    = loaded.project.templates.find((t) => t.id === tplId)!;

  // Use the element's parent group as the alignment frame. For
  // top-level children that's the root group (sized to the canvas),
  // for nested children it's the containing group.
  const parent = findParentGroup(tpl.root, el.id) ?? tpl.root;
  const pw = parent.w || tpl.canvas.widthMm;
  const ph = parent.h || tpl.canvas.heightMm;

  return (
    <AlignButtons
      el={el}
      parentW={pw}
      parentH={ph}
      onAlign={(dir: AlignDir) => {
        const patch = computeAlign(el, pw, ph, dir);
        updateField(el, patch as any);
      }}
    />
  );
}

function findParentGroup(root: import("@/model/types").ElementGroup, id: string): import("@/model/types").ElementGroup | undefined {
  const walk = (g: import("@/model/types").ElementGroup): import("@/model/types").ElementGroup | undefined => {
    for (const c of g.children) {
      if (c.id === id) return g;
      if (c.type === "group") {
        const inner = walk(c);
        if (inner) return inner;
      }
    }
    return undefined;
  };
  return walk(root);
}

function updateField<T extends Element>(el: T, patch: Partial<T>) {
  const tplId = useEditor.getState().activeTemplateId!;
  useDoc.getState().updateElement(tplId, el.id, patch as Partial<Element>);
}

/** Read the effective opacity of a Fill (undefined → 1). */
function fillOpacity(f: Fill | undefined): number {
  return f?.opacity ?? 1;
}

/**
 * Patch a Fill's opacity, stripping the field when the value is 1 so
 * default-opaque fills don't round-trip with a noisy `"opacity": 1`.
 */
function withFillOpacity(f: Fill, v: number): Fill {
  const next = { ...f } as Fill;
  if (v >= 1) {
    delete (next as { opacity?: number }).opacity;
  } else {
    (next as { opacity?: number }).opacity = Math.max(0, v);
  }
  return next;
}

/** Return the id of the `CARD_PRESETS` entry matching the canvas within
 *  a small tolerance, or "" if none match (treated as "Custom"). */
function matchPreset(canvas: { widthMm: number; heightMm: number; cornerRadiusMm?: number }): string {
  const tol = 0.25;
  const corner = canvas.cornerRadiusMm ?? 0;
  const hit = CARD_PRESETS.find((p) =>
    Math.abs(p.widthMm  - canvas.widthMm)  < tol &&
    Math.abs(p.heightMm - canvas.heightMm) < tol &&
    Math.abs(p.cornerMm - corner)          < tol,
  );
  return hit?.id ?? "";
}

/**
 * Set width respecting the element's anchor when the resize-from-anchor
 * toggle is active: keeps the anchor's absolute x position fixed, so the
 * element scales around the pivot on the X axis.
 */
function resizeW(el: Element, newW: number) {
  const resizeFromAnchor = useEditor.getState().resizeFromAnchor;
  if (!resizeFromAnchor) {
    updateField(el, { w: newW } as any);
    return;
  }
  const ax = el.anchor?.x ?? 0.5;
  const anchorAbs = el.x + el.w * ax;
  updateField(el, { w: newW, x: anchorAbs - newW * ax } as any);
}

function resizeH(el: Element, newH: number) {
  const resizeFromAnchor = useEditor.getState().resizeFromAnchor;
  if (!resizeFromAnchor) {
    updateField(el, { h: newH } as any);
    return;
  }
  const ay = el.anchor?.y ?? 0.5;
  const anchorAbs = el.y + el.h * ay;
  updateField(el, { h: newH, y: anchorAbs - newH * ay } as any);
}
const round = (n: number) => Math.round(n * 1000) / 1000;
void round;
