/**
 * Document store — the single source of truth for everything that is
 * persisted to a project folder. The rest of the app subscribes to
 * slices of this via zustand selectors.
 *
 * UI-only state (selection, zoom, active tab, dialogs) lives in
 * `editor.ts` and is intentionally kept out of the save payload.
 */

import { create } from "zustand";
import type {
  AssetRef, DataRecord, DatasetMeta, Element, ElementGroup, FieldDef,
  FontRef, LoadedProject, NamedIcon, NamedImage,
  PaletteColor, Project, Template, TextElement, Variable,
} from "@/model/types";
import { newId } from "@/model/ids";
import { elementParent, findElement, walk } from "@/model/selectors";
import { defaultTemplate } from "@/model/defaults";

interface DocState {
  loaded: LoadedProject | null;
  dirty: boolean;

  /** Epoch-ms timestamp of the most recent successful save. Drives the
   *  "Saved" toast / title-bar chip so the UI can flash confirmation
   *  without each caller wiring a local bit of state. `null` means the
   *  project hasn't been saved this session. */
  lastSavedAt: number | null;

  // History (simple snapshot-based — collapses fast edits via debouncing).
  past: LoadedProject[];
  future: LoadedProject[];

  set(patch: Partial<DocState>): void;
  load(p: LoadedProject): void;
  markSaved(m: LoadedProject["manifest"]): void;

  // Mutators — all go through this to trigger history + dirty flag.
  mutate(fn: (p: LoadedProject) => LoadedProject, opts?: { coalesce?: string }): void;
  undo(): void;
  redo(): void;

  // Convenience operations
  addElement(templateId: string, el: Element, parentId?: string): void;
  updateElement(templateId: string, id: string, patch: Partial<Element>): void;
  deleteElement(templateId: string, id: string): void;
  duplicateElement(templateId: string, id: string): void;
  /** Move an element up (later in array = higher z) or down within its parent. */
  moveElement(templateId: string, id: string, direction: "up" | "down"): void;
  /** Wrap the given element in a new group (group inherits its x/y; child resets to 0/0). */
  wrapInGroup(templateId: string, id: string): void;
  /** Dissolve a group: its children replace the group in its parent. No-op if not a group. */
  unwrapGroup(templateId: string, id: string): void;
  /**
   * Move `childId` to a new location in the tree relative to `targetId`:
   *  - "child":  become a child of target (auto-wrapping non-group targets in a new group)
   *  - "before": insert as target's previous sibling at the same level
   *  - "after":  insert as target's next sibling
   *
   * The element's local coordinates are adjusted so its WORLD position
   * (on the canvas) is preserved across the move.
   *
   * No-op if the operation would create a cycle (moving a group into
   * its own descendant).
   */
  moveElementTo(
    templateId: string, childId: string, targetId: string,
    position: "child" | "before" | "after"
  ): void;

  addTemplate(): void;
  removeTemplate(id: string): void;
  /** Deep-copy a template into a new one with fresh ids on every
   *  element and " copy" appended to the name. Returns the new id. */
  duplicateTemplate(id: string): string | null;

  addDataset(name?: string): string;
  addField(datasetId: string, field: FieldDef): void;
  removeField(datasetId: string, fieldId: string): void;

  addRecord(datasetId: string, values?: Record<string, unknown>): string;
  updateRecord(datasetId: string, rowId: string, patch: Record<string, unknown>): void;
  deleteRecord(datasetId: string, rowId: string): void;
  /** Insert a copy of the row right after the source. Returns the new
   *  record's id so callers can focus it / scroll to it. */
  duplicateRecord(datasetId: string, rowId: string): string | null;

  /** Paste a previously-captured element tree into a template. The
   *  input is expected to carry duplicate-ready data (no id collisions
   *  are allowed; this function reids the tree internally). */
  pasteElement(templateId: string, el: Element, parentId?: string): string;

  addAsset(asset: AssetRef): void;
  removeAsset(id: string): void;
  /**
   * Swap in a different file for an existing asset — keeps its id so
   * every reference (gallery entries, data-cell image fields, image
   * elements' assetId bindings) stays valid. The new file's path,
   * hash, original name, and dimensions replace the old ones.
   */
  replaceAssetFile(id: string, replacement: Omit<AssetRef, "id" | "kind">): void;
  addFont(asset: AssetRef, font: FontRef): void;
  removeFont(fontId: string): void;

  addVariable(v?: Partial<Variable>): string;
  updateVariable(id: string, patch: Partial<Variable>): void;
  removeVariable(id: string): void;
  setVariableEntry(id: string, key: string, value: unknown): void;
  renameVariableEntry(id: string, oldKey: string, newKey: string): void;
  removeVariableEntry(id: string, key: string): void;

  addIcon(name: string, assetId: string, category?: string): string;
  renameIcon(id: string, name: string): void;
  removeIcon(id: string): void;
  /** Move an icon to a category (or to uncategorised when null). */
  setIconCategory(id: string, category: string | null): void;
  /** Reorder an icon within the flat array. Target may be in a
   *  different category; the icon's category is updated to match. */
  moveIcon(id: string, targetId: string | null, position: "before" | "after" | "end", targetCategory: string | null): void;
  addIconCategory(name: string): void;
  renameIconCategory(oldName: string, newName: string): void;
  removeIconCategory(name: string): void;

  addImage(assetId: string, name: string, category?: string): string;
  renameImage(id: string, name: string): void;
  removeImage(id: string): void;
  setImageCategory(id: string, category: string | null): void;
  moveImage(id: string, targetId: string | null, position: "before" | "after" | "end", targetCategory: string | null): void;
  addImageCategory(name: string): void;
  renameImageCategory(oldName: string, newName: string): void;
  removeImageCategory(name: string): void;

