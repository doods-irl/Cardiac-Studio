import { useEffect, useMemo, useRef, useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { Icon, IconButton } from "./Icons";
import { importImage, importImages, importFont, importFonts } from "@/engine/format/assets";
import { hasTauri, assetFileUrl } from "@/io/tauri";
import { promptInput, confirmAction, showAlert } from "./Dialog";
import type { AssetRef, NamedIcon } from "@/model/types";

type AssetsTab = "images" | "icons" | "fonts";

/**
 * Full-screen Assets panel. Three sub-tabs: Images / Icons / Fonts.
 *
 * Images and Icons each use a category-grouped gallery:
 *   - Each item has a `category?: string` field.
 *   - Categories render alphabetically (uncategorised first).
 *   - Each category can be collapsed (editor state).
 *   - Each category has an "+ Import" button that places new uploads
 *     into that category directly.
 *   - Drag any item onto another item (reorder in place) or onto a
 *     category header (move to that category). Pointer-events-based
 *     DnD — same approach as the layer tree — works in any webview.
 *
 * Renaming icons or their categories ripples through every `{{…}}`
 * reference in text content and data cells (store takes care of it).
 */
export function AssetsPanel() {
  const loaded = useDoc((s) => s.loaded)!;
  const [tab, setTab] = useState<AssetsTab>("images");

  return (
    <div className="assets-wrap">
      <div className="assets-subtabs">
        {(["images","icons","fonts"] as const).map((t) => (
          <button key={t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="assets-subtab-body">
        {!hasTauri() && (
          <div className="banner">
            Browser preview mode: imports stay in memory. The desktop build copies files into
            <code> assets/…/</code> with content-addressed names.
          </div>
        )}
        {tab === "images" && <ImagesView key={loaded.path} />}
        {tab === "icons"  && <IconsView  key={loaded.path} />}
        {tab === "fonts"  && <FontsView  key={loaded.path} />}
      </div>
    </div>
  );
}

// ─── Generic gallery grouping helper ───────────────────────────────────

interface Groupable {
  id: string;
  name: string;
  category?: string;
  assetId: string;
}

/**
 * Group items by category, produce the ordered list of category names
 * (alphabetic, uncategorised first), and the members of each group in
 * their stored order. Empty categories from the registry are preserved.
 */
function groupByCategory<T extends Groupable>(
  items: T[],
  registry: string[],
): { groupNames: string[]; groups: Map<string, T[]> } {
  const groups = new Map<string, T[]>();
  groups.set("", []);
  for (const cat of registry) if (!groups.has(cat)) groups.set(cat, []);
  for (const i of items) {
    const k = i.category ?? "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  // Sort: uncategorised first, then alphabetic.
  const groupNames = [...groups.keys()].sort((a, b) => {
    if (a === "" && b !== "") return -1;
    if (b === "" && a !== "") return 1;
    return a.localeCompare(b);
  });
  return { groupNames, groups };
}

// ─── Images ────────────────────────────────────────────────────────────

function ImagesView() {
  const loaded = useDoc((s) => s.loaded)!;
  const addAsset         = useDoc((s) => s.addAsset);
  const removeAsset      = useDoc((s) => s.removeAsset);
  const addImage         = useDoc((s) => s.addImage);
  const renameImage      = useDoc((s) => s.renameImage);
  const removeImage      = useDoc((s) => s.removeImage);
  const moveImage        = useDoc((s) => s.moveImage);
  const setImageCategory = useDoc((s) => s.setImageCategory);
  const addImageCategory    = useDoc((s) => s.addImageCategory);
  const renameImageCategory = useDoc((s) => s.renameImageCategory);
  const removeImageCategory = useDoc((s) => s.removeImageCategory);
  const collapsedCats    = useEditor((s) => s.collapsedImageCats);
  const toggleCollapsed  = useEditor((s) => s.toggleImageCat);

  const gallery = loaded.project.imageGallery ?? [];
  const cats    = loaded.project.imageCategories ?? [];

  const onImportTo = async (category: string | null) => {
    const assets = await importImages(loaded.path);
    for (const a of assets) {
      addAsset(a);
      const name = a.originalName.replace(/\.[^.]+$/, "");
      addImage(a.id, name, category ?? undefined);
    }
  };
  const onAddCategory = async () => {
    const n = await promptInput({
      title: "New image category",
      placeholder: "e.g. Backgrounds",
      okLabel: "Add",
      validate: (v) => v.trim() ? null : "Name can't be empty",
    });
    if (!n?.trim()) return;
    addImageCategory(n.trim());
  };

  return (
    <CategoryGallery
      title="Images"
      hint={<>Images are referenced in data cells by id, so renaming or moving them won't break existing bindings.</>}
      kind="image"
      items={gallery as unknown as Groupable[]}
      categories={cats}
      collapsed={collapsedCats}
      toggleCollapsed={toggleCollapsed}
      onImportUncategorised={() => onImportTo(null)}
      onImportToCategory={(c) => onImportTo(c)}
      onAddCategory={onAddCategory}
      onRenameCategory={renameImageCategory}
      onRemoveCategory={removeImageCategory}
      onRenameItem={(id, name) => renameImage(id, name)}
      onRemoveItem={async (id) => {
        const entry = gallery.find((g) => g.id === id);
        if (!entry) return;
        const ok = await confirmAction({
          title: "Delete image",
          message: `Delete "${entry.name}" from the gallery? The image file stays in the project.`,
          okLabel: "Delete",
          danger: true,
        });
        if (ok) removeImage(id);
      }}
      onRemoveAsset={(assetId) => removeAsset(assetId)}
      onReplaceAsset={async (assetId) => {
        const nu = await importImage(loaded.path);
        if (!nu) return;
        useDoc.getState().replaceAssetFile(assetId, {
          path: nu.path, hash: nu.hash, originalName: nu.originalName,
          width: nu.width, height: nu.height,
        });
      }}
      onMove={(id, targetId, pos, targetCat) => moveImage(id, targetId, pos, targetCat)}
      onSetCategory={(id, cat) => setImageCategory(id, cat)}
      assetFor={(id) => loaded.project.assets.find((a) => a.id === id)}
      projectPath={loaded.path}
      rename={renameImage}
    />
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────

function IconsView() {
  const loaded = useDoc((s) => s.loaded)!;
  const addAsset         = useDoc((s) => s.addAsset);
  const addIcon          = useDoc((s) => s.addIcon);
  const renameIcon       = useDoc((s) => s.renameIcon);
  const removeIcon       = useDoc((s) => s.removeIcon);
  const moveIcon         = useDoc((s) => s.moveIcon);
  const setIconCategory  = useDoc((s) => s.setIconCategory);
  const addIconCategory    = useDoc((s) => s.addIconCategory);
  const renameIconCategory = useDoc((s) => s.renameIconCategory);
  const removeIconCategory = useDoc((s) => s.removeIconCategory);
  const collapsedCats    = useEditor((s) => s.collapsedIconCats);
  const toggleCollapsed  = useEditor((s) => s.toggleIconCat);

  const icons = loaded.project.icons ?? [];
  const cats  = loaded.project.iconCategories ?? [];

  const onImportTo = async (category: string | null) => {
    const assets = await importImages(loaded.path);
    for (const a of assets) {
      addAsset(a);
      const name = a.originalName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-");
      addIcon(name || "icon", a.id, category ?? undefined);
    }
  };
  const onAddCategory = async () => {
    const n = await promptInput({
      title: "New icon category",
      placeholder: "e.g. Suits",
      okLabel: "Add",
      validate: (v) => v.trim() ? null : "Name can't be empty",
    });
    if (!n?.trim()) return;
    addIconCategory(n.trim());
  };

  return (
    <CategoryGallery
      title="Icons"
      hint={<>Reference inline as <code>&#123;&#123;name&#125;&#125;</code> or <code>&#123;&#123;category.name&#125;&#125;</code>. Renaming or recategorising an icon updates every reference automatically.</>}
      kind="icon"
      items={icons as unknown as Groupable[]}
      categories={cats}
      collapsed={collapsedCats}
      toggleCollapsed={toggleCollapsed}
      onImportUncategorised={() => onImportTo(null)}
      onImportToCategory={(c) => onImportTo(c)}
      onAddCategory={onAddCategory}
      onRenameCategory={renameIconCategory}
      onRemoveCategory={removeIconCategory}
      onRenameItem={(id, name) => renameIcon(id, name)}
      onRemoveItem={async (id) => {
        const entry = icons.find((g) => g.id === id);
        if (!entry) return;
        const ok = await confirmAction({
          title: "Remove icon",
          message: `Remove icon "${entry.name}"? The underlying image stays in the project.`,
          okLabel: "Remove",
          danger: true,
        });
        if (ok) {
          removeIcon(id);
        }
      }}
      onRemoveAsset={() => {}}
      onReplaceAsset={async (assetId) => {
        const nu = await importImage(loaded.path);
        if (!nu) return;
        useDoc.getState().replaceAssetFile(assetId, {
          path: nu.path, hash: nu.hash, originalName: nu.originalName,
          width: nu.width, height: nu.height,
        });
      }}
      onMove={(id, targetId, pos, targetCat) => moveIcon(id, targetId, pos, targetCat)}
      onSetCategory={(id, cat) => setIconCategory(id, cat)}
      assetFor={(id) => loaded.project.assets.find((a) => a.id === id)}
      projectPath={loaded.path}
      rename={renameIcon}
    />
  );
}

// ─── Shared category-grouped gallery ──────────────────────────────────

interface CategoryGalleryProps {
  title: string;
  hint: React.ReactNode;
  kind: "icon" | "image";
  items: Groupable[];
  categories: string[];
  collapsed: Record<string, true>;
  toggleCollapsed: (name: string) => void;
  onImportUncategorised: () => void;
  onImportToCategory: (category: string) => void;
  onAddCategory: () => void;
  onRenameCategory: (oldName: string, newName: string) => void;
  onRemoveCategory: (name: string) => void;
  onRenameItem: (id: string, name: string) => void;
  onRemoveItem: (id: string) => void;
  onRemoveAsset: (assetId: string) => void;
  /** Swap out the underlying file for an asset, preserving its id. */
  onReplaceAsset: (assetId: string) => void;
  onMove: (id: string, targetId: string | null, pos: "before" | "after" | "end", targetCategory: string | null) => void;
  onSetCategory: (id: string, category: string | null) => void;
  assetFor: (assetId: string) => AssetRef | undefined;
  projectPath: string;
  rename: (id: string, name: string) => void;
}

function CategoryGallery(p: CategoryGalleryProps) {
  const { groupNames, groups } = useMemo(
    () => groupByCategory(p.items, p.categories),
    [p.items, p.categories],
  );

  // Pointer-events DnD shared across all tiles in all categories.
  const dragRef = useRef<{ id: string; startX: number; startY: number; active: boolean } | null>(null);
  const hoverRef = useRef<{ targetId: string | null; pos: "before" | "after" | "end"; category: string | null } | null>(null);
  const [hover, setHover] = useState<typeof hoverRef.current>(null);
  const [ghost, setGhost] = useState<{ name: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
        d.active = true;
        document.body.classList.add("layers-dragging");
      }
      const src = p.items.find((i) => i.id === d.id);
      setGhost({ name: src?.name ?? "", x: e.clientX, y: e.clientY });

      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const target = el?.closest("[data-entry-id],[data-cat-target]") as HTMLElement | null;
      if (!target) { hoverRef.current = null; setHover(null); return; }

      if (target.hasAttribute("data-entry-id")) {
        const tid = target.getAttribute("data-entry-id")!;
        if (tid === d.id) { hoverRef.current = null; setHover(null); return; }
        const rect = target.getBoundingClientRect();
        const pos: "before" | "after" = (e.clientX - rect.left) / rect.width < 0.5 ? "before" : "after";
        const t = p.items.find((i) => i.id === tid);
        const next: typeof hoverRef.current = { targetId: tid, pos, category: (t?.category ?? null) as string | null };
        const cur = hoverRef.current;
        if (!cur || cur.targetId !== next.targetId || cur.pos !== next.pos || cur.category !== next.category) {
          hoverRef.current = next;
          setHover(next);
        }
      } else {
        const cat = target.getAttribute("data-cat-target") ?? "";
        const next = { targetId: null, pos: "end" as const, category: cat || null };
        const cur = hoverRef.current;
        if (!cur || cur.targetId !== null || cur.category !== next.category) {
          hoverRef.current = next;
          setHover(next);
        }
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      const h = hoverRef.current;
      if (d?.active && h) p.onMove(d.id, h.targetId, h.pos, h.category);
      dragRef.current = null;
      hoverRef.current = null;
      setGhost(null);
      setHover(null);
      document.body.classList.remove("layers-dragging");
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.classList.remove("layers-dragging");
    };
  }, [p.items, p]);

  const startDrag = (id: string) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, button, select, textarea")) return;
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, active: false };
  };

  const totalCount = p.items.length;

  return (
    <section className="assets-section">
      <div className="assets-col-header">
        <h2>{p.kind === "icon" ? <Icon name="sparkle" /> : <Icon name="image" />} {p.title}</h2>
        <span className="muted">{totalCount} item{totalCount === 1 ? "" : "s"}</span>
        <IconButton icon="plus" label="Add category" onClick={p.onAddCategory} />
        <IconButton icon="upload" label="Import" accent onClick={p.onImportUncategorised} />
      </div>

      <div className="cat-help">{p.hint}</div>

      {totalCount === 0 && p.categories.length === 0 ? (
        <div className="empty-hint big">
          Nothing here yet. <strong>Import</strong> uploads one or more files; use
          <strong> Add category</strong> to group them.
        </div>
      ) : (
        <div className="cat-stack">
          {groupNames.map((cat) => {
            const members = groups.get(cat) ?? [];
            const isCollapsed = !!p.collapsed[cat];
            const catLabel = cat === "" ? "Uncategorised" : cat;
            const isHoverHeader = hover?.category === (cat || null) && hover?.targetId === null;
            return (
              <div key={cat || "__uncat__"} className="cat-block">
                <div
                  className={"cat-header" + (isHoverHeader ? " drop-into" : "")}
                  data-cat-target={cat}
                >
                  <button className="cat-chevron" onClick={() => p.toggleCollapsed(cat)}
                          title={isCollapsed ? "Expand" : "Collapse"}>
                    {isCollapsed ? "▸" : "▾"}
                  </button>
                  {cat === "" ? (
                    <span className="cat-name uncat">{catLabel}</span>
                  ) : (
                    <InlineName
                      value={cat}
                      className="cat-name"
                      onChange={(v) => p.onRenameCategory(cat, v)}
                    />
                  )}
                  <span className="cat-count">{members.length}</span>
                  <span className="cat-actions">
                    <IconButton icon="upload" label="Import"
                      onClick={() => p.onImportToCategory(cat)}
                      title={cat ? `Import into "${cat}"` : "Import (uncategorised)"} />
                    {cat !== "" && (
                      <IconButton icon="trash" title="Remove category (contents become uncategorised)" danger
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: "Remove category",
                            message: `Remove category "${cat}"? ${members.length} item${members.length === 1 ? "" : "s"} will become uncategorised.`,
                            okLabel: "Remove",
                            danger: true,
                          });
                          if (ok) p.onRemoveCategory(cat);
                        }} />
                    )}
                  </span>
                </div>
                {!isCollapsed && (
                  <div className="cat-grid" data-cat-target={cat}>
                    {members.length === 0 && (
                      <div className="empty-hint" style={{ gridColumn: "1 / -1" }}>
                        Empty — drop items here or use <strong>Import</strong> above.
                      </div>
                    )}
                    {members.map((m) => (
                      <GalleryTile
                        key={m.id}
                        entry={m}
                        kind={p.kind}
                        asset={p.assetFor(m.assetId)}
                        projectPath={p.projectPath}
                        hover={hover?.targetId === m.id ? hover.pos as "before" | "after" : null}
                        onMouseDown={startDrag(m.id)}
                        onRename={(name) => p.rename(m.id, name)}
                        onRemove={() => p.onRemoveItem(m.id)}
                        onReplace={() => p.onReplaceAsset(m.assetId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>{ghost.name}</div>
      )}
    </section>
  );
}

function GalleryTile({
  entry, kind, asset, projectPath, hover, onMouseDown, onRename, onRemove, onReplace,
}: {
  entry: Groupable;
  kind: "icon" | "image";
  asset: AssetRef | undefined;
  projectPath: string;
  hover: "before" | "after" | null;
  onMouseDown: (e: React.MouseEvent) => void;
  onRename: (v: string) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const cls = [
    kind === "icon" ? "icon-tile-asset" : "asset-tile image-tile",
    hover === "before" ? "drop-before" : "",
    hover === "after"  ? "drop-after"  : "",
  ].filter(Boolean).join(" ");

  const thumb = asset
    ? <img src={assetDisplayUrl(projectPath, asset.path)} alt={entry.name}
           onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0.2")} />
    : <Icon name="image" size={20} />;

  if (kind === "icon") {
    const token = (entry as NamedIcon).category
      ? `{{${(entry as NamedIcon).category}.${entry.name}}}`
      : `{{${entry.name}}}`;
    return (
      <div className={cls} data-entry-id={entry.id} onMouseDown={onMouseDown}>
        <div className="icon-tile-thumb">{thumb}</div>
        <InlineName value={entry.name} className="icon-name-input" onChange={onRename} />
        <div className="icon-tile-token">{token}</div>
        <div className="icon-tile-actions">
          <IconButton icon="replace" title="Upload a new image to replace this icon's artwork" onClick={onReplace} />
          <IconButton icon="trash" title="Remove icon (image stays)" danger onClick={onRemove} />
        </div>
      </div>
    );
  }

  // Image tile — keeps the existing asset-tile look but nests name and
  // actions so rename works inline.
  return (
    <div className={cls} data-entry-id={entry.id} onMouseDown={onMouseDown}>
      <div className="asset-thumb">{thumb}</div>
      <div className="asset-meta">
        <InlineName value={entry.name} className="asset-name-input" onChange={onRename} />
        {asset && (
          <div className="muted">
            {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
            {asset.hash.slice(0, 8)}
          </div>
        )}
      </div>
      <div className="asset-actions">
        <IconButton icon="replace" title="Upload a new file to replace this image" onClick={onReplace} />
        <IconButton icon="trash" title="Remove from gallery" danger onClick={onRemove} />
      </div>
    </div>
  );
}

/** Inline-editable text that commits on blur/Enter and stays in sync
 *  with external prop changes. */
function InlineName({
  value, onChange, className,
}: { value: string; onChange: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() && draft !== value) onChange(draft);
    else setDraft(value);
  };
  return (
    <input type="text" className={className ?? ""}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
        else if (e.key === "Escape") { setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

// ─── Fonts ─────────────────────────────────────────────────────────────

function FontsView() {
  const loaded = useDoc((s) => s.loaded)!;
  const addFont     = useDoc((s) => s.addFont);
  const removeFont  = useDoc((s) => s.removeFont);
  const fonts = loaded.project.fonts;

  const [family, setFamily] = useState("");
  const [weight, setWeight] = useState(400);

  const onSingle = async () => {
    if (!family.trim()) {
      await showAlert({ title: "Font family", message: "Give the font family a name first.", tone: "warning" });
      return;
    }
    const r = await importFont(loaded.path, family.trim(), weight);
    if (r) addFont(r.asset, r.font);
  };
  const onMulti = async () => {
    const out = await importFonts(loaded.path);
    for (const r of out) addFont(r.asset, r.font);
  };

  const bundled = fonts.filter((f) => f.bundled);
  const imported = fonts.filter((f) => !f.bundled);

  return (
    <section className="assets-section">
      <div className="assets-col-header">
        <h2><Icon name="font" /> Fonts</h2>
        <span className="muted">{fonts.length} total · {bundled.length} starter, {imported.length} imported</span>
        <IconButton icon="upload" label="Import fonts" accent onClick={onMulti} />
      </div>
      <div className="font-import-row">
        <input type="text" placeholder="Family name (e.g. Cinzel)" value={family}
          onChange={(e) => setFamily(e.target.value)} />
        <input type="number" min={100} max={900} step={100}
          value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
        <IconButton icon="upload" label="Import single" onClick={onSingle} />
      </div>
      {fonts.length === 0 ? (
        <div className="empty-hint big">No fonts in this project yet.</div>
      ) : (
        <div className="font-list">
          {fonts.map((f) => {
            const asset = loaded.project.assets.find((a) => a.id === f.assetId);
            return (
              <div key={f.id} className="font-row">
                <div className="font-sample" style={{ fontFamily: f.family, fontWeight: f.weight }}>
                  Aa — The quick brown fox 1234567890
                </div>
                <div className="font-meta">
                  <strong>{f.family}</strong>
                  <span className="muted"> · weight {f.weight}</span>
                  {f.bundled
                    ? <span className="font-chip">starter</span>
                    : asset && <span className="muted"> · {asset.originalName}</span>}
                </div>
                <IconButton icon="trash"
                  title={f.bundled ? "Remove starter font from project" : "Remove font"}
                  danger
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: "Remove font",
                      message: f.bundled
                        ? `Remove starter font "${f.family}" from this project?`
                        : `Remove font "${f.family}"?`,
                      okLabel: "Remove",
                      danger: true,
                    });
                    if (ok) removeFont(f.id);
                  }} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────

function assetDisplayUrl(projectPath: string, rel: string): string {
  if (rel.startsWith("data:") || rel.startsWith("http")) return rel;
  if (hasTauri()) {
    const fileUrl = `${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${rel}`;
    return assetFileUrl(fileUrl);
  }
  return rel;
}
