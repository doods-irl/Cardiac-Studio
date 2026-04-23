/**
 * Inline SVG icon library. Each icon is a 16×16 stroke-based glyph so
 * they're crisp at any zoom and respond to `currentColor`. Use `<Icon
 * name="..." />` anywhere in the UI.
 *
 * Add new icons by appending to PATHS. Keep them monochrome and drawn
 * on the 16×16 grid.
 */
import { memo, type CSSProperties } from "react";

const PATHS: Record<string, string> = {
  // Chrome
  save:       "M3 3h10l2 2v10H3V3zm3 0v4h6V3M6 15v-5h6v5",
  undo:       "M5 8h7a3 3 0 0 1 0 6H7M5 8l2-2M5 8l2 2",
  redo:       "M11 8H4a3 3 0 0 0 0 6h5M11 8l-2-2M11 8l-2 2",
  plus:       "M8 3v10M3 8h10",
  minus:      "M3 8h10",
  cross:      "M4 4l8 8M12 4l-8 8",
  trash:      "M4 5h8M6 5V3h4v2M5 5v9h6V5M7 7v5M9 7v5",
  check:      "M3 8l3 3 7-7",
  chevronDown:"M4 6l4 4 4-4",
  chevronR:   "M6 4l4 4-4 4",
  gear:       "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3",
  folder:     "M2 5a1 1 0 0 1 1-1h4l2 2h5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z",

  // Elements
  text:       "M3 4h10M8 4v9M6 13h4",
  rect:       "M2 3h12v10H2z",
  ellipse:    "M8 4a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9",
  image:      "M2 3h12v10H2z M2 11l4-4 3 3 3-3 2 2",
  imageDot:   "M11 6a1 1 0 1 0 0-.01",
  background: "M2 3h12v3H2z M2 7h12v3H2z M2 11h12v2H2z",
  frame:      "M3 3h10v10H3z M6 6h4v4H6z",
  group:      "M3 3h5v5H3z M8 8h5v5H8z",
  icon:       "M8 2l1.8 3.7L14 6.3l-3 2.9L11.6 14 8 12.1 4.4 14 5 9.2 2 6.3l4.2-.6L8 2z",
  mask:       "M3 8a5 5 0 1 0 10 0 5 5 0 0 0-10 0zm5-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  stat:       "M8 2l5 3v6l-5 3-5-3V5z",

  // Tabs
  design:     "M3 12l4-4 2 2 5-5M3 12v2h2M13 5l2-2",
  data:       "M2 4h12v2H2z M2 7h12v2H2z M2 10h12v2H2z M2 13h12v1H2z",
  preview:    "M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  exportIcon: "M8 2v8M5 7l3 3 3-3M3 13h10",
  assets:     "M3 3h5v5H3z M8 8h5v5H8z M8 3h5v5H8z",

  // Panel affordances
  eye:        "M2 8s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  eyeOff:     "M2 8s2.5-5 6-5c1.5 0 2.8.5 3.8 1.2M14 8s-1 2-2.6 3.4M3 3l10 10 M8 10a2 2 0 0 1-2-2",
  lock:       "M4 7h8v6H4z M6 7V5a2 2 0 0 1 4 0v2",
  unlock:     "M4 7h8v6H4z M6 7V5a2 2 0 0 1 4 0",
  upload:     "M8 3v8M5 6l3-3 3 3 M3 13h10",
  download:   "M8 3v8M5 8l3 3 3-3 M3 13h10",
  replace:    "M3 8a5 5 0 0 1 8-4 M13 8a5 5 0 0 1-8 4 M11 4h2v2 M5 12H3v-2",
  variable:   "M3 5h2l1.5 3L8 5h2l-2 5L6.5 13H4.5L6 9L3 5z M11 5a2 2 0 0 1 0 4 M11 8a2 2 0 0 1 0 4",
  palette:    "M8 2a6 6 0 0 0 0 12c1 0 1-1 0-2 a1 1 0 0 1 1-1h2a3 3 0 0 0 3-3 6 6 0 0 0-6-6z M5 7a1 1 0 1 0 0-.01 M9 5a1 1 0 1 0 0-.01 M12 8a1 1 0 1 0 0-.01",
  layers:     "M8 2l6 3-6 3-6-3 6-3z M2 8l6 3 6-3 M2 11l6 3 6-3",
  template:   "M3 3h10v3H3z M3 7h4v6H3z M8 7h5v6H8z",
  align:      "M3 3v10M6 5h7M6 8h5M6 11h6",
  font:       "M5 4h6M8 4v8M6 12h4 M3 14l2-6 3 6",
  stroke:     "M3 13L13 3 M11 3h2v2",
  filterFx:   "M3 3h10l-3 5v4l-4 2V8L3 3z",
  sparkle:    "M8 3l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z M13 10l.5 1.5L15 12l-1.5.5L13 14l-.5-1.5L11 12l1.5-.5L13 10z",

  // Shortcuts & misc
  search:     "M7 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z M11 11l3 3",
  info:       "M8 1a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M8 7v5 M8 4.5h.01",
  link:       "M7 9l-2 2a3 3 0 1 1-4-4l2-2 M9 7l2-2a3 3 0 1 1 4 4l-2 2 M6 10l4-4",

  // Canvas tools
  cursor:     "M3 2l9 4-4 1.5L6.5 12 3 2z",
  move:       "M8 2v12M2 8h12M8 2L6 4M8 2l2 2M8 14l-2-2M8 14l2-2M2 8l2-2M2 8l2 2M14 8l-2-2M14 8l-2 2",
  hand:       "M5 7V4a1 1 0 0 1 2 0v3M7 7V3a1 1 0 0 1 2 0v4M9 7V3.5a1 1 0 0 1 2 0V8M11 6a1 1 0 0 1 2 0v4a4 4 0 0 1-4 4H7a3 3 0 0 1-2.2-1L3 11a1 1 0 0 1 1.5-1.3L5 10",

  // Alignment (to parent / canvas)
  alignLeft:    "M2 2v12 M5 4h7v3H5z M5 9h5v3H5z",
  alignCenterH: "M8 2v12 M4 4h8v3H4z M5.5 9h5v3h-5z",
  alignRight:   "M14 2v12 M4 4h7v3H4z M6 9h5v3H6z",
  alignTop:     "M2 2h12 M4 5h3v7H4z M9 5h3v5H9z",
  alignMiddleV: "M2 8h12 M4 4h3v8H4z M9 5.5h3v5H9z",
  alignBottom:  "M2 14h12 M4 4h3v7H4z M9 6h3v5H9z",

  // Text alignment
  textAlignLeft:   "M2 4h12 M2 7h8 M2 10h10 M2 13h6",
  textAlignCenter: "M2 4h12 M4 7h8 M3 10h10 M5 13h6",
  textAlignRight:  "M2 4h12 M6 7h8 M4 10h10 M8 13h6",
  textAlignJustify:"M2 4h12 M2 7h12 M2 10h12 M2 13h12",
};

export interface IconProps {
  name: keyof typeof PATHS | string;
  size?: number;
  color?: string;
  filled?: boolean;
  style?: CSSProperties;
  className?: string;
  title?: string;
}

export const Icon = memo(function Icon({
  name, size = 16, color = "currentColor", filled = false, style, className, title,
}: IconProps) {
  const d = PATHS[name] ?? "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? color : "none"}
      stroke={filled ? "none" : color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
});

/** Small helper: labelled icon button. */
export function IconButton({
  icon, label, title, onClick, active, disabled, danger, accent,
}: {
  icon: string;
  label?: string;
  title?: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
}) {
  const cls = [
    "icon-btn",
    active ? "active" : "",
    danger ? "danger" : "",
    accent ? "accent" : "",
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} onClick={onClick} disabled={disabled} title={title ?? label}>
      <Icon name={icon} />
      {label ? <span>{label}</span> : null}
    </button>
  );
}
