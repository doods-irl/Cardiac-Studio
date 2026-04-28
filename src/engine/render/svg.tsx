/**
 * Pure SVG renderer. Same function is used for preview (returns React
 * nodes into a live SVG) and for export (serialised via
 * renderToStaticMarkup → handed to resvg). Side-effect free.
 *
 * Notes on transparency:
 *   - <image> elements never get a background fill; only a clipPath for
 *     rounded corners so alpha pixels pass through.
 *   - Placeholder (no asset) is drawn with a dashed border only, no fill,
 *     so the user clearly sees "slot present but empty" against the
 *     card background.
 *   - Alpha-aware stroke is implemented as an SVG filter on SourceAlpha
 *     + feMorphology + feFlood + feComposite, so it follows the
 *     transparent silhouette rather than the bounding rect.
 */

import { applyBindings } from "@/engine/binding/resolve";
import { layoutRuns, ellipsizeLine, type Line } from "@/engine/render/text";
import type {
  AssetRef, BackgroundElement, CanvasSpec, DataRecord, Element, ElementGroup,
  Fill, FrameElement, IconElement, ImageElement, NamedIcon, PaletteColor,
  ShapeElement, StatElement, Stroke, TextElement, Variable,
} from "@/model/types";

export interface RenderCtx {
  record?: DataRecord;
  assets: AssetRef[];
  variables?: Variable[];
  palette?: PaletteColor[];
  icons?: NamedIcon[];
  /** Called to resolve an asset reference into a URL the renderer can use. */
  assetUrl: (a: AssetRef) => string;
  /** Selection highlight. */
  selectedId?: string | null;
  /**
   * Editor-only: render the full unclipped tree behind the clipped view
   * as a greyed, desaturated ghost so the user can see what's being
   * trimmed. Exports always use `false`.
   */
  showTrimmed?: boolean;
  /**
   * When true, skip binding resolution entirely and render each element
   * using its stored `content` / style fields as-is. Drives the "show
   * defaults" toggle on the data bar — lets the user see the template
   * as authored without any record's data substituted in.
   */
  showDefaults?: boolean;
}

const px = (v: number) => Number.isFinite(v) ? Number(v.toFixed(3)) : 0;

function assetById(ctx: RenderCtx, id: string | undefined): AssetRef | undefined {
  if (!id) return undefined;
  return ctx.assets.find((a) => a.id === id || a.path === id);
}

/**
 * Resolve a Fill into a paint string + optional <defs>. Also returns
 * the fill's opacity so callers can emit `fill-opacity` on the shape
 * itself (gradients can't carry a single opacity value via `stop-opacity`
 * alone). Returns `undefined` for opacity when fully opaque so we don't
 * clutter the SVG with redundant attributes.
 */
function fillToPaint(
  f: Fill | undefined,
  idFor: string,
): { paint: string; opacity?: number; defs?: JSX.Element } {
  if (!f) return { paint: "none" };
  const op = f.opacity;
  const opacity = op !== undefined && op < 1 ? op : undefined;
  if (f.kind === "solid") return { paint: f.color, opacity };
  if (f.kind === "linear") {
    const gid = `lg_${idFor}`;
    const defs = (
      <linearGradient id={gid} gradientTransform={`rotate(${f.angle})`}>
        {f.stops.map((s, i) => (
          <stop key={i} offset={`${s.at * 100}%`} stopColor={s.color} />
        ))}
      </linearGradient>
    );
    return { paint: `url(#${gid})`, opacity, defs };
  }
  const gid = `rg_${idFor}`;
  const defs = (
    <radialGradient id={gid} cx={f.cx} cy={f.cy} r={f.r}>
      {f.stops.map((s, i) => (
        <stop key={i} offset={`${s.at * 100}%`} stopColor={s.color} />
      ))}
    </radialGradient>
  );
  return { paint: `url(#${gid})`, opacity, defs };
}

// ─── Element renderers ────────────────────────────────────────────────

/**
 * Build stroke attributes for a shape. Returns an empty object when
 * the stroke is unset or has zero width — so "no stroke" never emits
 * `stroke-width="0"` which some renderers still allocate space for.
 * `stroke-opacity` is emitted only when < 1 to keep exports clean.
 */
