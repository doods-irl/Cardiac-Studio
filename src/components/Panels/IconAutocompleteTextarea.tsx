import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetRef, NamedIcon } from "@/model/types";
import { Icon } from "@/components/Shell/Icons";
import { NativeColorInput } from "./PalettePicker";

/**
 * Wrap the current textarea selection with `open`/`close` markers,
 * call `onChange` with the new content, then reselect the wrapped span
 * (caret sits between open/close tags if the selection was empty).
 * Shared between the Right-panel formatting toolbar and the data-grid
 * right-click menu so we don't diverge on edge cases (empty selection,
 * whitespace trim, re-focus on commit).
 */
function wrapSelection(
  ta: HTMLTextAreaElement,
  value: string,
  onChange: (v: string) => void,
  open: string,
  close: string,
): void {
  const start = ta.selectionStart ?? 0;
  const end   = ta.selectionEnd   ?? start;
  const before = value.slice(0, start);
  const inner  = value.slice(start, end);
  const after  = value.slice(end);
  const next = `${before}${open}${inner}${close}${after}`;
  onChange(next);
  requestAnimationFrame(() => {
    ta.focus();
    const s = before.length + open.length;
    ta.setSelectionRange(s, s + inner.length);
  });
}

export interface IconAutocompleteTextareaProps {
  value: string;
  onChange: (v: string) => void;
  icons: NamedIcon[];
  assets: AssetRef[];
  /** Optional function to resolve an asset to a displayable URL (used in previews). */
  assetUrl?: (a: AssetRef) => string;
  rows?: number;
  placeholder?: string;
  /** Optional class applied to the outer <div>. */
  className?: string;
  /** Expose the inner textarea so a parent can manipulate its selection
   *  (e.g. a rich-text formatting toolbar that wraps the highlighted
   *  text in `[b]…[/b]`). */
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
}

interface Suggestion {
  icon: NamedIcon;
  category: string | null;
  /** `{{...}}` token the user will see inserted into the textarea. */
  token: string;
  /** Search label — either `name` or `category.name`. */
  label: string;
}

/**
 * Textarea wrapper that detects `{{` at the caret and pops a filterable
 * dropdown of the project's named icons. Supports both uncategorised
 * `{{name}}` and categorised `{{category.name}}` references.
 *
 * Keyboard: ↑/↓ navigate, Enter/Tab insert, Esc dismiss.
 */