  addPaletteColor(hex: string, name?: string): string;
  updatePaletteColor(id: string, patch: Partial<PaletteColor>): void;
  removePaletteColor(id: string): void;
  /** Insert a copy of the given swatch immediately after the source,
   *  with " copy" appended to the name. Useful for spinning up palette
   *  variations without losing the original. Returns the new id. */
  duplicatePaletteColor(id: string): string | null;
}

const MAX_HISTORY = 200;
let lastCoalesceKey: string | null = null;
let lastCoalesceTime = 0;
const COALESCE_MS = 500;

export const useDoc = create<DocState>((set, get) => ({
  loaded: null,
  dirty: false,
  lastSavedAt: null,
  past: [],
  future: [],

  set: (patch) => set(patch),

  load: (p) => {
    // Back-fill optional top-level arrays that pre-variables projects may lack
    // so the UI can assume they're always present.
    // Migrate icons. We support three historical shapes:
    //   1. Old NamedIcon[] with no `kind` field.
    //   2. Interleaved IconEntry[] with `kind: "separator"` entries
    //      marking category boundaries (walked to compute category).
    //   3. New field-based NamedIcon[] with `category?: string`.
    // All three collapse to (NamedIcon[], iconCategories[]).
    const projectLoose = p.project as unknown as Record<string, unknown>;
    const rawIcons = (projectLoose.icons ?? []) as Array<Record<string, unknown>>;
    const iconCatsSet = new Set<string>(
      (projectLoose.iconCategories as string[] | undefined) ?? [],
    );
    const flatIcons: NamedIcon[] = [];
    let walkCat: string | null = null;
    for (const raw of rawIcons) {
      if (raw.kind === "separator") {
        const n = String(raw.name ?? "").trim();
        if (n) { iconCatsSet.add(n); walkCat = n; }
        continue;
      }
      const cat = typeof raw.category === "string" && raw.category
        ? raw.category
        : walkCat ?? undefined;
      if (cat) iconCatsSet.add(cat);
      flatIcons.push({
        kind: "icon",
        id: String(raw.id),
        name: String(raw.name ?? "icon"),
        assetId: String(raw.assetId ?? ""),
        ...(cat ? { category: cat } : {}),
      });
    }

    // Image gallery: seed from image-kind assets if empty.
    const rawImages = ((projectLoose.imageGallery as NamedImage[] | undefined) ?? []);
    const imageCatsSet = new Set<string>(
      (projectLoose.imageCategories as string[] | undefined) ?? [],
    );
    const assetsArr = p.project.assets ?? [];
    const seededImages: NamedImage[] = rawImages.length > 0
      ? rawImages.map((i) => ({ ...i, kind: "image" as const }))
      : assetsArr
          .filter((a) => a.kind === "image")
          .map((a) => ({
            kind: "image" as const,
            id: newId(),
            name: a.originalName.replace(/\.[^.]+$/, ""),
            assetId: a.id,
          }));
    for (const im of seededImages) if (im.category) imageCatsSet.add(im.category);

    const project: Project = {
      ...p.project,
      variables:       p.project.variables ?? [],
      icons:           flatIcons,
      iconCategories:  Array.from(iconCatsSet),
      imageGallery:    seededImages,
      imageCategories: Array.from(imageCatsSet),
      fonts:           p.project.fonts   ?? [],
      assets:          p.project.assets  ?? [],
      styles:          p.project.styles  ?? [],
      palette:         p.project.palette ?? [],
    };
    set({ loaded: { ...p, project }, dirty: false, past: [], future: [] });
  },

  markSaved: (m) =>
    set((s) =>
      s.loaded
        ? { loaded: { ...s.loaded, manifest: m }, dirty: false, lastSavedAt: Date.now() }
        : s
    ),

  mutate: (fn, opts) => {
    const state = get();
    if (!state.loaded) return;
    const now = Date.now();
    const coalesce =
      !!opts?.coalesce &&
      lastCoalesceKey === opts.coalesce &&
      now - lastCoalesceTime < COALESCE_MS;

    const prev = state.loaded;
    const next = fn(prev);
    if (next === prev) return;

    const past = coalesce ? state.past : [...state.past, prev].slice(-MAX_HISTORY);
    lastCoalesceKey = opts?.coalesce ?? null;
    lastCoalesceTime = now;

    set({
      loaded: next,
      past,
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const s = get();
    if (!s.loaded || s.past.length === 0) return;
    const last = s.past[s.past.length - 1];
    set({
      loaded: last,
      past: s.past.slice(0, -1),
      future: [s.loaded, ...s.future],
      dirty: true,
    });
  },

  redo: () => {
    const s = get();
    if (!s.loaded || s.future.length === 0) return;
    const next = s.future[0];
    set({
      loaded: next,
      past: [...s.past, s.loaded],
      future: s.future.slice(1),
      dirty: true,
    });
  },

  addElement: (templateId, el, parentId) => {
    get().mutate((p) => {
      const tpl = p.project.templates.find((t) => t.id === templateId);
      if (!tpl) return p;
      const newTemplates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        return {
          ...t,
          root: insertInto(t.root, parentId ?? t.root.id, el),
        };
      });
      return setProject(p, { ...p.project, templates: newTemplates });
    });
  },

  updateElement: (templateId, id, patch) => {
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        return { ...t, root: mapTree(t.root, (el) => el.id === id ? { ...el, ...patch } as Element : el) };
      });
      return setProject(p, { ...p.project, templates });
    }, { coalesce: `el-${id}` });
  },

  deleteElement: (templateId, id) => {
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        return { ...t, root: removeFrom(t.root, id) };
      });
      return setProject(p, { ...p.project, templates });
    });
  },

  duplicateElement: (templateId, id) => {
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        const src = findElement(t.root, id);
        if (!src) return t;
        const dup = reid({ ...src, x: src.x + 2, y: src.y + 2, name: src.name + " copy" });
        const parent = elementParent(t.root, id) ?? t.root;
        return { ...t, root: insertInto(t.root, parent.id, dup) };
      });
      return setProject(p, { ...p.project, templates });
    });
  },

  moveElement: (templateId, id, direction) => {
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        return { ...t, root: reorderInParent(t.root, id, direction) };
      });
      return setProject(p, { ...p.project, templates });
    });
  },

  wrapInGroup: (templateId, id) => {
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        return { ...t, root: wrapInGroupTree(t.root, id) };
      });
      return setProject(p, { ...p.project, templates });
    });
  },

  unwrapGroup: (templateId, id) => {
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        return { ...t, root: unwrapGroupTree(t.root, id) };
      });
      return setProject(p, { ...p.project, templates });
    });
  },

  moveElementTo: (templateId, childId, targetId, position) => {
    get().mutate((p) => {
      if (childId === targetId) return p;
      const tpl = p.project.templates.find((t) => t.id === templateId);
      if (!tpl) return p;

      // Prevent cycles: if the dragged element contains the target, bail.
      if (treeContains(tpl.root, childId, targetId)) return p;

      const origLoc = locate(tpl.root, childId);
      if (!origLoc) return p;
      const origWorld = {
        x: origLoc.ancestorsX + origLoc.el.x,
        y: origLoc.ancestorsY + origLoc.el.y,
      };

      // Build the tree with the element removed from its current slot.
      const pruned = pruneFromTree(tpl.root, childId);
      if (!pruned) return p;

      const targetLoc = locate(pruned, targetId);
      if (!targetLoc) return p;

      const movedBase: Element = { ...origLoc.el };
      let nextRoot: ElementGroup;

      if (position === "child") {
        if (targetLoc.el.type === "group") {
          // Child of existing group. Local = world - (target's world basis).
          const targetBasisX = targetLoc.ancestorsX + targetLoc.el.x;
          const targetBasisY = targetLoc.ancestorsY + targetLoc.el.y;
          const moved: Element = {
            ...movedBase,
            x: origWorld.x - targetBasisX,
            y: origWorld.y - targetBasisY,
          };
          nextRoot = appendChildToGroup(pruned, targetId, moved);
        } else {
          // Target is a leaf: wrap it in a new group at its position.
          // Target becomes (0,0) inside the group; dropped element
          // keeps its world position relative to the new group.
          const groupBasisX = targetLoc.ancestorsX + targetLoc.el.x;
          const groupBasisY = targetLoc.ancestorsY + targetLoc.el.y;
          const moved: Element = {
            ...movedBase,
            x: origWorld.x - groupBasisX,
            y: origWorld.y - groupBasisY,
          };
          nextRoot = wrapTargetAndAdd(pruned, targetId, moved);
        }
      } else {
        // Insert as sibling of target. New ancestors = target's ancestors.
        const moved: Element = {
          ...movedBase,
          x: origWorld.x - targetLoc.ancestorsX,
          y: origWorld.y - targetLoc.ancestorsY,
        };
        nextRoot = insertSibling(pruned, targetId, moved, position);
      }

      const templates = p.project.templates.map((t) =>
        t.id === templateId ? { ...t, root: nextRoot } : t,
      );
      return setProject(p, { ...p.project, templates });
    });
  },

  addTemplate: () => {
    get().mutate((p) => {
      const tpl: Template = defaultTemplate(p.project.canvasDefaults);
      tpl.name = `Card ${p.project.templates.length + 1}`;
      return setProject(p, { ...p.project, templates: [...p.project.templates, tpl] });
    });
  },

  removeTemplate: (id) => {
    get().mutate((p) =>
      setProject(p, { ...p.project, templates: p.project.templates.filter((t) => t.id !== id) })
    );
  },

  duplicateTemplate: (id) => {
    const src = get().loaded?.project.templates.find((t) => t.id === id);
    if (!src) return null;
    const newTplId = newId();
    get().mutate((p) => {
      const idx = p.project.templates.findIndex((t) => t.id === id);
      if (idx < 0) return p;
      // Deep-clone canvas (plain data) and reid the element tree so
      // nothing shares element ids between the two templates.
      const root = reid({ ...src.root }) as ElementGroup;
      const copy: Template = {
        id: newTplId,
        name: `${src.name} copy`,
        datasetId: src.datasetId,
        canvas: { ...src.canvas },
        root,
      };
      const templates = [
        ...p.project.templates.slice(0, idx + 1),
        copy,
        ...p.project.templates.slice(idx + 1),
      ];
      return setProject(p, { ...p.project, templates });
    });
    return newTplId;
  },

  addDataset: (name) => {
    const id = newId();
    get().mutate((p) => {
      const ds: DatasetMeta = {
        id,
        name: name ?? `Dataset ${p.project.datasets.length + 1}`,
        fields: [
          // Seed with a single text field so the grid isn't unusable
          // right after creation. Users can rename or remove it.
          { id: newId(), name: "name", type: "text", width: 160 },
        ],
      };
      const records = { ...p.records, [id]: [] };
      return { ...p, project: { ...p.project, datasets: [...p.project.datasets, ds] }, records };
    });
    return id;
  },

  addField: (datasetId, field) => {
    get().mutate((p) => {
      const datasets = p.project.datasets.map((d) =>
        d.id === datasetId ? { ...d, fields: [...d.fields, field] } : d
      );
      return setProject(p, { ...p.project, datasets });
    });
  },

  removeField: (datasetId, fieldId) => {
    get().mutate((p) => {
      const ds = p.project.datasets.find((d) => d.id === datasetId);
      const fieldName = ds?.fields.find((f) => f.id === fieldId)?.name;
      const datasets = p.project.datasets.map((d) =>
        d.id === datasetId ? { ...d, fields: d.fields.filter((f) => f.id !== fieldId) } : d
      );
      let records = p.records;
      if (fieldName) {
        const rows = (records[datasetId] ?? []).map((r) => {
          const { [fieldName]: _drop, ...rest } = r;
          void _drop;
          return rest as DataRecord;
        });
        records = { ...records, [datasetId]: rows };
      }
      return { ...p, project: { ...p.project, datasets }, records };
    });
  },

  addRecord: (datasetId, values = {}) => {
    const id = newId();
    get().mutate((p) => {
      const ds = p.project.datasets.find((d) => d.id === datasetId);
      const seed: Record<string, unknown> = {};
      ds?.fields.forEach((f) => (seed[f.name] = values[f.name] ?? f.default ?? defaultForType(f)));
      const row: DataRecord = { id, ...seed };
      const list = [...(p.records[datasetId] ?? []), row];
      return { ...p, records: { ...p.records, [datasetId]: list } };
    });
    return id;
  },

  updateRecord: (datasetId, rowId, patch) => {
    get().mutate((p) => {
      const list = (p.records[datasetId] ?? []).map((r) => r.id === rowId ? { ...r, ...patch } : r);
      return { ...p, records: { ...p.records, [datasetId]: list } };
    }, { coalesce: `row-${rowId}` });
  },

  deleteRecord: (datasetId, rowId) => {
    get().mutate((p) => {
      const list = (p.records[datasetId] ?? []).filter((r) => r.id !== rowId);
      return { ...p, records: { ...p.records, [datasetId]: list } };
    });
  },

  duplicateRecord: (datasetId, rowId) => {
    const list = get().loaded?.records[datasetId] ?? [];
    const src = list.find((r) => r.id === rowId);
    if (!src) return null;
    const newRowId = newId();
    get().mutate((p) => {
      const cur = p.records[datasetId] ?? [];
      const idx = cur.findIndex((r) => r.id === rowId);
      if (idx < 0) return p;
      // Spread then override id so the copy is a plain shallow clone.
      // Record values are strings / numbers / booleans / asset ids, so
      // shallow copy is fine here (no nested mutable structures).
      const copy: DataRecord = { ...src, id: newRowId };
      const next = [...cur.slice(0, idx + 1), copy, ...cur.slice(idx + 1)];
      return { ...p, records: { ...p.records, [datasetId]: next } };
    });
    return newRowId;
  },

  pasteElement: (templateId, el, parentId) => {
    const freshRootId = newId();
    get().mutate((p) => {
      const templates = p.project.templates.map((t) => {
        if (t.id !== templateId) return t;
        // Reid the whole tree — callers may paste the same clipboard
        // contents multiple times, so each paste must produce unique
        // ids. Nudge the root +2/+2 to match duplicateElement's feel.
        const clone = reid({ ...el, x: el.x + 2, y: el.y + 2 });
        clone.id = freshRootId;
        const target = parentId && findElement(t.root, parentId)?.type === "group"
          ? parentId
          : t.root.id;
        return { ...t, root: insertInto(t.root, target, clone) };
      });
      return setProject(p, { ...p.project, templates });
    });
    return freshRootId;
  },

  // ── Assets & Fonts ───────────────────────────────────────────────
  addAsset: (asset) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      assets: [...p.project.assets, asset],
    }));
  },
  removeAsset: (id) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      assets: p.project.assets.filter((a) => a.id !== id),
      // Cascade: drop any font / icon / image-gallery entry referencing it.
      fonts: p.project.fonts.filter((f) => f.assetId !== id),
      icons: (p.project.icons ?? []).filter((i) => i.assetId !== id),
      imageGallery: (p.project.imageGallery ?? []).filter((im) => im.assetId !== id),
    }));
  },
  replaceAssetFile: (id, replacement) => {
    get().mutate((p) => {
      const existing = p.project.assets.find((a) => a.id === id);
      if (!existing) return p;
      // Preserve id + kind; swap everything file-related.
      const next: AssetRef = {
        ...existing,
        path: replacement.path,
        hash: replacement.hash,
        originalName: replacement.originalName,
        width: replacement.width,
        height: replacement.height,
        family: replacement.family,
        weight: replacement.weight,
      };
      return setProject(p, {
        ...p.project,
        assets: p.project.assets.map((a) => a.id === id ? next : a),
      });
    });
  },
  addFont: (asset, font) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      assets: [...p.project.assets, asset],
      fonts:  [...p.project.fonts,  font],
    }));
  },
  removeFont: (fontId) => {
    get().mutate((p) => {
      const font = p.project.fonts.find((f) => f.id === fontId);
      const assets = font
        ? p.project.assets.filter((a) => a.id !== font.assetId)
        : p.project.assets;
      return setProject(p, {
        ...p.project,
        assets,
        fonts: p.project.fonts.filter((f) => f.id !== fontId),
      });
    });
  },

  // ── Variables ────────────────────────────────────────────────────
  addVariable: (v) => {
    const id = newId();
    get().mutate((p) => {
      const full: Variable = {
        id,
        name: v?.name ?? `variable${(p.project.variables?.length ?? 0) + 1}`,
        description: v?.description,
        keyType:   v?.keyType   ?? "enum",
        enumOptions: v?.enumOptions ?? [],
        valueType: v?.valueType ?? "image",
        entries:   v?.entries   ?? {},
        defaultValue: v?.defaultValue,
      };
      return setProject(p, {
        ...p.project,
        variables: [...(p.project.variables ?? []), full],
      });
    });
    return id;
  },
  updateVariable: (id, patch) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      variables: (p.project.variables ?? []).map((v) => v.id === id ? { ...v, ...patch } : v),
    }));
  },
  removeVariable: (id) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      variables: (p.project.variables ?? []).filter((v) => v.id !== id),
    }));
  },
  setVariableEntry: (id, key, value) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      variables: (p.project.variables ?? []).map((v) => {
        if (v.id !== id) return v;
        return { ...v, entries: { ...v.entries, [key]: value } };
      }),
    }));
  },
  renameVariableEntry: (id, oldKey, newKey) => {
    if (oldKey === newKey || !newKey) return;
    get().mutate((p) => setProject(p, {
      ...p.project,
      variables: (p.project.variables ?? []).map((v) => {
        if (v.id !== id) return v;
        const { [oldKey]: val, ...rest } = v.entries;
        return { ...v, entries: { ...rest, [newKey]: val } };
      }),
    }));
  },
  removeVariableEntry: (id, key) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      variables: (p.project.variables ?? []).map((v) => {
        if (v.id !== id) return v;
        const { [key]: _drop, ...rest } = v.entries;
        void _drop;
        return { ...v, entries: rest };
      }),
    }));
  },

  // ── Icon gallery ────────────────────────────────────────────────
  //
  // Each icon has a `category` field; `iconCategories` is a registry
  // of defined category names (enables empty categories). Renaming or
  // recategorising an icon rewrites every `{{…}}` token in text
  // elements and string-typed dataset cells via `applyIconRipple`.
  addIcon: (name, assetId, category) => {
    const id = newId();
    get().mutate((p) => {
      const icons = p.project.icons ?? [];
      const safe = sanitiseIconName(name);
      const unique = uniqueIconName(icons, safe, undefined, category ?? null);
      const icon: NamedIcon = {
        kind: "icon", id, name: unique, assetId,
        ...(category ? { category } : {}),
      };
      const cats = category && !(p.project.iconCategories ?? []).includes(category)
        ? [...(p.project.iconCategories ?? []), category]
        : (p.project.iconCategories ?? []);
      return setProject(p, {
        ...p.project,
        icons: [...icons, icon],
        iconCategories: cats,
      });
    });
    return id;
  },
  renameIcon: (id, name) => {
    get().mutate((p) => {
      const icons = p.project.icons ?? [];
      const cur = icons.find((i) => i.id === id);
      if (!cur) return p;
      const safe = sanitiseIconName(name);
      if (!safe) return p;
      const unique = uniqueIconName(icons, safe, id, cur.category ?? null);
      if (unique === cur.name) return p;
      const next = icons.map((i) => i.id === id ? { ...i, name: unique } : i);
      return applyIconRipple(p, icons, next);
    });
  },
  removeIcon: (id) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      icons: (p.project.icons ?? []).filter((i) => i.id !== id),
    }));
  },
  setIconCategory: (id, category) => {
    get().mutate((p) => {
      const icons = p.project.icons ?? [];
      const cur = icons.find((i) => i.id === id);
      if (!cur) return p;
      const target = category || undefined;
      if ((cur.category ?? undefined) === target) return p;
      // Uniqueness is scoped to category — rename on collision.
      const unique = uniqueIconName(icons, cur.name, id, target ?? null);
      const next = icons.map((i) =>
        i.id === id ? { ...i, name: unique, ...(target ? { category: target } : {}), ...(!target ? { category: undefined } : {}) } : i,
      );
      // Preserve the target category in the registry even if no icon
      // remains in another category; add if missing.
      const cats = target && !(p.project.iconCategories ?? []).includes(target)
        ? [...(p.project.iconCategories ?? []), target]
        : (p.project.iconCategories ?? []);
      return applyIconRipple({ ...p, project: { ...p.project, iconCategories: cats } }, icons, next);
    });
  },
  moveIcon: (id, targetId, position, targetCategory) => {
    get().mutate((p) => {
      const icons = p.project.icons ?? [];
      const src = icons.find((i) => i.id === id);
      if (!src) return p;
      const cat = targetCategory || undefined;
      // Rename if it would collide within the destination category.
      const unique = uniqueIconName(icons, src.name, id, cat ?? null);
      const moved: NamedIcon = {
        ...src, name: unique,
        ...(cat ? { category: cat } : { category: undefined }),
      };
      const without = icons.filter((i) => i.id !== id);
      let insertAt: number;
      if (!targetId || position === "end") {
        // Append at the end of whatever category `cat` is — i.e. after
        // the last icon in that category.
        const lastIdxInCat = findLastIndex(without, (i) => (i.category ?? undefined) === cat);
        insertAt = lastIdxInCat === -1 ? without.length : lastIdxInCat + 1;
      } else {
        const idx = without.findIndex((i) => i.id === targetId);
        if (idx < 0) return p;
        insertAt = position === "before" ? idx : idx + 1;
      }
      const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];
      const cats = cat && !(p.project.iconCategories ?? []).includes(cat)
        ? [...(p.project.iconCategories ?? []), cat]
        : (p.project.iconCategories ?? []);
      return applyIconRipple({ ...p, project: { ...p.project, iconCategories: cats } }, icons, next);
    });
  },
  addIconCategory: (name) => {
    get().mutate((p) => {
      const safe = name.trim();
      if (!safe) return p;
      const list = p.project.iconCategories ?? [];
      if (list.includes(safe)) return p;
      return setProject(p, { ...p.project, iconCategories: [...list, safe] });
    });
  },
  renameIconCategory: (oldName, newName) => {
    get().mutate((p) => {
      const safe = newName.trim();
      if (!safe || safe === oldName) return p;
      const list = p.project.iconCategories ?? [];
      if (!list.includes(oldName)) return p;
      // Category list
      const nextList = list.filter((c) => c !== oldName);
      if (!nextList.includes(safe)) nextList.push(safe);
      // Reassign icons
      const icons = p.project.icons ?? [];
      const next = icons.map((i) => i.category === oldName ? { ...i, category: safe } : i);
      return applyIconRipple({ ...p, project: { ...p.project, iconCategories: nextList } }, icons, next);
    });
  },
  removeIconCategory: (name) => {
    get().mutate((p) => {
      const list = p.project.iconCategories ?? [];
      const icons = p.project.icons ?? [];
      const next = icons.map((i) => i.category === name ? { ...i, category: undefined } : i);
      const nextList = list.filter((c) => c !== name);
      return applyIconRipple({ ...p, project: { ...p.project, iconCategories: nextList } }, icons, next);
    });
  },

  // ── Image gallery ───────────────────────────────────────────────
  //
  // Images are referenced in data cells by asset.id (stable), so
  // name/category changes don't need a ripple.
  addImage: (assetId, name, category) => {
    const id = newId();
    get().mutate((p) => {
      const gallery = p.project.imageGallery ?? [];
      const img: NamedImage = {
        kind: "image", id, name: name || "image", assetId,
        ...(category ? { category } : {}),
      };
      const cats = category && !(p.project.imageCategories ?? []).includes(category)
        ? [...(p.project.imageCategories ?? []), category]
        : (p.project.imageCategories ?? []);
      return setProject(p, { ...p.project, imageGallery: [...gallery, img], imageCategories: cats });
    });
    return id;
  },
  renameImage: (id, name) => {
    get().mutate((p) => {
      const gallery = p.project.imageGallery ?? [];
      const cur = gallery.find((i) => i.id === id);
      if (!cur) return p;
      const safe = name.trim();
      if (!safe || safe === cur.name) return p;
      return setProject(p, {
        ...p.project,
        imageGallery: gallery.map((i) => i.id === id ? { ...i, name: safe } : i),
      });
    });
  },
  removeImage: (id) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      imageGallery: (p.project.imageGallery ?? []).filter((i) => i.id !== id),
    }));
  },
  setImageCategory: (id, category) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      imageGallery: (p.project.imageGallery ?? []).map((i) =>
        i.id === id ? { ...i, category: category || undefined } : i,
      ),
      imageCategories: category && !(p.project.imageCategories ?? []).includes(category)
        ? [...(p.project.imageCategories ?? []), category]
        : (p.project.imageCategories ?? []),
    }));
  },
  moveImage: (id, targetId, position, targetCategory) => {
    get().mutate((p) => {
      const gallery = p.project.imageGallery ?? [];
      const src = gallery.find((i) => i.id === id);
      if (!src) return p;
      const cat = targetCategory || undefined;
      const moved: NamedImage = {
        ...src,
        ...(cat ? { category: cat } : { category: undefined }),
      };
      const without = gallery.filter((i) => i.id !== id);
      let insertAt: number;
      if (!targetId || position === "end") {
        const lastIdx = findLastIndex(without, (i) => (i.category ?? undefined) === cat);
        insertAt = lastIdx === -1 ? without.length : lastIdx + 1;
      } else {
        const idx = without.findIndex((i) => i.id === targetId);
        if (idx < 0) return p;
        insertAt = position === "before" ? idx : idx + 1;
      }
      const next = [...without.slice(0, insertAt), moved, ...without.slice(insertAt)];
      const cats = cat && !(p.project.imageCategories ?? []).includes(cat)
        ? [...(p.project.imageCategories ?? []), cat]
        : (p.project.imageCategories ?? []);
      return setProject(p, { ...p.project, imageGallery: next, imageCategories: cats });
    });
  },
  addImageCategory: (name) => {
    get().mutate((p) => {
      const safe = name.trim();
      if (!safe) return p;
      const list = p.project.imageCategories ?? [];
      if (list.includes(safe)) return p;
      return setProject(p, { ...p.project, imageCategories: [...list, safe] });
    });
  },
  renameImageCategory: (oldName, newName) => {
    get().mutate((p) => {
      const safe = newName.trim();
      if (!safe || safe === oldName) return p;
      const list = p.project.imageCategories ?? [];
      if (!list.includes(oldName)) return p;
      const nextList = list.filter((c) => c !== oldName);
      if (!nextList.includes(safe)) nextList.push(safe);
      return setProject(p, {
        ...p.project,
        imageCategories: nextList,
        imageGallery: (p.project.imageGallery ?? []).map((i) =>
          i.category === oldName ? { ...i, category: safe } : i,
        ),
      });
    });
  },
  removeImageCategory: (name) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      imageCategories: (p.project.imageCategories ?? []).filter((c) => c !== name),
      imageGallery: (p.project.imageGallery ?? []).map((i) =>
        i.category === name ? { ...i, category: undefined } : i,
      ),
    }));
  },

  // ── Palette ─────────────────────────────────────────────────────
  addPaletteColor: (hex, name) => {
    const id = newId();
    get().mutate((p) => setProject(p, {
      ...p.project,
      palette: [...p.project.palette, { id, name: name ?? `Color ${p.project.palette.length + 1}`, hex }],
    }));
    return id;
  },
  updatePaletteColor: (id, patch) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      palette: p.project.palette.map((c) => c.id === id ? { ...c, ...patch } : c),
    }));
  },
  removePaletteColor: (id) => {
    get().mutate((p) => setProject(p, {
      ...p.project,
      palette: p.project.palette.filter((c) => c.id !== id),
    }));
  },
  duplicatePaletteColor: (id) => {
    const src = get().loaded?.project.palette.find((c) => c.id === id);
    if (!src) return null;
    const newIdValue = newId();
    get().mutate((p) => {
      const idx = p.project.palette.findIndex((c) => c.id === id);
      if (idx < 0) return p;
      const copy = { id: newIdValue, name: `${src.name} copy`, hex: src.hex };
      const palette = [
        ...p.project.palette.slice(0, idx + 1),
        copy,
        ...p.project.palette.slice(idx + 1),
      ];
      return setProject(p, { ...p.project, palette });
    });
    return newIdValue;
  },
}));