function strokeAttrs(s: Stroke | undefined): Record<string, string | number> {
  if (!s || !(s.width > 0)) return {};
  const attrs: Record<string, string | number> = {
    stroke: s.color,
    strokeWidth: s.width,
  };
  const op = s.opacity;
  if (op !== undefined && op < 1) attrs.strokeOpacity = op;
  if (s.dash && s.dash.length > 0) attrs.strokeDasharray = s.dash.join(" ");
  return attrs;
}

function renderBackground(el: BackgroundElement) {
  const { paint, opacity, defs } = fillToPaint(el.fill, el.id);
  return (
    <g key={el.id}>
      {defs ? <defs>{defs}</defs> : null}
      <rect
        x={0} y={0} width={el.w} height={el.h}
        fill={paint}
        fillOpacity={opacity}
      />
    </g>
  );
}

function renderShape(el: ShapeElement) {
  const { paint, opacity, defs } = fillToPaint(el.fill, el.id);
  const stroke = strokeAttrs(el.stroke);
  const common = { fill: paint, fillOpacity: opacity, ...stroke };
  let body: JSX.Element;
  if (el.shape === "ellipse") {
    body = <ellipse cx={el.w / 2} cy={el.h / 2} rx={el.w / 2} ry={el.h / 2} {...common} />;
  } else if (el.shape === "path" && el.path) {
    body = <path d={el.path} {...common} />;
  } else {
    body = (
      <rect
        x={0} y={0} width={el.w} height={el.h}
        rx={el.cornerRadius ?? 0} ry={el.cornerRadius ?? 0}
        {...common}
      />
    );
  }
  return (
    <g key={el.id}>
      {defs ? <defs>{defs}</defs> : null}
      {body}
    </g>
  );
}

function renderFrame(el: FrameElement) {
  const { paint, opacity, defs } = fillToPaint(el.fill, el.id);
  const stroke = strokeAttrs(el.stroke);
  return (
    <g key={el.id}>
      {defs ? <defs>{defs}</defs> : null}
      <rect
        x={0} y={0} width={el.w} height={el.h}
        rx={el.cornerRadius ?? 0} ry={el.cornerRadius ?? 0}
        fill={paint}
        fillOpacity={opacity}
        {...stroke}
      />
    </g>
  );
}

/**
 * Build a <filter> element for the combined image colour + alpha-stroke
 * pipeline. Returns `{ filterId, defs }` or `{}` if no effects active.
 */
