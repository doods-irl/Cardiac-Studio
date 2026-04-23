import type { Binding, DataRecord, PaletteColor, Predicate, Transform, Variable } from "@/model/types";

export interface ResolveCtx {
  variables?: Variable[];
  palette?: PaletteColor[];
}

/**
 * Resolve a binding against a data record.
 *
 * Order:
 *  1. pick raw value (field lookup or static)
 *  2. if missing/null/empty → fallback
 *  3. run transforms in order (var lookups need ctx.variables)
 */
export function resolveBinding(
  b: Binding | undefined,
  record: DataRecord | undefined,
  ctx?: ResolveCtx,
): unknown {
  if (!b) return undefined;
  let v: unknown;
  if (b.paletteId !== undefined) {
    // Palette-backed bindings take precedence — they represent an
    // explicit theming choice the user made.
    const entry = ctx?.palette?.find((c) => c.id === b.paletteId);
    v = entry?.hex;
  } else if (b.field !== undefined) {
    v = record ? record[b.field] : undefined;
  } else {
    v = b.static;
  }
  if (v === undefined || v === null || v === "") {
    if (b.fallback !== undefined) v = b.fallback;
  }
  if (b.transforms) {
    for (const t of b.transforms) v = applyTransform(t, v, ctx);
  }
  return v;
}

function applyTransform(t: Transform, v: unknown, ctx?: ResolveCtx): unknown {
  switch (t.kind) {
    case "upper":  return String(v ?? "").toUpperCase();
    case "lower":  return String(v ?? "").toLowerCase();
    case "title":  return String(v ?? "").replace(/\b\w/g, (c) => c.toUpperCase());
    case "prefix": return `${t.value}${v ?? ""}`;
    case "suffix": return `${v ?? ""}${t.value}`;
    case "format": return t.pattern.replace(/\{value\}/g, String(v ?? ""));
    case "map": {
      const key = String(v);
      if (Object.prototype.hasOwnProperty.call(t.map, key)) return t.map[key];
      return v;
    }
    case "number": {
      const n = Number(v);
      if (!isFinite(n)) return v;
      const fixed = t.decimals !== undefined ? n.toFixed(t.decimals) : String(n);
      return t.grouping ? Number(fixed).toLocaleString() : fixed;
    }
    case "if": {
      return matches(t.when, v) ? t.then : (t.else ?? v);
    }
    case "var": {
      const variable = ctx?.variables?.find((x) => x.id === t.variableId);
      if (!variable) return v;
      const key = v === undefined || v === null ? "" : String(v);
      if (Object.prototype.hasOwnProperty.call(variable.entries, key)) {
        return variable.entries[key];
      }
      return variable.defaultValue !== undefined ? variable.defaultValue : v;
    }
    default: return v;
  }
}

function matches(p: Predicate, v: unknown): boolean {
  switch (p.op) {
    case "eq":      return v === p.value;
    case "neq":     return v !== p.value;
    case "gt":      return Number(v) >  Number(p.value);
    case "gte":     return Number(v) >= Number(p.value);
    case "lt":      return Number(v) <  Number(p.value);
    case "lte":     return Number(v) <= Number(p.value);
    case "truthy":  return !!v;
    case "in":      return Array.isArray(p.values) && p.values.includes(v as never);
    default:        return false;
  }
}

/**
 * Apply a dotted-path update to an object immutably.
 * `setPath({a:{b:1}}, "a.b", 2) === {a:{b:2}}`
 */
export function setPath<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const next: Record<string, unknown> = Array.isArray(obj)
    ? ([...(obj as unknown as unknown[])] as unknown as Record<string, unknown>)
    : { ...(obj as Record<string, unknown>) };
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const child = cur[k];
    const copy = Array.isArray(child)
      ? [...(child as unknown[])]
      : typeof child === "object" && child !== null ? { ...(child as Record<string, unknown>) } : {};
    cur[k] = copy;
    cur = copy as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return next as T;
}

/**
 * Apply all bindings declared on an element against the given record,
 * returning a new element with resolved property values.
 */
export function applyBindings<T extends { bindings?: Record<string, Binding>; visibilityBinding?: Binding }>(
  el: T,
  record: DataRecord | undefined,
  ctx?: ResolveCtx,
): T & { hidden?: boolean } {
  let out: T & { hidden?: boolean } = el as T & { hidden?: boolean };
  if (el.bindings) {
    for (const [path, b] of Object.entries(el.bindings)) {
      const v = resolveBinding(b, record, ctx);
      if (v !== undefined) out = setPath(out, path, v) as T & { hidden?: boolean };
    }
  }
  if (el.visibilityBinding) {
    const v = resolveBinding(el.visibilityBinding, record, ctx);
    if (v === false) out = { ...out, hidden: true };
  }
  return out;
}