function sanitiseIconName(s: string): string {
  return s.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * De-duplicate an icon name WITHIN a category. Icons in different
 * categories can share a name — references disambiguate via the
 * `{{category.name}}` prefix.
 *
 * Pass the target category (`null` for uncategorised) so we ignore
 * other categories when checking collisions.
 */
function uniqueIconName(
  existing: NamedIcon[],
  name: string,
  ignoreId: string | undefined,
  category: string | null,
): string {
  const used = new Set<string>();
  for (const i of existing) {
    if (i.id === ignoreId) continue;
    if ((i.category ?? null) !== category) continue;
    used.add(i.name);
  }
  if (!used.has(name)) return name;
  for (let n = 2; n < 1000; n++) {
    const cand = `${name}-${n}`;
    if (!used.has(cand)) return cand;
  }
  return `${name}-${Date.now()}`;
}

/** Current reference token (`{{name}}` or `{{cat.name}}`) keyed by icon id. */
function tokensFromGallery(icons: NamedIcon[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of icons) {
    const tok = i.category ? `{{${i.category}.${i.name}}}` : `{{${i.name}}}`;
    map.set(i.id, tok);
  }
  return map;
}

/** Array.findLastIndex polyfill — ES2023 lands later than TS target. */
function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i;
  return -1;
}