function imageFilterDefs(el: ImageElement): { filterId?: string; defs?: JSX.Element } {
  const f = el.filter;
  const as = el.alphaStroke;
  const hasColour = !!(f && (
    f.brightness !== undefined || f.contrast !== undefined || f.saturation !== undefined ||
    f.hue !== undefined || f.blur !== undefined || f.grayscale !== undefined ||
    f.sepia !== undefined || f.invert !== undefined || f.duotone !== undefined ||
    (f.tint && (f.tint.strength ?? 0) > 0)
  ));
  if (!hasColour && !as) return {};
  const id = `img_fx_${el.id}`;

  // Build filter primitives. Order:
  //   blur → grayscale → duotone/sepia → saturate → hue-rotate → bright/contrast → invert
  // then composite back with alpha stroke on top.
  const prims: JSX.Element[] = [];

  let src = "SourceGraphic";
  const emit = (node: JSX.Element, nextResult: string) => {
    prims.push(node);
    src = nextResult;
  };

  if (f?.blur) {
    emit(<feGaussianBlur key="blur" in={src} stdDeviation={f.blur} result="fx_blur" />, "fx_blur");
  }
  if (f?.grayscale && f.grayscale > 0) {
    const m = grayscaleMatrix(f.grayscale);
    emit(<feColorMatrix key="gs" in={src} type="matrix" values={m} result="fx_gs" />, "fx_gs");
  }
  if (f?.sepia && f.sepia > 0) {
    emit(<feColorMatrix key="sepia" in={src} type="matrix" values={sepiaMatrix(f.sepia)} result="fx_sepia" />, "fx_sepia");
  }
  if (f?.duotone) {
    // Implement duotone with componentTransfer: first desaturate to luminance,
    // then remap through linear gradient approximated as a per-channel table.
    emit(<feColorMatrix key="lum" in={src} type="matrix" values={luminanceMatrix()} result="fx_lum" />, "fx_lum");
    const from = rgbTuple(f.duotone.from);
    const to   = rgbTuple(f.duotone.to);
    emit(
      <feComponentTransfer key="dt" in={src} result="fx_dt">
        <feFuncR type="table" tableValues={`${from[0] / 255} ${to[0] / 255}`} />
        <feFuncG type="table" tableValues={`${from[1] / 255} ${to[1] / 255}`} />
        <feFuncB type="table" tableValues={`${from[2] / 255} ${to[2] / 255}`} />
      </feComponentTransfer>,
      "fx_dt",
    );
  }
  if (f?.tint && (f.tint.strength ?? 0) > 0) {
    // Grayscale-then-tint in a single colour matrix.
    //   out = (1 - s) * source + s * (L * tint)
    // where L = 0.299·R + 0.587·G + 0.114·B
    // Expanded per output channel, the R/G/B columns for output `c` are:
    //   diag: (1-s) + s · tint_c · L_c
    //   off:          s · tint_c · L_other
    const s = Math.max(0, Math.min(1, f.tint.strength));
    const [tr, tg, tb] = rgbTuple(f.tint.color);
    const R = tr / 255, G = tg / 255, B = tb / 255;
    const lr = 0.299, lg = 0.587, lb = 0.114;
    const m = [
      (1 - s) + s * R * lr,  s * R * lg,            s * R * lb,            0, 0,
      s * G * lr,            (1 - s) + s * G * lg,  s * G * lb,            0, 0,
      s * B * lr,            s * B * lg,            (1 - s) + s * B * lb,  0, 0,
      0,                     0,                     0,                     1, 0,
    ].join(" ");
    emit(<feColorMatrix key="tint" in={src} type="matrix" values={m} result="fx_tint" />, "fx_tint");
  }
  if (f?.saturation !== undefined && f.saturation !== 1) {
    emit(<feColorMatrix key="sat" in={src} type="saturate" values={String(f.saturation)} result="fx_sat" />, "fx_sat");
  }
  if (f?.hue !== undefined && f.hue !== 0) {
    emit(<feColorMatrix key="hue" in={src} type="hueRotate" values={String(f.hue)} result="fx_hue" />, "fx_hue");
  }
  if (f && (f.brightness !== undefined || f.contrast !== undefined)) {
    const b = f.brightness ?? 1;
    const c = f.contrast ?? 1;
    // contrast c: slope = c, intercept = -(0.5 * c) + 0.5
    // brightness b: multiply by b after.
    const slope = c * b;
    const intercept = (0.5 - 0.5 * c) * b;
    emit(
      <feComponentTransfer key="bc" in={src} result="fx_bc">
        <feFuncR type="linear" slope={slope} intercept={intercept} />
        <feFuncG type="linear" slope={slope} intercept={intercept} />
        <feFuncB type="linear" slope={slope} intercept={intercept} />
      </feComponentTransfer>,
      "fx_bc",
    );
  }
  if (f?.invert && f.invert > 0) {
    const s = f.invert;
    emit(
      <feComponentTransfer key="inv" in={src} result="fx_inv">
        <feFuncR type="table" tableValues={`${s} ${1 - s}`} />
        <feFuncG type="table" tableValues={`${s} ${1 - s}`} />
        <feFuncB type="table" tableValues={`${s} ${1 - s}`} />
      </feComponentTransfer>,
      "fx_inv",
    );
  }

  // Final colour-pipeline output is `src`. Now stack the alpha-aware stroke.
  const finalChildren: JSX.Element[] = [...prims];
  if (as) {
    finalChildren.push(
      <feMorphology
        key="morph"
        in="SourceAlpha"
        operator="dilate"
        radius={as.width}
        result="fx_dilated"
      />,
      <feFlood key="flood" floodColor={as.color} floodOpacity={as.opacity ?? 1} result="fx_strokecol" />,
      <feComposite key="cc" in="fx_strokecol" in2="fx_dilated" operator="in" result="fx_stroke" />,
      <feMerge key="merge">
        <feMergeNode in="fx_stroke" />
        <feMergeNode in={src} />
      </feMerge>,
    );
  }

  return {
    filterId: id,
    defs: <filter id={id} x="-20%" y="-20%" width="140%" height="140%">{finalChildren}</filter>,
  };
}

function grayscaleMatrix(amount: number): string {
  const a = Math.max(0, Math.min(1, amount));
  const r = 0.2126, g = 0.7152, b = 0.0722;
  const v = (c: number) => (1 - a) + a * c;
  return [
    `${v(r)} ${a * g} ${a * b} 0 0`,
    `${a * r} ${v(g)} ${a * b} 0 0`,
    `${a * r} ${a * g} ${v(b)} 0 0`,
    `0 0 0 1 0`,
  ].join(" ");
}

