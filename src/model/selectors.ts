import type { DatasetMeta, DataRecord, Element, ElementGroup, Project, Template } from "./types";

export function findTemplate(p: Project, id: string): Template | undefined {
  return p.templates.find((t) => t.id === id);
}

export function findDataset(p: Project, id: string | null): DatasetMeta | undefined {
  if (!id) return undefined;
  return p.datasets.find((d) => d.id === id);
}

/** Depth-first walk over an element tree. */
export function* walk(el: Element): Generator<Element> {
  yield el;
  if (el.type === "group") {
    for (const c of (el as ElementGroup).children) yield* walk(c);
  }
}

export function findElement(root: ElementGroup, id: string): Element | undefined {
  for (const el of walk(root)) if (el.id === id) return el;
  return undefined;
}

export function elementParent(root: ElementGroup, id: string): ElementGroup | undefined {
  for (const el of walk(root)) {
    if (el.type === "group") {
      for (const c of el.children) if (c.id === id) return el;
    }
  }
  return undefined;
}

export function firstRecord(records: Record<string, DataRecord[]>, datasetId: string | null): DataRecord | undefined {
  if (!datasetId) return undefined;
  const rows = records[datasetId];
  return rows?.[0];
}

/** Generate a CSS-friendly id-safe version of a string. */
export function toSafeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-");
}