/**
 * Apply an icon-gallery mutation and RIPPLE the resulting token
 * rename through every referencing text in the project:
 *   - text element `content` strings in every template
 *   - every string-typed dataset cell in every record
 *
 * The loop computes `before → after` token strings per icon id; any
 * icon whose token changed triggers a global find/replace.
 */
function applyIconRipple(
  p: LoadedProject,
  oldIcons: NamedIcon[],
  nextIcons: NamedIcon[],
): LoadedProject {
  const oldTok = tokensFromGallery(oldIcons);
  const newTok = tokensFromGallery(nextIcons);
  const renames: Array<[string, string]> = [];
  for (const [id, o] of oldTok) {
    const n = newTok.get(id);
    if (n && n !== o) renames.push([o, n]);
  }
  const mutatedProject: Project = { ...p.project, icons: nextIcons };
  if (renames.length === 0) return { ...p, project: mutatedProject };

  const applyStr = (s: string): string => {
    if (!s) return s;
    let out = s;
    for (const [o, n] of renames) {
      if (out.includes(o)) out = out.split(o).join(n);
    }
    return out;
  };
  const mapEl = (el: Element): Element => {
    if (el.type === "text") {
      const te = el as TextElement;
      const nc = applyStr(te.content ?? "");
      if (nc !== te.content) return { ...te, content: nc };
      return te;
    }
    if (el.type === "group") {
      return { ...el, children: el.children.map(mapEl) };
    }
    return el;
  };
  const templates = mutatedProject.templates.map((t) => ({
    ...t, root: mapEl(t.root) as ElementGroup,
  }));

  const records: typeof p.records = {};
  for (const [dsId, rows] of Object.entries(p.records)) {
    records[dsId] = rows.map((r) => {
      let changed = false;
      const next: DataRecord = { id: r.id };
      for (const [k, v] of Object.entries(r)) {
        if (k === "id") continue;
        if (typeof v === "string") {
          const nv = applyStr(v);
          if (nv !== v) changed = true;
          (next as Record<string, unknown>)[k] = nv;
        } else {
          (next as Record<string, unknown>)[k] = v;
        }
      }
      return changed ? next : r;
    });
  }

  return { ...p, project: { ...mutatedProject, templates }, records };
}