function sepiaMatrix(amount: number): string {
  const a = Math.max(0, Math.min(1, amount));
  return [
    `${0.393 + 0.607 * (1 - a)} ${0.769 - 0.769 * (1 - a)} ${0.189 - 0.189 * (1 - a)} 0 0`,
    `${0.349 - 0.349 * (1 - a)} ${0.686 + 0.314 * (1 - a)} ${0.168 - 0.168 * (1 - a)} 0 0`,
    `${0.272 - 0.272 * (1 - a)} ${0.534 - 0.534 * (1 - a)} ${0.131 + 0.869 * (1 - a)} 0 0`,
    `0 0 0 1 0`,
  ].join(" ");
}

function luminanceMatrix(): string {
  return "0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0";
}

function rgbTuple(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function renderImage(el: ImageElement, ctx: RenderCtx) {
  const asset = assetById(ctx, el.assetId);
  const { filterId, defs: filterDefs } = imageFilterDefs(el);

  if (!asset) {
    // Empty slot: dashed outline only — no fill, so backdrop shows through.
    return (
      <g key={el.id}>
        <rect
          x={0} y={0} width={el.w} height={el.h}
          rx={el.corner ?? 0} ry={el.corner ?? 0}
          fill="none" stroke="#bbbbbb"
          strokeDasharray="1 1" strokeWidth={0.2}
          pointerEvents="none"
        />
        <text x={el.w / 2} y={el.h / 2}
              fontSize={Math.min(3, el.h * 0.2)} fill="#888"
              textAnchor="middle" dominantBaseline="middle">image</text>
      </g>
    );
  }
  const href = ctx.assetUrl(asset);
  const preserve =
    el.fit === "contain" ? "xMidYMid meet"
    : el.fit === "cover"  ? "xMidYMid slice"
    : el.fit === "stretch"? "none"
    : "xMidYMid slice";

  const clipId = `clip_${el.id}`;
  const hasRoundedClip = (el.corner ?? 0) > 0;

  return (
    <g key={el.id}>
      <defs>
        {hasRoundedClip && (
          <clipPath id={clipId}>
            <rect x={0} y={0} width={el.w} height={el.h}
                  rx={el.corner ?? 0} ry={el.corner ?? 0} />
          </clipPath>
        )}
        {filterDefs}
      </defs>
      <g clipPath={hasRoundedClip ? `url(#${clipId})` : undefined}>
        <image
          href={href}
          x={0} y={0}
          width={el.w} height={el.h}
          preserveAspectRatio={preserve}
          filter={filterId ? `url(#${filterId})` : undefined}
        />
      </g>
      {el.border ? (
        <rect x={0} y={0} width={el.w} height={el.h}
              rx={el.corner ?? 0} ry={el.corner ?? 0}
              fill="none"
              stroke={el.border.color} strokeWidth={el.border.width} />
      ) : null}
    </g>
  );
}

function renderIcon(el: IconElement, ctx: RenderCtx) {
  const asset = assetById(ctx, el.assetId);
  if (!asset) {
    // Empty slot — dashed outline only, like an empty image element,
    // so the user sees that the slot exists and can be filled.
    return (
      <g key={el.id}>
        <rect x={0} y={0} width={el.w} height={el.h}
              fill="none" stroke="#bbbbbb"
              strokeDasharray="1 1" strokeWidth={0.2}
              pointerEvents="none" />
        <text x={el.w / 2} y={el.h / 2}
              fontSize={Math.min(3, el.h * 0.2)} fill="#888"
              textAnchor="middle" dominantBaseline="middle">icon</text>
      </g>
    );
  }
  const href = ctx.assetUrl(asset);
  // When `tint` is set we draw the icon as a solid-colour silhouette
  // (feFlood + feComposite-in on SourceAlpha). That's the standard
  // glyph-icon expectation: replace RGB with the tint, keep alpha.
  const tintId = el.tint ? `icon_tint_${el.id}` : null;
  return (
    <g key={el.id}>
      {tintId && (
        <defs>
          <filter id={tintId} x="0" y="0" width="100%" height="100%">
            <feFlood floodColor={el.tint} result="tintCol" />
            <feComposite in="tintCol" in2="SourceAlpha" operator="in" />
          </filter>
        </defs>
      )}
      <image href={href} x={0} y={0} width={el.w} height={el.h}
             preserveAspectRatio="xMidYMid meet"
             filter={tintId ? `url(#${tintId})` : undefined} />
    </g>
  );
}

function renderText(el: TextElement, ctx: RenderCtx) {
  const s = el.style;
  const pad = el.padding ?? { t: 0, r: 0, b: 0, l: 0 };
  const x = pad.l;
  const y = pad.t;
  const innerW = Math.max(0, el.w - pad.l - pad.r);
  const innerH = Math.max(0, el.h - pad.t - pad.b);

  const fontSize = s.size;
  const iconSize = s.inlineIconSize ?? fontSize;
  const lineH = fontSize * s.lineHeight;
  const hasStroke = !!(s.stroke && s.stroke.width > 0);

  const content = (el.content ?? "").toString();
  const lines = layoutRuns(content, ctx.icons ?? [], ctx.assets, {
    fontSize,
    iconSize,
    letterSpacing: s.letterSpacing,
    maxWidth: innerW,
    uppercase: s.uppercase,
    family: s.family,
    weight: s.weight,
    italic: s.italic,
  });

  let displayLines: Line[] = lines;
  let scale = 1;
  const textHeight = lines.length * lineH;
  if (textHeight > innerH) {
    if (el.overflow === "shrink" || el.overflow === "scale") {
      scale = Math.max(0.3, innerH / textHeight);
    } else if (el.overflow === "clip") {
      const visible = Math.max(1, Math.floor(innerH / lineH));
      displayLines = lines.slice(0, visible);
    } else if (el.overflow === "ellipsis") {
      const visible = Math.max(1, Math.floor(innerH / lineH));
      displayLines = lines.slice(0, visible);
      if (displayLines.length > 0 && visible < lines.length) {
        const i = displayLines.length - 1;
        displayLines[i] = ellipsizeLine(displayLines[i], innerW, fontSize, s.letterSpacing);
      }
    }
  }

  const totalH = displayLines.length * lineH;
  const vOff =
    s.valign === "middle" ? Math.max(0, (innerH - totalH) / 2) :
    s.valign === "bottom" ? Math.max(0, innerH - totalH) : 0;

  const nodes: JSX.Element[] = [];
  displayLines.forEach((line, li) => {
    const baseY = y + vOff + fontSize + li * lineH;
    let startX = x;
    if (s.align === "center")     startX = x + (innerW - line.width) / 2;
    else if (s.align === "right") startX = x + innerW - line.width;

    let cursor = startX;
    for (let ri = 0; ri < line.runs.length; ri++) {
      const run = line.runs[ri];
      if (run.kind === "text") {
        // Per-run markup overrides (from `[b]`, `[i]`, `[u]`, `[c]`
        // tags in the text content) override the element's base style.
        const rs = run.style;
        const runItalic    = rs?.italic    ?? s.italic;
        const runUnderline = rs?.underline ?? s.underline;
        const runColor     = rs?.color     ?? s.color;
        // Bold bumps the element's base weight by 300 (clamped) so a
        // normally-400 element reads as 700 while a 700-base one lands
        // closer to 900. Reverts to base weight if the override is off.
        const runWeight    = rs?.bold
          ? Math.min(900, Math.max(700, s.weight + 300))
          : s.weight;
        nodes.push(
          <text
            key={`${li}-${ri}`}
            x={cursor}
            y={baseY}
            // `font-family` as a CSS inline style rather than a
            // presentation attribute — SVG presentation attrs have
            // specificity 0 and lose to any inherited CSS `font-family`
            // from ancestors (body sets `font-family: var(--font-ui)`),
            // which was making every text element fall back to the app
            // UI font regardless of what the picker said.
            style={{ fontFamily: s.family }}
            fontWeight={runWeight}
            fontSize={fontSize}
            fill={runColor}
            letterSpacing={s.letterSpacing}
            fontStyle={runItalic ? "italic" : undefined}
            textDecoration={runUnderline ? "underline" : undefined}
            stroke={hasStroke ? s.stroke!.color : undefined}
            strokeWidth={hasStroke ? s.stroke!.width : undefined}
            strokeLinejoin="round"
            paintOrder={hasStroke ? "stroke fill" : undefined}
          >
            {run.value}
          </text>
        );
      } else if (run.asset) {
        // Icon vertical placement follows `inlineIconAlign`:
        //   - "baseline" → icon bottom sits on baseline
        //   - "center"   → icon vertical centre ≈ text x-height (default)
        //   - "top"      → icon top aligns with the ascender top
        // Real font metrics aren't available at layout-time, so we
        // approximate using fontSize.
        const align = s.inlineIconAlign ?? "center";
        const iy =
          align === "baseline" ? baseY - iconSize :
          align === "top"      ? baseY - fontSize :
                                 baseY - iconSize / 2 - fontSize * 0.35;
        nodes.push(
          <image
            key={`${li}-${ri}`}
            href={ctx.assetUrl(run.asset)}
            x={cursor}
            y={iy}
            width={iconSize}
            height={iconSize}
            preserveAspectRatio="xMidYMid meet"
          />
        );
      }
      cursor += run.width;
    }
  });

  return (
    <g key={el.id} transform={scale !== 1 ? `scale(${scale})` : undefined}>
      {nodes}
    </g>
  );
}

/**
 * Build an SVG node for a stat-element background. Centred on a
 * (w × h) box at origin (0, 0). Shapes that don't naturally fill the
 * box (circle, regular polygons) inscribe themselves in the smallest
 * axis so they stay symmetrical.
 */
export function statShapeNode(
  shape: StatElement["shape"], w: number, h: number,
  fillProps: { fill: string; fillOpacity?: number },
): JSX.Element {
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) / 2;
  switch (shape) {
    case "rect":
      return <rect x={0} y={0} width={w} height={h} rx={1} ry={1} {...fillProps} />;
    case "diamond":
      return <polygon points={`${cx},0 ${w},${cy} ${cx},${h} 0,${cy}`} {...fillProps} />;
    case "shield":
      return <path d={`M 0 0 H ${w} V ${h * 0.6} Q ${cx} ${h} 0 ${h * 0.6} Z`} {...fillProps} />;
    case "hexagon":
      return <polygon points={polygonPoints(cx, cy, r, 6, -Math.PI / 2)} {...fillProps} />;
    case "triangle":
      return <polygon points={polygonPoints(cx, cy, r, 3, -Math.PI / 2)} {...fillProps} />;
    case "pentagon":
      return <polygon points={polygonPoints(cx, cy, r, 5, -Math.PI / 2)} {...fillProps} />;
    case "octagon":
      return <polygon points={polygonPoints(cx, cy, r, 8, -Math.PI / 8)} {...fillProps} />;
    case "star":
      return <polygon points={starPoints(cx, cy, r, r * 0.5, 5, -Math.PI / 2)} {...fillProps} />;
    case "circle":
    default:
      return <circle cx={cx} cy={cy} r={r} {...fillProps} />;
  }
}

