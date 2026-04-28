import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

/**
 * In-app dialog system. Replaces the browser's `prompt`/`confirm`/`alert`
 * (and Tauri's native `ask`/`message` plugin dialogs) with a stylised
 * modal that matches the rest of the app.
 *
 * Public API is imperative — callers use `promptInput`, `confirmAction`,
 * `showAlert`, `pushToast` like they would the native dialogs, and each
 * returns a Promise. A single `<DialogHost />` mounted at the app root
 * subscribes to the store and renders whatever's queued.
 */

type PromptEntry = {
  kind: "prompt";
  id: number;
  title: string;
  message?: string;
  defaultValue: string;
  placeholder?: string;
  okLabel: string;
  cancelLabel: string;
  validate?: (v: string) => string | null;
  resolve: (v: string | null) => void;
};

type ConfirmEntry = {
  kind: "confirm";
  id: number;
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (v: boolean) => void;
};

type AlertEntry = {
  kind: "alert";
  id: number;
  title: string;
  message: string;
  okLabel: string;
  tone: "info" | "warning" | "error";
  resolve: () => void;
};

type DialogEntry = PromptEntry | ConfirmEntry | AlertEntry;

type Toast = {
  id: number;
  message: string;
  tone: "info" | "warning" | "error" | "success";
  ttlMs: number;
};

interface DialogState {
  queue: DialogEntry[];
  toasts: Toast[];
  push: (e: DialogEntry) => void;
  resolveTop: () => void;
  pushToast: (t: Omit<Toast, "id">) => number;
  dismissToast: (id: number) => void;
}

const useDialogs = create<DialogState>((set) => ({
  queue: [],
  toasts: [],
  push: (e) => set((s) => ({ queue: [...s.queue, e] })),
  resolveTop: () => set((s) => ({ queue: s.queue.slice(1) })),
  pushToast: (t) => {
    const id = nextId();
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    return id;
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

let _id = 0;
const nextId = () => ++_id;

// ── Imperative API ──────────────────────────────────────────────────

export interface PromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  okLabel?: string;
  cancelLabel?: string;
  /** Return an error string to block submission, or null to allow it. */
  validate?: (v: string) => string | null;
}

export function promptInput(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogs.getState().push({
      kind: "prompt",
      id: nextId(),
      title: opts.title,
      message: opts.message,
      defaultValue: opts.defaultValue ?? "",
      placeholder: opts.placeholder,
      okLabel: opts.okLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      validate: opts.validate,
      resolve,
    });
  });
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export function confirmAction(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogs.getState().push({
      kind: "confirm",
      id: nextId(),
      title: opts.title ?? "Confirm",
      message: opts.message,
      okLabel: opts.okLabel ?? "OK",
      cancelLabel: opts.cancelLabel ?? "Cancel",
      danger: !!opts.danger,
      resolve,
    });
  });
}

export interface AlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
  tone?: "info" | "warning" | "error";
}

export function showAlert(opts: AlertOptions): Promise<void> {
  return new Promise((resolve) => {
    const tone = opts.tone ?? "info";
    useDialogs.getState().push({
      kind: "alert",
      id: nextId(),
      title: opts.title ?? (tone === "error" ? "Error" : tone === "warning" ? "Warning" : "Info"),
      message: opts.message,
      okLabel: opts.okLabel ?? "OK",
      tone,
      resolve,
    });
  });
}

export function pushToast(message: string, tone: Toast["tone"] = "info", ttlMs = 3200): number {
  return useDialogs.getState().pushToast({ message, tone, ttlMs });
}

// ── Host (mount once at the app root) ───────────────────────────────

export function DialogHost() {
  const queue   = useDialogs((s) => s.queue);
  const toasts  = useDialogs((s) => s.toasts);
  const top     = queue[0];

  return (
    <>
      {top && <DialogShell entry={top} />}
      {toasts.length > 0 && <ToastStack toasts={toasts} />}
    </>
  );
}