// ─── helpers ────────────────────────────────────────────────────────────

function setProject(p: LoadedProject, project: Project): LoadedProject {
  return { ...p, project };
}

function mapTree(root: ElementGroup, fn: (e: Element) => Element): ElementGroup {
  const mapEl = (el: Element): Element => {
    const mapped = fn(el);
    if (mapped.type === "group") {
      return { ...mapped, children: mapped.children.map(mapEl) };
    }
    return mapped;
  };
  return mapEl(root) as ElementGroup;
}

function insertInto(root: ElementGroup, parentId: string, child: Element): ElementGroup {
  return mapTree(root, (el) => {
    if (el.id === parentId && el.type === "group") {
      const zIndex = Math.max(0, ...el.children.map((c) => c.zIndex)) + 1;
      return { ...el, children: [...el.children, { ...child, zIndex }] };
    }
    return el;
  });
}

function removeFrom(root: ElementGroup, id: string): ElementGroup {
  return mapTree(root, (el) => {
    if (el.type === "group") {
      return { ...el, children: el.children.filter((c) => c.id !== id) };
    }
    return el;
  });
}

function reid(el: Element): Element {
  const base = { ...el, id: newId() };
  if (base.type === "group") {
    return { ...base, children: base.children.map(reid) };
  }
  return base;
}

