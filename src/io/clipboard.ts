/**
 * Session-local element clipboard shared between the Ctrl+C / Ctrl+V
 * keyboard shortcut and the layer-tree right-click menu. Both callers
 * read / write through the same module-level slot so a layer copied
 * via keyboard is paste-able via menu and vice versa.
 *
 * Deliberately NOT using the OS clipboard: copied elements can
 * reference assets and variables by id, which are project-local
 * identifiers. A cross-project paste would produce dangling
 * references, so we scope the clipboard to this session only.
 */

import type { Element } from "@/model/types";

let slot: Element | null = null;

/** Snapshot an element (deep clone) into the clipboard. */
export function setElementClipboard(el: Element): void {
  // structuredClone handles the nested GroupElement.children tree so
  // group copies are fully detached from the source.
  slot = structuredClone(el);
}

/** Read the currently-stashed element, or `null` if nothing's been copied. */
export function getElementClipboard(): Element | null {
  return slot;
}

/** `true` when something has been copied in this session. */
export function hasElementClipboard(): boolean {
  return slot !== null;
}

/** Forget the clipboard (rarely useful; exposed for tests). */
export function clearElementClipboard(): void {
  slot = null;
}