function DialogShell({ entry }: { entry: DialogEntry }) {
  const resolveTop = useDialogs((s) => s.resolveTop);

  // Scope the body click trap so it doesn't bubble to ContextMenu's
  // global mousedown listener (which would close menus opened from
  // inside a dialog — uncommon but harmless either way).
  return (
    <div className="dlg-backdrop" role="dialog" aria-modal="true">
      <div className="dlg-card" onMouseDown={(e) => e.stopPropagation()}>
        {entry.kind === "prompt" && (
          <PromptBody entry={entry} onDone={resolveTop} />
        )}
        {entry.kind === "confirm" && (
          <ConfirmBody entry={entry} onDone={resolveTop} />
        )}
        {entry.kind === "alert" && (
          <AlertBody entry={entry} onDone={resolveTop} />
        )}
      </div>
    </div>
  );
}

function PromptBody({ entry, onDone }: { entry: PromptEntry; onDone: () => void }) {
  const [value, setValue] = useState(entry.defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const err = entry.validate?.(value) ?? null;
    if (err) { setError(err); return; }
    entry.resolve(value);
    onDone();
  };
  const cancel = () => { entry.resolve(null); onDone(); };

  return (
    <DialogChrome
      title={entry.title}
      onCancel={cancel}
      onSubmit={submit}
      message={entry.message}
    >
      <input
        ref={inputRef}
        id={inputId}
        className="dlg-input"
        type="text"
        value={value}
        placeholder={entry.placeholder}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          else if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
      />
      {error && <div className="dlg-error">{error}</div>}
      <DialogActions>
        <button className="dlg-btn" onClick={cancel}>{entry.cancelLabel}</button>
        <button className="dlg-btn primary" onClick={submit}>{entry.okLabel}</button>
      </DialogActions>
    </DialogChrome>
  );
}

function ConfirmBody({ entry, onDone }: { entry: ConfirmEntry; onDone: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { cancelRef.current?.focus(); }, []);

  const ok = () => { entry.resolve(true); onDone(); };
  const cancel = () => { entry.resolve(false); onDone(); };

  return (
    <DialogChrome
      title={entry.title}
      onCancel={cancel}
      onSubmit={ok}
      message={entry.message}
    >
      <DialogActions>
        <button ref={cancelRef} className="dlg-btn" onClick={cancel}>{entry.cancelLabel}</button>
        <button
          className={"dlg-btn primary" + (entry.danger ? " danger" : "")}
          onClick={ok}
        >{entry.okLabel}</button>
      </DialogActions>
    </DialogChrome>
  );
}

function AlertBody({ entry, onDone }: { entry: AlertEntry; onDone: () => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { okRef.current?.focus(); }, []);

  const close = () => { entry.resolve(); onDone(); };

  return (
    <DialogChrome
      title={entry.title}
      onCancel={close}
      onSubmit={close}
      message={entry.message}
      tone={entry.tone}
    >
      <DialogActions>
        <button ref={okRef} className="dlg-btn primary" onClick={close}>{entry.okLabel}</button>
      </DialogActions>
    </DialogChrome>
  );
}

function DialogChrome({
  title, message, tone, children, onCancel, onSubmit,
}: {
  title: string;
  message?: string;
  tone?: "info" | "warning" | "error";
  children: React.ReactNode;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  // Keyboard shortcuts: Escape always cancels, Enter submits unless the
  // focus is on a multi-line element. PromptBody handles its own keys
  // because the input needs Enter for submit but plain typing for chars.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter" && !(e.target as HTMLElement)?.matches?.("input,textarea")) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, onSubmit]);

  return (
    <>
      <div className={"dlg-head" + (tone ? ` tone-${tone}` : "")}>
        <span className="dlg-title">{title}</span>
      </div>
      {message && <div className="dlg-msg">{message}</div>}
      {children}
    </>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="dlg-actions">{children}</div>;
}

// ── Toasts ──────────────────────────────────────────────────────────

function ToastStack({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useDialogs((s) => s.dismissToast);
  useEffect(() => {
    if (toast.ttlMs <= 0) return;
    const t = setTimeout(() => dismiss(toast.id), toast.ttlMs);
    return () => clearTimeout(t);
  }, [toast.id, toast.ttlMs, dismiss]);
  return (
    <button
      className={`toast tone-${toast.tone}`}
      onClick={() => dismiss(toast.id)}
      title="Dismiss"
    >
      {toast.message}
    </button>
  );
}