function polygonPoints(cx: number, cy: number, r: number, sides: number, startAngle: number): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (i * 2 * Math.PI) / sides;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(" ");
}

function starPoints(cx: number, cy: number, rOuter: number, rInner: number, points: number, startAngle: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = startAngle + (i * Math.PI) / points;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
  }
  return pts.join(" ");
}

function renderStat(el: StatElement) {
  const cx = el.w / 2;
  const cy = el.h / 2;
  const { paint, opacity, defs } = fillToPaint(el.background ?? { kind: "solid", color: "#e63946" }, el.id);
  const fillProps = { fill: paint, fillOpacity: opacity };
  const shape = statShapeNode(el.shape, el.w, el.h, fillProps);
  const hasStroke = !!(el.style.stroke && el.style.stroke.width > 0);
  return (
    <g key={el.id}>
      {defs ? <defs>{defs}</defs> : null}
      {shape}
      <text
        x={cx} y={cy}
        style={{ fontFamily: el.style.family }}
        fontWeight={el.style.weight}
        fontSize={el.style.size}
        fill={el.style.color}
        textAnchor="middle" dominantBaseline="central"
        fontStyle={el.style.italic ? "italic" : undefined}
        textDecoration={el.style.underline ? "underline" : undefined}
        letterSpacing={el.style.letterSpacing}
        stroke={hasStroke ? el.style.stroke!.color : undefined}
        strokeWidth={hasStroke ? el.style.stroke!.width : undefined}
        paintOrder={hasStroke ? "stroke fill" : undefined}
      >
        {el.value}
      </text>
    </g>
  );
}

