/**
 * 6-button alignment strip — aligns the selected element's bounding
 * box against the **parent's** local rect (the group that owns this
 * element). For top-level elements that's the root group, which has
 * the canvas dimensions, so the behaviour coincides with "align to
 * canvas". For nested elements it aligns inside the parent group.
 */

import type { Element } from "@/model/types";
import { Icon } from "@/components/Shell/Icons";

export type AlignDir =
  | "left" | "centerH" | "right"
  | "top"  | "middleV" | "bottom";

export interface AlignButtonsProps {
  el: Element;
  parentW: number;
  parentH: number;
  onAlign: (dir: AlignDir) => void;
}

const ICONS: Record<AlignDir, string> = {
  left:    "alignLeft",
  centerH: "alignCenterH",
  right:   "alignRight",
  top:     "alignTop",
  middleV: "alignMiddleV",
  bottom:  "alignBottom",
};

export function computeAlign(el: Element, parentW: number, parentH: number, dir: AlignDir): Partial<Element> {
  switch (dir) {
    case "left":    return { x: 0 };
    case "centerH": return { x: (parentW - el.w) / 2 };
    case "right":   return { x: parentW  - el.w };
    case "top":     return { y: 0 };
    case "middleV": return { y: (parentH - el.h) / 2 };
    case "bottom":  return { y: parentH  - el.h };
  }
}

export function AlignButtons({ onAlign }: AlignButtonsProps) {
  const dirs: AlignDir[] = ["left", "centerH", "right", "top", "middleV", "bottom"];
  return (
    <div className="align-row">
      {dirs.map((d) => (
        <button key={d} type="button"
          className="align-btn"
          title={`Align ${d}`}
          onClick={() => onAlign(d)}>
          <Icon name={ICONS[d]} size={14} />
        </button>
      ))}
    </div>
  );
}
