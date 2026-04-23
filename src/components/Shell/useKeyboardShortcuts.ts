import { useEffect, useRef } from "react";
import { useDoc } from "@/store/document";
import { useEditor, type MainTab, type Tool } from "@/store/editor";
import { saveProject } from "@/engine/format/save";
import { findElement } from "@/model/selectors";
import {
  setElementClipboard, getElementClipboard,
} from "@/io/clipboard";

/**
 * App-level keyboard shortcuts. Mounted once at the shell root.
 *
 * Most handlers short-circuit when focus is inside an <input>,
 * <textarea>, or <select> so normal typing / selection still works.
 */
export function useKeyboardShortcuts() {
  // Re-pin the flag on every mount so HMR doesn't leave orphaned state.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Spacebar-held temporary pan: stash whatever tool was active when
  // Space was pressed; restore it on release. Works across the whole
  // app; CanvasArea just reads `tool` from the store to switch cursor.
  const preSpaceToolRef = useRef<Tool | null>(null);

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement | null;
      const inField = !!tgt && /input|textarea|select/i.test(tgt.tagName);
      const mod = e.ctrlKey || e.metaKey;

      // ── Save ─────────────────────────────────────────────────────────
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const p = useDoc.getState().loaded;
        if (!p) return;
        try {
          const saved = await saveProject(p);
          useDoc.getState().markSaved(saved.manifest);
        } catch (err) { console.error(err); }
        return;
      }

      // ── Undo / redo ─────────────────────────────────────────────────
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        useDoc.getState().undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        useDoc.getState().redo();
        return;
      }

      // ── Main tab switching (Ctrl+1..5) ──────────────────────────────
      if (mod && !e.shiftKey && !inField && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        const tabs: MainTab[] = ["design", "data", "assets", "preview", "export"];
        useEditor.getState().setTab(tabs[parseInt(e.key, 10) - 1]);
        return;
      }

      // ── Zoom (Ctrl + 0 / + / - / =) ─────────────────────────────────
      // Note: tab switching above snags Ctrl+0 by regex, so zoom-to-fit
      // uses a separate key. Ctrl+= zooms in (handy because + without
      // Shift is often `=` on standard layouts); Ctrl+- zooms out.
      if (mod && !e.shiftKey && !inField && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        const z = useEditor.getState().zoom;
        useEditor.getState().setZoom(z * 1.25);
        return;
      }
      if (mod && !e.shiftKey && !inField && e.key === "-") {
        e.preventDefault();
        const z = useEditor.getState().zoom;
        useEditor.getState().setZoom(z * 0.8);
        return;
      }
      if (mod && !e.shiftKey && !inField && e.key === "0") {
        // Reset to 100%. Ctrl+0 conflicts with tabs regex above (which
        // only matches 1..5), so this branch is reachable.
        e.preventDefault();
        useEditor.getState().setZoom(1);
        return;
      }

      // ── Duplicate element ───────────────────────────────────────────
      if (mod && e.key.toLowerCase() === "d" && !inField) {
        e.preventDefault();
        const ed = useEditor.getState();
        if (ed.activeTemplateId && ed.selectedElementId) {
          useDoc.getState().duplicateElement(ed.activeTemplateId, ed.selectedElementId);
        }
        return;
      }

      // ── Copy / paste element ────────────────────────────────────────
      if (mod && e.key.toLowerCase() === "c" && !inField) {
        const ed = useEditor.getState();
        const doc = useDoc.getState().loaded;
        if (!doc || !ed.activeTemplateId || !ed.selectedElementId) return;
        const tpl = doc.project.templates.find((t) => t.id === ed.activeTemplateId);
        const el = tpl ? findElement(tpl.root, ed.selectedElementId) : null;
        if (!el) return;
        e.preventDefault();
        setElementClipboard(el);
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && !inField) {
        const clip = getElementClipboard();
        if (!clip) return;
        const ed = useEditor.getState();
        if (!ed.activeTemplateId) return;
        e.preventDefault();
        const newId = useDoc.getState().pasteElement(ed.activeTemplateId, clip);
        useEditor.getState().selectElement(newId);
        return;
      }

      // ── Layer z-order (Ctrl+] bring forward / Ctrl+[ send back) ─────
      // Mirrors Figma / Photoshop muscle memory. Operates on the
      // currently-selected element within its parent group.
      if (mod && !inField && (e.key === "]" || e.key === "[")) {
        const ed = useEditor.getState();
        if (!ed.activeTemplateId || !ed.selectedElementId) return;
        e.preventDefault();
        useDoc.getState().moveElement(
          ed.activeTemplateId,
          ed.selectedElementId,
          e.key === "]" ? "up" : "down",
        );
        return;
      }

      // ── Delete ──────────────────────────────────────────────────────
      if ((e.key === "Delete" || e.key === "Backspace") && !inField) {
        const ed = useEditor.getState();
        if (ed.activeTemplateId && ed.selectedElementId) {
          e.preventDefault();
          useDoc.getState().deleteElement(ed.activeTemplateId, ed.selectedElementId);
          useEditor.getState().selectElement(null);
        }
        return;
      }

      // ── Arrow-key nudge ─────────────────────────────────────────────
      if (!inField && !mod && /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
        const ed = useEditor.getState();
        const doc = useDoc.getState().loaded;
        if (!doc || !ed.activeTemplateId || !ed.selectedElementId) return;
        const tpl = doc.project.templates.find((t) => t.id === ed.activeTemplateId);
        const el = tpl ? findElement(tpl.root, ed.selectedElementId) : null;
        if (!el || el.locked) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        useDoc.getState().updateElement(
          ed.activeTemplateId,
          el.id,
          { x: el.x + dx, y: el.y + dy },
        );
        return;
      }

      // ── Spacebar-held pan ───────────────────────────────────────────
      // Push the pan tool while Space is held; restore the previous
      // tool on release. `e.repeat` guard is essential — OS-level key
      // repeat would otherwise stash the pan tool as its own previous
      // tool and strand the user there forever.
      if (!inField && !mod && e.code === "Space") {
        if (e.repeat) { e.preventDefault(); return; }
        e.preventDefault();
        const cur = useEditor.getState().tool;
        if (cur !== "pan") {
          preSpaceToolRef.current = cur;
          useEditor.getState().setTool("pan");
        }
        return;
      }

      // ── Tool shortcuts (single-key, no modifier) ───────────────────
      if (!inField && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === "v") { e.preventDefault(); useEditor.getState().setTool("select"); return; }
        if (k === "m") { e.preventDefault(); useEditor.getState().setTool("modify"); return; }
        if (k === "h") { e.preventDefault(); useEditor.getState().setTool("pan");    return; }
      }

      // ── Row navigation (Data tab) ──────────────────────────────────
      if (!inField && (e.key === "PageDown" || e.key === "PageUp")) {
        const st = useDoc.getState().loaded;
        const ed = useEditor.getState();
        if (!st || !ed.activeTemplateId) return;
        const tpl = st.project.templates.find((t) => t.id === ed.activeTemplateId);
        if (!tpl?.datasetId) return;
        const rows = st.records[tpl.datasetId] ?? [];
        const idx = rows.findIndex((r) => r.id === ed.activeRecordId);
        const nextIdx = e.key === "PageDown"
          ? Math.min(rows.length - 1, idx + 1)
          : Math.max(0, idx - 1);
        if (rows[nextIdx]) {
          e.preventDefault();
          ed.setActiveRecord(rows[nextIdx].id);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // Release the spacebar-pan override. Restore whatever tool was
      // active when the user first pressed Space.
      if (e.code === "Space" && preSpaceToolRef.current) {
        useEditor.getState().setTool(preSpaceToolRef.current);
        preSpaceToolRef.current = null;
      }
    };

    // If the user tabs away while holding Space, we'll never see the
    // keyup — reset on blur so they don't come back stuck in pan.
    const onBlur = () => {
      if (preSpaceToolRef.current) {
        useEditor.getState().setTool(preSpaceToolRef.current);
        preSpaceToolRef.current = null;
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
