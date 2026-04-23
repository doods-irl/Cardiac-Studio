import { useEffect, useRef, useState } from "react";

/**
 * Unity-style numeric control. Click-and-drag horizontally to scrub the
 * value. Double-click to type an exact value. Hold Shift for 10× step,
 * Alt for 0.1× step. Escape cancels a text edit, Enter commits.
 *
 * Value display precision tracks `step`: 1 → 0 dp, 0.1 → 1 dp, 0.01 → 2 dp.
 */
export interface DragNumberProps {
  value: number;
  onChange: (n: number) => void;
  /** Base step per pixel of horizontal drag. Default 0.1. */
  step?: number;
  min?: number;
  max?: number;
  /** Optional label shown at the start of the control (e.g. "X"). */
  label?: string;
  /** Optional unit shown at the end ("mm", "°", "%"). */
  unit?: string;
  /** Display precision override; auto-derived from step by default. */
  precision?: number;
  /** Keeps the integer input feel for pure integer fields. */
  integer?: boolean;
  /** Applied to the outer span for styling hooks. */
  className?: string;
  /** Disable drag / edit entirely. */
  disabled?: boolean;
}

export function DragNumber({
  value, onChange, step = 0.1, min, max,
  label, unit, precision, integer, className, disabled,
}: DragNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const dragRef = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const clamp = (n: number) => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return integer ? Math.round(v) : v;
  };

  const dp = precision ?? (integer ? 0 : step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);
  const display = (Number.isFinite(value) ? value : 0).toFixed(dp);

  const onMouseDown = (e: React.MouseEvent) => {
    if (disabled || editing) return;
    if (e.button !== 0) return;
    e.preventDefault();

    // Movement threshold before we treat the gesture as a drag (not a
    // click). Under the threshold, mouseup enters edit mode instead.
    const DRAG_THRESHOLD = 3;

    // Snapshot the initial display so setDraft after a click uses the
    // value at the moment of the click, not whatever value has become
    // during layout races.
    const startingDraft = display;

    // Guard: if the prop value is undefined / NaN (e.g. optional
    // effect field not yet written), treat it as zero for the drag
    // math so we don't produce NaN and round that down to 0 on the
    // first scrub tick.
    const safeStart = Number.isFinite(value) ? value : 0;
    let acc = safeStart;
    let totalMoved = 0;
    let cleanedUp = false;
    dragRef.current = { startX: e.clientX, startValue: safeStart, moved: false };

    // Plain-mousemove scrubbing — no pointer lock. Pointer lock gave us
    // infinite scroll past the window edge but introduced two races:
    // `clientX` zeroes synchronously on grant while `pointerLockElement`
    // only populates a frame later, and Chrome fires a large catch-up
    // `movementX` when the cursor snaps to the lock centre. Both would
    // clamp the value to `min` on a fast drag. Regular mousemove reports
    // `movementX` cleanly; the cost is the cursor stops at the viewport
    // edge instead of wrapping.
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      totalMoved += Math.abs(ev.movementX) + Math.abs(ev.movementY);

      // Promote gesture to "drag" once we've crossed the threshold.
      if (!dragRef.current.moved) {
        if (totalMoved < DRAG_THRESHOLD) return;
        dragRef.current.moved = true;
        document.body.style.cursor = "ew-resize";
      }

      let perPx = step;
      if (ev.shiftKey) perPx = step * 10;
      else if (ev.altKey) perPx = step * 0.1;

      acc = clamp(acc + ev.movementX * perPx);
      onChange(acc);
    };

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      const wasDrag = dragRef.current?.moved ?? false;
      dragRef.current = null;
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);

      // No drag = the user clicked. Enter edit mode with the current
      // value as the draft and the text pre-selected (the useEffect
      // below handles focus + select).
      if (!wasDrag) {
        setDraft(startingDraft);
        setEditing(true);
      }
    };
    const onUp = cleanup;

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed)) onChange(clamp(parsed));
    setEditing(false);
  };

  if (editing) {
    return (
      <span className={"drag-num editing " + (className ?? "")}>
        {label && <span className="drag-num-label">{label}</span>}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); setEditing(false); }
          }}
        />
        {unit && <span className="drag-num-unit">{unit}</span>}
      </span>
    );
  }

  return (
    <span
      className={"drag-num " + (className ?? "") + (disabled ? " disabled" : "")}
      onMouseDown={onMouseDown}
      title="Click to type · drag to scrub · Shift=10× · Alt=0.1×"
    >
      {label && <span className="drag-num-label">{label}</span>}
      <span className="drag-num-value">{display}</span>
      {unit && <span className="drag-num-unit">{unit}</span>}
    </span>
  );
}