export function IconAutocompleteTextarea({
  value, onChange, icons, assets, assetUrl, rows = 3, placeholder, className, textareaRef,
}: IconAutocompleteTextareaProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (textareaRef) textareaRef.current = el;
  };
  const ref = innerRef;
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [active, setActive] = useState(0);
  const [placeAbove, setPlaceAbove] = useState(false);

  // Right-click formatting menu. Only opens when the user has a
  // non-empty selection — right-clicking plain text falls through to
  // the OS menu as expected. `ctxSel` snapshots the selection at the
  // moment of the right-click so the subsequent button click can still
  // wrap the right range even though the textarea has blurred.
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const ctxSelRef = useRef<{ start: number; end: number } | null>(null);

  // Close the context menu on any click outside, Escape, or scroll.
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [ctx]);

  // Flatten the icon list into suggestion entries, using each icon's
  // `category` field to build its display label and insertion token.
  const suggestions = useMemo<Suggestion[]>(() => {
    return icons.map((i) => {
      const cat = i.category ?? null;
      const label = cat ? `${cat}.${i.name}` : i.name;
      const token = cat ? `{{${cat}.${i.name}}}` : `{{${i.name}}}`;
      return { icon: i, category: cat, label, token };
    });
  }, [icons]);

  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return suggestions
      .filter((s) => s.label.toLowerCase().includes(q))
      .sort((a, b) => {
        // Starts-with matches rank above contains matches.
        const sa = a.label.toLowerCase().startsWith(q) ? 0 : 1;
        const sb = b.label.toLowerCase().startsWith(q) ? 0 : 1;
        return sa - sb || a.label.localeCompare(b.label);
      })
      .slice(0, 12);
  }, [suggestions, query]);

  useEffect(() => {
    if (!open) return;
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)));
  }, [open, matches.length]);

  // When the popup opens, check how much viewport space is below the
  // textarea. If the menu wouldn't fit, render it above instead. Uses
  // the menu's max-height (300 px) as the space budget.
  useEffect(() => {
    if (!open) return;
    const ta = ref.current;
    if (!ta) return;
    const rect = ta.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    setPlaceAbove(below < 320 && above > below);
  }, [open, matches.length]);

  const refresh = () => {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart ?? value.length;
    const upto = value.slice(0, pos);
    // The partial token can include a `.` separator for categories.
    const m = /\{\{([A-Za-z0-9_.-]*)$/.exec(upto);
    if (m) {
      setQuery(m[1]);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };

  const insert = (s: Suggestion) => {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart ?? value.length;
    const upto = value.slice(0, pos);
    const after = value.slice(pos);
    const openAt = upto.lastIndexOf("{{");
    if (openAt === -1) { setOpen(false); return; }
    const before = upto.slice(0, openAt);
    const next = `${before}${s.token}${after}`;
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      const c = before.length + s.token.length;
      el.setSelectionRange(c, c);
    });
  };

  const resolveAsset = (assetId: string): AssetRef | undefined =>
    assets.find((a) => a.id === assetId);

  const thumbSrc = (icon: NamedIcon): string => {
    const a = resolveAsset(icon.assetId);
    if (!a) return "";
    if (a.path.startsWith("data:") || a.path.startsWith("http")) return a.path;
    if (assetUrl) return assetUrl(a);
    return "";
  };

  return (
    <div className={"icon-ta-wrap " + (className ?? "")}>
      <textarea
        ref={setRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => { onChange(e.target.value); refresh(); }}
        onKeyDown={(e) => {
          if (!open || matches.length === 0) {
            if (e.key === "Escape") setOpen(false);
            return;
          }
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); }
          else if (e.key === "ArrowUp")  { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(matches[active]); }
          else if (e.key === "Escape")   { e.preventDefault(); setOpen(false); }
        }}
        onKeyUp={refresh}
        onClick={refresh}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onContextMenu={(e) => {
          const ta = e.currentTarget;
          const start = ta.selectionStart ?? 0;
          const end   = ta.selectionEnd   ?? start;
          // Fall through to the OS context menu when there's no
          // selection — right-click on plain text keeps spell-check,
          // paste, etc.
          if (start === end) return;
          e.preventDefault();
          ctxSelRef.current = { start, end };
          setCtx({ x: e.clientX, y: e.clientY });
        }}
      />
      {open && (
        <div className={"icon-ac" + (placeAbove ? " above" : "")} role="listbox">
          <div className="icon-ac-header">
            <Icon name="search" size={12} /> Insert icon{query ? <> · <em>{query}</em></> : null}
          </div>
          {matches.length === 0 ? (
            <div className="icon-ac-empty">
              No icons match “{query}”.
              Add icons in the Assets → Icons tab, then reference them as{" "}
              <code>&#123;&#123;name&#125;&#125;</code> or
              <code>&#123;&#123;category.name&#125;&#125;</code>.
            </div>
          ) : (
            matches.map((s, idx) => {
              const src = thumbSrc(s.icon);
              return (
                <button
                  key={s.icon.id}
                  type="button"
                  className={"icon-ac-row" + (idx === active ? " active" : "")}
                  onMouseDown={(e) => { e.preventDefault(); insert(s); }}
                  onMouseEnter={() => setActive(idx)}
                >
                  <span className="icon-ac-thumb">
                    {src ? <img src={src} alt="" /> : <Icon name="image" size={14} />}
                  </span>
                  <span className="icon-ac-name">
                    {s.category ? <><span className="icon-ac-cat">{s.category}.</span>{s.icon.name}</> : s.icon.name}
                  </span>
                  <span className="icon-ac-hint">{s.token}</span>
                </button>
              );
            })
          )}
          <div className="icon-ac-footer">
            <span>↑↓ nav</span><span>Enter insert</span><span>Esc close</span>
          </div>
        </div>
      )}
      {ctx && (() => {
        // Apply a wrap to the selection captured at right-click time,
        // then close the menu. `mousedown` on a button would fire the
        // window-level dismiss listener first; we use `onMouseDown` and
        // `stopPropagation` so our action runs before the close.
        const runWrap = (o: string, c: string) => {
          const el = ref.current;
          const sel = ctxSelRef.current;
          if (!el || !sel) { setCtx(null); return; }
          // Restore the selection Tauri/browser blur may have wiped.
          el.focus();
          el.setSelectionRange(sel.start, sel.end);
          wrapSelection(el, value, onChange, o, c);
          setCtx(null);
        };
        const stop = (e: React.MouseEvent) => e.stopPropagation();
        return (
          <div className="rt-ctx" role="menu"
            style={{ left: ctx.x, top: ctx.y }}
            onMouseDown={stop}
          >
            <button className="rt-btn" title="Bold · [b]…[/b]"
              onMouseDown={(e) => { e.preventDefault(); stop(e); runWrap("[b]", "[/b]"); }}>
              <b>B</b>
            </button>
            <button className="rt-btn" title="Italic · [i]…[/i]"
              onMouseDown={(e) => { e.preventDefault(); stop(e); runWrap("[i]", "[/i]"); }}>
              <i>I</i>
            </button>
            <button className="rt-btn" title="Underline · [u]…[/u]"
              onMouseDown={(e) => { e.preventDefault(); stop(e); runWrap("[u]", "[/u]"); }}>
              <u>U</u>
            </button>
            <label className="rt-btn rt-color" title="Colour · [c=#hex]…[/c]"
              onMouseDown={stop}>
              <NativeColorInput
                value="#000000"
                onCommit={(hex) => runWrap(`[c=${hex}]`, "[/c]")}
              />
            </label>
          </div>
        );
      })()}
    </div>
  );
}