function renderGroup(el: ElementGroup, ctx: RenderCtx): JSX.Element {
  // Draw in tree order — later siblings render on top of earlier ones.
  // The per-element `zIndex` field is no longer consulted; stacking is
  // controlled by re-ordering children in the layer panel.
  return (
    <g key={el.id}>
      {el.children.map((c) => renderOne(c, ctx))}
    </g>
  );
}

function withTransform(child: JSX.Element, el: Element, isSelected: boolean): JSX.Element {
  const translate = `translate(${px(el.x)} ${px(el.y)})`;
  const ax = el.anchor?.x ?? 0.5;
  const ay = el.anchor?.y ?? 0.5;
  const rotate = el.rotation ? ` rotate(${el.rotation} ${px(el.w * ax)} ${px(el.h * ay)})` : "";
  const style: React.CSSProperties = { opacity: el.opacity };
  const cssFilter = effectsToFilter(el);
  const strokeFilter = buildStrokeFilter(el);

  // Layer structure:
  //   <g translate+rotate opacity> — the transform wrapper
  //     <defs>stroke filter</defs>
  //     <g cssFilter>               — CSS filters (shadow/glow/blur)
  //       <g svgFilter>             — SVG filter for stroke effect only
  //         {child}
  //       </g>
  //     </g>
  //     <rect selection outline/>   — sits OUTSIDE all filters so it
  //                                    doesn't contribute to them
  //
  // The old structure had the selection rect inside the filter wrapper,
  // which made the stroke effect trace around the selection outline
  // too, producing an aberrated "bounding-box" look.
  return (
    <g key={el.id} data-element-id={el.id} transform={translate + rotate} style={style}>
      {strokeFilter && <defs>{strokeFilter.defs}</defs>}
      <g style={cssFilter ? { filter: cssFilter } : undefined}>
        <g filter={strokeFilter ? `url(#${strokeFilter.id})` : undefined}>
          {child}
        </g>
      </g>
      {isSelected && el.type !== "group" && (
        <rect
          x={0} y={0} width={el.w} height={el.h}
          fill="none" stroke="#2f7dd1" strokeWidth={0.25}
          strokeDasharray="0.8 0.4"
          pointerEvents="none"
        />
      )}
    </g>
  );
}

