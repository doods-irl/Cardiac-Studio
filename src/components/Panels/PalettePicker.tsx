/**
 * Properties-panel colour picker: a swatch button that drops a flyout
 * showing every palette entry plus a "Custom…" button that opens the
 * browser's native colour picker. Replaces the raw `<input type="color">`
 * so palette swatches are one click away instead of buried behind the
 * OS colour chooser.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDoc } from "@/store/document";

export interface PalettePickerProps {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
}

export function PalettePicker({ value, onChange, title }: PalettePickerProps) {
  const palette = useDoc((s) => s.loaded?.project.palette ?? []);
  const btnRef   = useRef<HTMLButtonElement>(null);
  const popRef   = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setPos(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPos(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setPos(null); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ left: r.left, top: r.bottom + 6 });
  };

  useEffect(() => {
    if (!open || !popRef.current) return;
    const m = popRef.current.getBoundingClientRect();
    const margin = 6;
    let { left, top } = pos!;
    if (left + m.width + margin > window.innerWidth) left = Math.max(margin, window.innerWidth - m.width - margin);
    if (top + m.height + margin > window.innerHeight) top = Math.max(margin, window.innerHeight - m.height - margin);
    if (left !== pos!.left || top !== pos!.top) setPos({ left, top });
  }, [open, pos?.left, pos?.top]);

  return (
    <>
      <button ref={btnRef}
        type="button"
        className="palette-picker-swatch"
        style={{ background: value || "#000" }}
        title={title ?? value}
        onClick={toggle}
      />
      {open && createPortal(
        <div ref={popRef} className="palette-picker-pop" role="menu"
          style={{ left: pos!.left, top: pos!.top }}>
          <div className="palette-picker-grid">
            {palette.length === 0 && (
              <div className="palette-picker-empty">No palette colours yet.</div>
            )}
            {palette.map((c) => (
              <button key={c.id}
                type="button"
                className={"palette-picker-chip " + (c.hex.toLowerCase() === (value || "").toLowerCase() ? "on" : "")}
                title={`${c.name} · ${c.hex}`}
                style={{ background: c.hex }}
                onClick={() => { onChange(c.hex); setPos(null); }}
              />
            ))}
          </div>
          <div className="palette-picker-custom">
            <input
              ref={customRef}
              type="color"
              value={value || "#000000"}
              onChange={(e) => onChange(e.target.value)}
            />
            <button type="button" className="palette-picker-custom-btn"
              onClick={() => customRef.current?.click()}>
              Custom…
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