/**
 * Move an element one slot up or down inside its parent's children
 * array. "up" = later index (visually higher / on top). "down" =
 * earlier index (visually lower). No-op if already at the end.
 */
function reorderInParent(root: ElementGroup, id: string, dir: "up" | "down"): ElementGroup {
  const mapEl = (el: Element): Element => {
    if (el.type === "group") {
      const idx = el.children.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const next = [...el.children];
        const target = dir === "up" ? idx + 1 : idx - 1;
        if (target >= 0 && target < next.length) {
          [next[idx], next[target]] = [next[target], next[idx]];
        }
        return { ...el, children: next };
      }
      return { ...el, children: el.children.map(mapEl) };
    }
    return el;
  };
  return mapEl(root) as ElementGroup;
}

/**
 * Wrap the element identified by `id` in a new group that takes over
 * its position. The child's local x/y becomes (0, 0) and the group
 * inherits the original x/y/w/h. Rotation / opacity stay with the
 * child so visual output is unchanged.
 */
function wrapInGroupTree(root: ElementGroup, id: string): ElementGroup {
  const mapEl = (el: Element): Element => {
    if (el.type === "group") {
      const idx = el.children.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const child = el.children[idx];
        if (child.type === "group") return el; // already a group, skip
        const group: ElementGroup = {
          id: newId(),
          type: "group",
          name: `${child.name} group`,
          x: child.x, y: child.y,
          w: child.w, h: child.h,
          rotation: 0, opacity: 1,
          locked: false, hidden: false,
          zIndex: child.zIndex ?? 0,
          children: [{ ...child, x: 0, y: 0, rotation: 0 }],
        };
        const next = [...el.children];
        next[idx] = group;
        return { ...el, children: next };
      }
      return { ...el, children: el.children.map(mapEl) };
    }
    return el;
  };
  return mapEl(root) as ElementGroup;
}