/**
 * Build a SVG `<filter>` that outlines the element's rendered alpha
 * using `feMorphology`. This produces a pixel-perfect outline that
 * follows the real silhouette — no aliasing artefacts, works for text
 * glyphs, transparent PNGs, shapes, or groups.
 *
 * Returned element belongs in a `<defs>` block near the element; the
 * filter id is applied via `filter="url(#...)"` on an inner wrapper.
 */
function buildStrokeFilter(el: Element): { id: string; defs: JSX.Element } | null {
  const stroke = el.effects?.find((e) => e.kind === "stroke");
  if (!stroke) return null;
  const id = `fx_stroke_${el.id}`;
  const width   = stroke.width   ?? 0.4;
  const color   = stroke.color   ?? "#000000";
  const opacity = stroke.opacity ?? 1;
  return {
    id,
    defs: (
      <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
        <feMorphology in="SourceAlpha" operator="dilate" radius={width} result="fx_dilated" />
        <feFlood floodColor={color} floodOpacity={opacity} result="fx_col" />
        <feComposite in="fx_col" in2="fx_dilated" operator="in" result="fx_stroke" />
        <feMerge>
          <feMergeNode in="fx_stroke" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    ),
  };
}

function effectsToFilter(el: Element): string | undefined {
  const effects = el.effects;
  if (!effects || effects.length === 0) return undefined;
  const parts: string[] = [];
  for (const fx of effects) {
    switch (fx.kind) {
      case "dropShadow": {
        const color   = fx.color   ?? "#000000";
        const dx      = fx.dx      ?? 0.5;
        const dy      = fx.dy      ?? 0.5;
        const blur    = fx.blur    ?? 0.8;
        const opacity = fx.opacity ?? 0.4;
        parts.push(`drop-shadow(${dx}px ${dy}px ${blur}px ${hexA(color, opacity)})`);
        break;
      }
      case "glow": {
        // Centred drop-shadow = glow. Stack two for a brighter bloom.
        const color   = fx.color   ?? "#ffd400";
        const blur    = fx.blur    ?? 2;
        const opacity = fx.opacity ?? 0.8;
        parts.push(`drop-shadow(0 0 ${blur}px ${hexA(color, opacity)})`);
        parts.push(`drop-shadow(0 0 ${blur * 0.5}px ${hexA(color, opacity)})`);
        break;
      }
      case "blur": {
        const blur = fx.blur ?? 2;
        parts.push(`blur(${blur}px)`);
        break;
      }
      case "stroke":
        // Handled by an SVG `feMorphology` filter (see buildStrokeFilter);
        // NOT by CSS drop-shadows, which produced aliased 8-offset rings.
        break;
      case "innerShadow":
        // Not implementable via CSS filter; skipped until SVG-filter
        // path lands.
        break;
    }
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function hexA(hex: string, opacity: number): string {
  let r = 0, g = 0, b = 0;
  const h = hex.replace("#", "");
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

function renderOne(el: Element, ctx: RenderCtx): JSX.Element | null {
  const resolved = ctx.showDefaults
    ? (el as typeof el)
    : (applyBindings(el, ctx.record, {
        variables: ctx.variables,
        palette: ctx.palette,
      }) as typeof el);
  if (resolved.hidden) return null;
  const isSel = ctx.selectedId === el.id;
  let body: JSX.Element;
  switch (resolved.type) {
    case "group":      body = renderGroup(resolved as ElementGroup, ctx); break;
    case "background": body = renderBackground(resolved as BackgroundElement); break;
    case "shape":      body = renderShape(resolved as ShapeElement); break;
    case "frame":      body = renderFrame(resolved as FrameElement); break;
    case "image":      body = renderImage(resolved as ImageElement, ctx); break;
    case "icon":       body = renderIcon(resolved as IconElement, ctx); break;
    case "text":       body = renderText(resolved as TextElement, ctx); break;
    case "stat":       body = renderStat(resolved as StatElement); break;
    default:           body = <g />;
  }
  return withTransform(body, resolved, isSel);
}

export function renderTemplate(
  canvas: CanvasSpec,
  root: ElementGroup,
  ctx: RenderCtx,
): JSX.Element {
  const r = Math.max(0, canvas.cornerRadiusMm ?? 0);
  const clipId = `canvasClip_${root.id}`;
  // viewBox is exactly the card dimensions so 1 user unit = 1 mm. This
  // keeps the SVG aligned with the host card-svg-wrap (same aspect and
  // same 1:1 mm scale) so selection overlays rendered by the caller
  // using pxPerMm line up perfectly. Ghost content for trim-preview is
  // drawn by `renderGhostOverlay` into a SEPARATE SVG.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${canvas.widthMm} ${canvas.heightMm}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            x={0} y={0}
            width={canvas.widthMm} height={canvas.heightMm}
            rx={r} ry={r}
          />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {renderGroup(root, ctx)}
      </g>

      {ctx.showTrimmed && (
        <rect
          x={0} y={0}
          width={canvas.widthMm} height={canvas.heightMm}
          rx={r} ry={r}
          fill="none"
          stroke="#2f7dd1"
          strokeWidth={0.2}
          strokeDasharray="0.6 0.4"
          pointerEvents="none"
        />
      )}
    </svg>
  );
}

/**
 * Editor-only overlay rendered BEHIND the card when "show trimmed" is on.
 * Draws the full unclipped element tree with a desaturated/grey filter so
 * the user can see what will be cropped by the card's rounded edge.
 *
 * Returns the element plus the mm-slack it expects on each side, so the
 * caller can size its container with a matching negative inset.
 */
export function renderGhostOverlay(
  canvas: CanvasSpec,
  root: ElementGroup,
  ctx: RenderCtx,
): { element: JSX.Element; slackMm: number } {
  const slackMm = Math.max(canvas.bleedMm * 2, 10);
  const ghostFx = `canvasGhost_${root.id}`;
  const element = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${-slackMm} ${-slackMm} ${canvas.widthMm + slackMm * 2} ${canvas.heightMm + slackMm * 2}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ pointerEvents: "none" }}
    >
      <defs>
        <filter id={ghostFx} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="
              0.25 0.25 0.25 0 0.25
              0.25 0.25 0.25 0 0.25
              0.25 0.25 0.25 0 0.25
              0    0    0    0.45 0"
          />
        </filter>
      </defs>
      <g filter={`url(#${ghostFx})`}>
        {renderGroup(root, ctx)}
      </g>
    </svg>
  );
  return { element, slackMm };
}

// Text layout lives in `./text.ts` (pure + testable).

