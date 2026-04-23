import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ContextMenuItem {
  /** Short label shown in the row. */
  label: string;
  /** Optional glyph — single character works, so does an emoji. */
  glyph?: string;
  /** Optional hint (shortcut text, displayed right-aligned). */
  hint?: string;
  /** Renders the row greyed out and ignores clicks. */
  disabled?: boolean;
  /** Draws a red accent — use for destructive actions. */
  danger?: boolean;
  /** Inserts a divider BEFORE this row. */
  separator?: boolean;
  /** Action to run when the row is chosen. */
  onSelect: () => void;
}

export interface ContextMenuProps {
  /** Anchor position — client-space coordinates (from `MouseEvent.clientX/Y`). */
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Floating context menu. Self-contained: positions itself, adjusts to
 * stay within the viewport (flips left / up if overflow), dismisses on
 * outside click, Escape, blur, or scroll. Items can be marked danger
 * (destructive styling) or disabled.
 *
 * This is a low-level primitive — callers manage their own open state
 * and pass `{ x, y }` from the `contextmenu` event.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  // Measure after mount, clamp into viewport. useLayoutEffect avoids a
  // visible one-frame jump between initial placement and the clamp.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 6;
    let left = x;
    let top  = y;
    if (left + rect.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Using capture: true on scroll catches scrolls inside nested
    // overflow containers too (the layers list, for example).
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, idx) => (
        <div key={idx}>
          {it.separator && <div className="ctx-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            className={"ctx-item" + (it.danger ? " danger" : "")}
            disabled={it.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled) return;
              it.onSelect();
              onClose();
            }}
          >
            <span className="ctx-glyph">{it.glyph ?? ""}</span>
            <span className="ctx-label">{it.label}</span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