/**
 * Find an element in the tree and return it together with the sum of
 * its strict ancestors' local x/y offsets. For any located element,
 * `worldX = ancestorsX + el.x`, `worldY = ancestorsY + el.y`.
 */
function locate(root: ElementGroup, id: string): { el: Element; ancestorsX: number; ancestorsY: number } | null {
  const walk = (el: Element, ax: number, ay: number): { el: Element; ancestorsX: number; ancestorsY: number } | null => {
    if (el.id === id) return { el, ancestorsX: ax, ancestorsY: ay };
    if (el.type === "group") {
      for (const c of el.children) {
        const r = walk(c, ax + el.x, ay + el.y);
        if (r) return r;
      }
    }
    return null;
  };
  return walk(root, 0, 0);
}

/** Does the subtree rooted at `ancestorId` contain `candidateId`? */
function treeContains(root: ElementGroup, ancestorId: string, candidateId: string): boolean {
  const ancestor = findElement(root, ancestorId);
  if (!ancestor || ancestor.type !== "group") return false;
  const walk = (el: Element): boolean => {
    if (el.id === candidateId) return true;
    if (el.type === "group") return el.children.some(walk);
    return false;
  };
  return ancestor.children.some(walk);
}

/** Returns a new tree with the element removed, or null if not found / root. */
function pruneFromTree(root: ElementGroup, id: string): ElementGroup | null {
  if (root.id === id) return null;
  let removed = false;
  const walk = (el: Element): Element => {
    if (el.type !== "group") return el;
    const kept = el.children.filter((c) => c.id !== id);
    if (kept.length !== el.children.length) removed = true;
    return { ...el, children: kept.map(walk) };
  };
  const next = walk(root) as ElementGroup;
  return removed ? next : null;
}

