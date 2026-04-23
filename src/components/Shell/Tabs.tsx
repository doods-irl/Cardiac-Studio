import { useEffect, useState } from "react";
import { useEditor, type MainTab } from "@/store/editor";
import { useDoc } from "@/store/document";

const TABS: { id: MainTab; label: string }[] = [
  { id: "assets",  label: "Assets"  },
  { id: "design",  label: "Design"  },
  { id: "data",    label: "Data"    },
  { id: "preview", label: "Preview" },
  { id: "export",  label: "Export"  },
];

export function Tabs() {
  const tab    = useEditor((s) => s.tab);
  const setTab = useEditor((s) => s.setTab);
  const elapsed = useAutosaveClock();

  return (
    <nav className="tabs">
      <div className="label">
        <span className="tag">▚</span>
        <span>Workspace</span>
      </div>
      <div className="tab-list">
        {TABS.map((t) => (
          <button key={t.id}
            className={"tab " + (tab === t.id ? "active" : "")}
            onClick={() => setTab(t.id)}
            title={t.label}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="right-meta">
        <span className="dot" />
        <span className="rec">Autosave · {elapsed}</span>
      </div>
    </nav>
  );
}

function useAutosaveClock(): string {
  const [tick, setTick] = useState(0);
  const dirty = useDoc((s) => s.dirty);
  const lastSavedAt = useDoc((s) => s.loaded?.manifest.modified);

  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  void tick;
  const base = lastSavedAt ? new Date(lastSavedAt).getTime() : Date.now();
  const delta = Math.max(0, Math.floor((Date.now() - base) / 1000));
  if (!dirty && delta < 3) return "just now";
  const mm = String(Math.floor(delta / 60)).padStart(2, "0");
  const ss = String(delta % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
