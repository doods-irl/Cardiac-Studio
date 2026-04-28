import { useState } from "react";
import { useDoc } from "@/store/document";
import { useEditor } from "@/store/editor";
import { newId } from "@/model/ids";
import type { AssetRef, FieldDef, FieldType, NamedImage } from "@/model/types";
import { importImage } from "@/engine/format/assets";
import { hasTauri, assetFileUrl } from "@/io/tauri";
import { IconAutocompleteTextarea } from "@/components/Panels/IconAutocompleteTextarea";
import { CsvListInput } from "@/components/Panels/CsvListInput";
import { confirmAction, showAlert } from "@/components/Shell/Dialog";

const NEW_FIELD_TYPES: FieldType[] = ["text","longtext","number","bool","enum","variable","color","image","tags","date"];

export function DataGrid({ fullscreen = false }: { fullscreen?: boolean }) {
  const loaded = useDoc((s) => s.loaded);
  const tplId  = useEditor((s) => s.activeTemplateId);
  const setActiveRecord = useEditor((s) => s.setActiveRecord);
  const activeRec = useEditor((s) => s.activeRecordId);

  const showDefaults      = useEditor((s) => s.showDefaults);
  const toggleShowDefaults = useEditor((s) => s.toggleShowDefaults);

  const addRecord       = useDoc((s) => s.addRecord);
  const deleteRecord    = useDoc((s) => s.deleteRecord);
  const duplicateRecord = useDoc((s) => s.duplicateRecord);
  const updateRecord    = useDoc((s) => s.updateRecord);
  const addField     = useDoc((s) => s.addField);
  const removeField  = useDoc((s) => s.removeField);

  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldType>("text");
  const [newFieldVarId, setNewFieldVarId] = useState<string>("");

  if (!loaded) return null;
  const tpl = loaded.project.templates.find((t) => t.id === tplId);
  // When the grid is rendered full-screen from the Data tab, honour
  // the user's chosen dataset from the left panel. Otherwise the
  // design-tab dock always tracks the active template's attached
  // dataset so the previewed cards and the grid rows match up.
  const activeDatasetId = useEditor((s) => s.activeDatasetId);
  const dsId = fullscreen
    ? (activeDatasetId ?? tpl?.datasetId ?? null)
    : (tpl?.datasetId ?? null);
  const ds  = dsId ? loaded.project.datasets.find((d) => d.id === dsId) : undefined;

  if (!ds) {
    return (
      <div className="grid-wrap" style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
        <div className="grid-toolbar">
          <div className="label"><span>▦ Data</span></div>
          <div className="spacer" />
          <div className="empty-hint">No dataset attached to this template.</div>
        </div>
      </div>
    );
  }

  const rows = loaded.records[ds.id] ?? [];
  const currentIdx = Math.max(0, rows.findIndex((r) => r.id === activeRec));

  const nav = (delta: number) => {
    if (rows.length === 0) return;
    const n = (currentIdx + delta + rows.length) % rows.length;
    setActiveRecord(rows[n].id);
  };

  return (
    <div className="grid-wrap" style={{ display: "flex", flexDirection: "column", minHeight: 0, height: fullscreen ? "100%" : undefined }}>
      <div className="grid-toolbar">
        <div className="label">
          <span>▦ Data</span>
          <span className="ds">{ds.name} · {rows.length} rows</span>
        </div>
        <button className="tool" onClick={() => {
          const id = addRecord(ds.id);
          setActiveRecord(id);
        }}>+ Row</button>
        <div className="grid-addcol">
          <input placeholder="new column" value={newFieldName}
                 onChange={(e) => setNewFieldName(e.target.value)} />
          <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value as FieldType)}>
            {NEW_FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {newFieldType === "variable" && (
            <select value={newFieldVarId} onChange={(e) => setNewFieldVarId(e.target.value)}
                    title="Which variable provides the keys for this column?">
              <option value="">pick variable…</option>
              {(loaded.project.variables ?? []).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
          <button onClick={async () => {
            if (!newFieldName.trim()) return;
            if (newFieldType === "variable" && !newFieldVarId) {
              await showAlert({
                title: "Variable required",
                message: "Pick a variable first.",
                tone: "warning",
              });
              return;
            }
            const f: FieldDef = {
              id: newId(), name: newFieldName.trim(), type: newFieldType,
              ...(newFieldType === "enum"     ? { enumOptions: [] }       : {}),
              ...(newFieldType === "variable" ? { variableId: newFieldVarId } : {}),
            };
            addField(ds.id, f);
            setNewFieldName("");
            setNewFieldVarId("");
          }}>+ Add</button>
        </div>
        <div className="spacer" />
        <button className={"tool " + (showDefaults ? "active" : "")}
          onClick={toggleShowDefaults}
          title="Show the template's default content instead of the selected record">
          {showDefaults ? "✓ Defaults" : "Defaults"}
        </button>
        <div className={"record-ptr " + (showDefaults ? "disabled" : "")}
          title={showDefaults ? "Defaults view is on — record selection is ignored" : undefined}>
          <span>Record</span>
          <button className="arrow" onClick={() => nav(-1)} disabled={showDefaults}>◀</button>
          <span>
            <span className="cur">{String(currentIdx + 1).padStart(2, "0")}</span>
            {" / "}{String(rows.length).padStart(2, "0")}
          </span>
          <button className="arrow" onClick={() => nav(1)} disabled={showDefaults}>▶</button>
        </div>
      </div>

      <div className="grid-scroll">
        <table className="grid-table">
          <thead>
            <tr>
              <th style={{ width: 56 }}>#</th>
              {ds.fields.map((f) => (
                <th key={f.id} style={{ minWidth: f.width ?? 140 }}>
                  {f.name}
                  <span className="ftype">{f.type}</span>
                  <span className="close" title="Remove column"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const ok = await confirmAction({
                        title: "Remove column",
                        message: `Remove column "${f.name}"?`,
                        okLabel: "Remove",
                        danger: true,
                      });
                      if (ok) removeField(ds.id, f.id);
                    }}>×</span>
                </th>
              ))}
              <th style={{ width: 64 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id} className={i === currentIdx ? "active" : ""}
                  onClick={() => setActiveRecord(row.id)}>
                <td className="idx">{String(i + 1).padStart(2, "0")}</td>
                {ds.fields.map((f) => (
                  <td key={f.id}>
                    <Cell field={f} value={row[f.name]}
                      assets={loaded.project.assets}
                      projectPath={loaded.path}
                      onChange={(v) => updateRecord(ds.id, row.id, { [f.name]: v })} />
                  </td>
                ))}
                <td style={{ width: 64, padding: 0, color: "var(--fg-4)" }}
                    onClick={(e) => e.stopPropagation()}>
                  <div className="row-actions">
                    <button className="row-action" title="Duplicate row"
                      onClick={() => {
                        const newRowId = duplicateRecord(ds.id, row.id);
                        if (newRowId) setActiveRecord(newRowId);
                      }}>⎘</button>
                    <button className="row-action danger" title="Delete row"
                      onClick={async () => {
                        const ok = await confirmAction({
                          title: "Delete row",
                          message: "Delete this row?",
                          okLabel: "Delete",
                          danger: true,
                        });
                        if (ok) deleteRecord(ds.id, row.id);
                      }}>×</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr onClick={() => {
              const id = addRecord(ds.id);
              setActiveRecord(id);
            }}>
              <td className="idx" style={{ background: "var(--bg-1)" }}>+</td>
              <td colSpan={ds.fields.length + 1}>+ Add row</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Cell({ field, value, assets, projectPath, onChange }: {
  field: FieldDef;
  value: unknown;
  assets: AssetRef[];
  projectPath: string;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "number":
      return (
        <NumberCell value={Number(value ?? 0)} onChange={(v) => onChange(v)} />
      );
    case "bool":
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    case "enum":
      return <EnumCell value={(value as string) ?? ""} options={field.enumOptions ?? []}
        onChange={onChange} />;
    case "variable":
      return <VariableCell fieldVariableId={field.variableId}
        value={(value as string) ?? ""} onChange={onChange} />;
    case "color":
      return <input type="color" value={(value as string) || "#ffffff"} onChange={(e) => onChange(e.target.value)} />;
    case "text":
      // Promoted to autocomplete-aware for {{icon}} tokens. Honours
      // line-break input too — the textarea auto-grows via CSS.
      return <TextCell value={(value as string) ?? ""} onChange={onChange as (v: string) => void}
        projectPath={projectPath} multiline={false} />;
    case "longtext":
      return <TextCell value={(value as string) ?? ""} onChange={onChange as (v: string) => void}
        projectPath={projectPath} multiline />;
    case "image":
      return <ImageCell value={value as string | undefined}
        assets={assets} projectPath={projectPath} onChange={onChange as (v: string) => void} />;
    case "tags":
      return <CsvListInput
        placeholder="comma-separated"
        value={Array.isArray(value) ? (value as string[]) : []}
        onChange={(next) => onChange(next)} />;
    case "date":
      return <input type="date" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "derived":
      return <span style={{ color: "var(--fg-4)", padding: "0 12px" }}>—</span>;
    default:
      return <input type="text" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}

/**
 * Text / longtext cell backed by the icon autocomplete textarea:
 * typing `{{` opens the icon picker, and multiline input works when
 * `multiline` is true (longtext). Line breaks inside a `longtext` cell
 * are preserved in the saved record.
 */
function TextCell({ value, onChange, projectPath, multiline }: {
  value: string;
  onChange: (v: string) => void;
  projectPath: string;
  multiline: boolean;
}) {
  const loaded = useDoc((s) => s.loaded)!;
  return (
    <IconAutocompleteTextarea
      className="grid-text-cell"
      rows={multiline ? 2 : 1}
      value={value}
      onChange={onChange}
      icons={loaded.project.icons ?? []}
      assets={loaded.project.assets}
      assetUrl={(a) => {
        if (a.path.startsWith("data:") || a.path.startsWith("http")) return a.path;
        if (!hasTauri()) return "";
        return assetFileUrl(`${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${a.path}`);
      }}
    />
  );
}

/**
 * Number cell with the text centered and the native browser spinners
 * replaced by two chunky ± buttons on either side. Native spinners
 * are ~12 px of click target tucked under the right edge — unusable
 * at grid density. The custom stepper matches the app theme and gives
 * the full row height as a click target.
 *
 * The `step` defaults to 1; could be exposed per-field later if we
 * want fractional increments for e.g. attack speed multipliers.
 */
function NumberCell({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // Local draft so typing doesn't round-trip the number through the
  // doc store on every keystroke (which would collapse e.g. "1." to
  // "1" and prevent entering "1.5"). Commits on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? String(value);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (Number.isFinite(n)) onChange(n);
    setDraft(null);
  };
  const bump = (delta: number) => {
    // Bump from the currently-displayed value so clicks mid-typing
    // feel natural (apply to whatever the user sees).
    const base = draft === null ? value : (Number.isFinite(Number(draft)) ? Number(draft) : value);
    onChange(base + delta);
    setDraft(null);
  };
  return (
    <div className="num-cell-wrap">
      <button type="button" className="num-cell-step" tabIndex={-1}
        onClick={() => bump(-1)} title="Decrement">−</button>
      <input type="number" className="num-cell"
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
      <button type="button" className="num-cell-step" tabIndex={-1}
        onClick={() => bump(1)} title="Increment">+</button>
    </div>
  );
}

function EnumCell({ value, options, onChange }: { value: string; options: string[]; onChange: (v: unknown) => void }) {
  // Loud tag styling. The select sits on top invisibly so the user can
  // still open it; the tag provides the visual.
  const tagClass = /^(common|uncommon|rare|legendary)$/.test(value) ? value : "";
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span className={"tag " + tagClass} style={{ pointerEvents: "none" }}>{value || "—"}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          position: "absolute", inset: 0,
          opacity: 0, cursor: "pointer", width: "100%", height: "100%",
        }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function VariableCell({ fieldVariableId, value, onChange }: {
  fieldVariableId?: string;
  value: string;
  onChange: (v: unknown) => void;
}) {
  const loaded = useDoc((s) => s.loaded)!;
  const variable = (loaded.project.variables ?? []).find((v) => v.id === fieldVariableId);
  if (!variable) {
    return (
      <div style={{ padding: "6px 12px", color: "var(--fg-4)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        — no variable —
      </div>
    );
  }
  const keys = variable.keyType === "enum" && variable.enumOptions?.length
    ? variable.enumOptions
    : Object.keys(variable.entries);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <span style={{
        padding: "4px 10px", margin: "4px 12px",
        border: "1px solid var(--accent)", color: "var(--accent)",
        fontSize: 9, letterSpacing: "0.14em",
        textTransform: "uppercase", fontWeight: 600,
        pointerEvents: "none",
      }}>{value || "—"}</span>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
      >
        <option value="">—</option>
        {keys.map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </div>
  );
}

function ImageCell({ value, assets, projectPath, onChange }: {
  value?: string;
  assets: AssetRef[];
  projectPath: string;
  onChange: (v: string) => void;
}) {
  const loaded = useDoc((s) => s.loaded)!;
  const addAsset = useDoc((s) => s.addAsset);
  const addImage = useDoc((s) => s.addImage);
  // Prefer the gallery's display names; fall back to raw assets if an
  // old image exists in `assets` but not (yet) in imageGallery.
  const gallery: NamedImage[] = loaded.project.imageGallery ?? [];
  const imageAssets = assets.filter((a) => a.kind === "image");
  const byAsset = new Map(gallery.map((g) => [g.assetId, g] as const));
  const options = imageAssets.map((a) => {
    const entry = byAsset.get(a.id);
    return { assetId: a.id, label: entry?.name ?? a.originalName, category: entry?.category };
  });
  const selected = imageAssets.find((a) => a.id === value);
  const thumbUrl = selected ? resolveAssetUrl(projectPath, selected.path) : "";
  return (
    <div className="img-cell">
      <div className="box">
        {thumbUrl ? <img src={thumbUrl} alt="" /> : "∅"}
      </div>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o.assetId} value={o.assetId}>
            {o.category ? `${o.category} / ${o.label}` : o.label}
          </option>
        ))}
      </select>
      <button className="up" title="Import image…"
        onClick={async (e) => {
          e.stopPropagation();
          const a = await importImage(projectPath);
          if (!a) return;
          addAsset(a);
          addImage(a.id, a.originalName.replace(/\.[^.]+$/, ""));
          onChange(a.id);
        }}>↑</button>
    </div>
  );
}

function resolveAssetUrl(projectPath: string, rel: string): string {
  if (rel.startsWith("data:") || rel.startsWith("http")) return rel;
  if (!hasTauri()) return "";
  const fileUrl = `${projectPath.replace(/\\/g, "/").replace(/\/$/, "")}/${rel}`;
  return assetFileUrl(fileUrl);
}