function appendChildToGroup(root: ElementGroup, groupId: string, child: Element): ElementGroup {
  const walk = (el: Element): Element => {
    if (el.type !== "group") return el;
    if (el.id === groupId) return { ...el, children: [...el.children, child] };
    return { ...el, children: el.children.map(walk) };
  };
  return walk(root) as ElementGroup;
}

function wrapTargetAndAdd(root: ElementGroup, targetId: string, sibling: Element): ElementGroup {
  const walk = (el: Element): Element => {
    if (el.type !== "group") return el;
    const idx = el.children.findIndex((c) => c.id === targetId);
    if (idx !== -1) {
      const target = el.children[idx];
      const group: ElementGroup = {
        id: newId(),
        type: "group",
        name: `${target.name} group`,
        x: target.x, y: target.y,
        w: target.w, h: target.h,
        rotation: 0, opacity: 1,
        locked: false, hidden: false,
        zIndex: target.zIndex ?? 0,
        anchor: { x: 0.5, y: 0.5 },
        children: [{ ...target, x: 0, y: 0, rotation: 0 }, sibling],
      };
      const next = [...el.children];
      next[idx] = group;
      return { ...el, children: next };
    }
    return { ...el, children: el.children.map(walk) };
  };
  return walk(root) as ElementGroup;
}

function insertSibling(root: ElementGroup, targetId: string, sibling: Element, position: "before" | "after"): ElementGroup {
  const walk = (el: Element): Element => {
    if (el.type !== "group") return el;
    const idx = el.children.findIndex((c) => c.id === targetId);
    if (idx !== -1) {
      const insertAt = position === "before" ? idx : idx + 1;
      const next = [...el.children];
      next.splice(insertAt, 0, sibling);
      return { ...el, children: next };
    }
    return { ...el, children: el.children.map(walk) };
  };
  return walk(root) as ElementGroup;
}

/**
 * Replace a group with its children at its parent's level. Children's
 * local x/y are offset by the group's x/y so visuals are preserved.
 */
function unwrapGroupTree(root: ElementGroup, id: string): ElementGroup {
  if (root.id === id) return root; // never dissolve the root
  const mapEl = (el: Element): Element => {
    if (el.type === "group") {
      const idx = el.children.findIndex((c) => c.id === id);
      if (idx !== -1) {
        const target = el.children[idx];
        if (target.type !== "group") return el;
        const promoted = target.children.map((c) => ({
          ...c,
          x: c.x + target.x,
          y: c.y + target.y,
        }));
        const next = [...el.children.slice(0, idx), ...promoted, ...el.children.slice(idx + 1)];
        return { ...el, children: next };
      }
      return { ...el, children: el.children.map(mapEl) };
    }
    return el;
  };
  return mapEl(root) as ElementGroup;
}

function defaultForType(f: FieldDef): unknown {
  switch (f.type) {
    case "text": case "longtext": case "color": case "image": case "date": return "";
    case "number": return 0;
    case "bool": return false;
    case "enum": return f.enumOptions?.[0] ?? "";
    case "tags": return [];
    case "derived": return null;
  }
}

// Expose all walk-based selectors for consumers
export { walk, findElement, elementParent };
