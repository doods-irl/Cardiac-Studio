/**
 * 3×3 anchor picker — click a cell to set the element's pivot to that
 * relative position. Centre is (0.5, 0.5). Rotation originates from this
 * point and alignment operations reference it.
 */
export interface AnchorPickerProps {
  value: { x: number; y: number };
  onChange: (v: { x: number; y: number }) => void;
}

const CELLS: { x: number; y: number }[] = [
  { x: 0, y: 0 },   { x: 0.5, y: 0 },   { x: 1, y: 0 },
  { x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.5 },
  { x: 0, y: 1 },   { x: 0.5, y: 1 },   { x: 1, y: 1 },
];

export function AnchorPicker({ value, onChange }: AnchorPickerProps) {
  const eq = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;

  return (
    <div className="anchor-picker" role="radiogroup" aria-label="Anchor">
      {CELLS.map((c, i) => (
        <button
          key={i}
          type="button"
          className={"anchor-cell " + (eq(value, c) ? "on" : "")}
          onClick={() => onChange(c)}
          title={`anchor ${c.x} · ${c.y}`}
          aria-label={`anchor ${c.x} ${c.y}`}
        >
          <span className="dot" />
        </button>
      ))}
    </div>
  );
}
