import { useEffect, useRef, useState } from "react";

/**
 * Text input for a comma-separated list of strings.
 *
 * The naive pattern of `value={list.join(",")}` +
 * `onChange={e => onChange(e.target.value.split(",").filter(Boolean))}`
 * runs on every keystroke — so the moment the user types a `,`, the
 * empty trailing segment is stripped and the comma is "eaten" from the
 * field. This component keeps a local draft string while the input is
 * focused and only parses on blur / Enter, which lets the user type
 * commas freely.
 *
 * When the upstream `value` changes (via some other action) while the
 * input is not focused, the draft re-syncs to the new value. While
 * focused we preserve the user's in-progress text to avoid clobbering.
 */
export interface CsvListInputProps {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
}

export function CsvListInput({
  value, onChange, placeholder, multiline = false, rows, className,
}: CsvListInputProps) {
  const joined = value.join(", ");
  const [draft, setDraft] = useState(joined);
  const focusedRef = useRef(false);

  useEffect(() => {
    // Only re-sync from upstream when the field isn't being edited, to
    // avoid wiping the user's in-progress text on parent re-renders.
    if (!focusedRef.current) setDraft(joined);
  }, [joined]);

  const commit = () => {
    const parsed = draft.split(",").map((s) => s.trim()).filter(Boolean);
    // Dedup but preserve order.
    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const p of parsed) if (!seen.has(p)) { seen.add(p); dedup.push(p); }
    if (dedup.join(",") !== value.join(",")) onChange(dedup);
    // Normalise the display to "a, b, c" on commit.
    setDraft(dedup.join(", "));
  };

  const commonProps = {
    value: draft,
    placeholder,
    className,
    onFocus: () => { focusedRef.current = true; },
    onBlur: () => { focusedRef.current = false; commit(); },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (!multiline && e.key === "Enter") {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
    },
  };

  return multiline
    ? <textarea rows={rows ?? 2} {...commonProps} />
    : <input type="text" {...commonProps} />;
}
