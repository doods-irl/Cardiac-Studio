import { create } from "zustand";

export type MainTab = "design" | "data" | "assets" | "preview" | "export";
export type Tool = "select" | "modify" | "pan";

/**
 * Panel sizes are user-tweakable via drag handles in the shell and
 * persisted to localStorage so they survive reloads. The rest of the
 * editor state is session-local.
 */
const SIZE_STORAGE_KEY = "cardiac.workspace.sizes.v1";
const DEFAULT_SIZES = {
  leftPanelWidth:  280,
  rightPanelWidth: 320,
  gridHeight:      280,
};
function loadSizes(): typeof DEFAULT_SIZES {
  try {
    const raw = localStorage.getItem(SIZE_STORAGE_KEY);
    if (!raw) return DEFAULT_SIZES;
    const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_SIZES>;
    return { ...DEFAULT_SIZES, ...parsed };
  } catch {
    return DEFAULT_SIZES;
  }
}
function persistSizes(s: typeof DEFAULT_SIZES) {
  try { localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(s)); } catch { /* quota */ }
}

interface EditorState {
  tab: MainTab;
  activeTemplateId: string | null;
  activeRecordId: string | null;
  /** Dataset selected for editing in the Data tab's fullscreen grid.
   *  When null, the grid falls back to the active template's dataset. */
  activeDatasetId: string | null;
  selectedElementId: string | null;
  selectedVariableId: string | null;
  /** Id of the layer currently hovered in the left panel. Drives a
   *  canvas-side highlight so the user can find the element visually
   *  before they click. Null when no row is being hovered. */
  hoveredLayerId: string | null;
  zoom: number;
  showGuides: boolean;
  showRulers: boolean;
  showSafeArea: boolean;
  showBleed: boolean;
  /** If true, the canvas shows trimmed content (outside the card's rounded
   *  rect) as a greyed ghost so you can see what will be clipped at export. */
  showTrimmed: boolean;
  /**
   * When true, dragging a resize handle pins the element's anchor point
   * (the pivot) in place — both edges scale around it. When false, the
   * opposite edge stays fixed, like most vector editors. Holding Alt
   * while dragging momentarily inverts whichever mode is active.
   */
  resizeFromAnchor: boolean;
  /** When true, the design canvas ignores the active record and renders
   *  each element with its stored default `content` / value so the user
   *  can see the template's defaults without having to deselect the row. */
  showDefaults: boolean;
  tool: Tool;
  /** Set of group element IDs that are currently collapsed in the
   *  layer tree. */
  collapsed: Record<string, true>;
  collapsedIconCats: Record<string, true>;
  collapsedImageCats: Record<string, true>;

  leftPanelWidth:  number;
  rightPanelWidth: number;
  gridHeight:      number;

  setTab(t: MainTab): void;
  setActiveTemplate(id: string | null): void;
  setActiveRecord(id: string | null): void;
  setActiveDataset(id: string | null): void;
  selectElement(id: string | null): void;
  selectVariable(id: string | null): void;
  setHoveredLayer(id: string | null): void;
  setZoom(z: number): void;
  toggleGuides(): void;
  toggleSafeArea(): void;
  toggleBleed(): void;
  toggleRulers(): void;
  toggleTrimmed(): void;
  toggleResizeFromAnchor(): void;
  toggleShowDefaults(): void;
  setTool(t: Tool): void;
  toggleCollapsed(id: string): void;
  toggleIconCat(name: string): void;
  toggleImageCat(name: string): void;

  setLeftPanelWidth(n: number):  void;
  setRightPanelWidth(n: number): void;
  setGridHeight(n: number):      void;
}

const initialSizes = loadSizes();

export const useEditor = create<EditorState>((set, get) => ({
  tab: "design",
  activeTemplateId: null,
  activeRecordId: null,
  activeDatasetId: null,
  selectedElementId: null,
  selectedVariableId: null,
  hoveredLayerId: null,
  zoom: 1.0,
  showGuides: true,
  showRulers: true,
  showSafeArea: true,
  showBleed: true,
  showTrimmed: false,
  resizeFromAnchor: true,
  showDefaults: false,
  tool: "select",
  collapsed: {},
  collapsedIconCats: {},
  collapsedImageCats: {},

  leftPanelWidth:  initialSizes.leftPanelWidth,
  rightPanelWidth: initialSizes.rightPanelWidth,
  gridHeight:      initialSizes.gridHeight,

  setTab: (tab) => set({ tab }),
  setActiveTemplate: (id) => set({ activeTemplateId: id, selectedElementId: null }),
  setActiveRecord: (id) => set({ activeRecordId: id }),
  setActiveDataset: (id) => set({ activeDatasetId: id, activeRecordId: null }),
  selectElement:  (id) => set({ selectedElementId: id,  selectedVariableId: null }),
  selectVariable: (id) => set({ selectedVariableId: id, selectedElementId: null }),
  setHoveredLayer: (id) => set({ hoveredLayerId: id }),
  setZoom: (z) => set({ zoom: Math.max(0.1, Math.min(4, z)) }),
  toggleGuides:  () => set((s) => ({ showGuides:  !s.showGuides })),
  toggleSafeArea:() => set((s) => ({ showSafeArea:!s.showSafeArea })),
  toggleBleed:   () => set((s) => ({ showBleed:   !s.showBleed })),
  toggleRulers:  () => set((s) => ({ showRulers:  !s.showRulers })),
  toggleTrimmed: () => set((s) => ({ showTrimmed: !s.showTrimmed })),
  toggleResizeFromAnchor: () => set((s) => ({ resizeFromAnchor: !s.resizeFromAnchor })),
  toggleShowDefaults: () => set((s) => ({ showDefaults: !s.showDefaults })),
  setTool: (tool) => set({ tool }),
  toggleCollapsed: (id) => set((s) => {
    const next = { ...s.collapsed };
    if (next[id]) delete next[id];
    else next[id] = true;
    return { collapsed: next };
  }),
  toggleIconCat: (name) => set((s) => {
    const next = { ...s.collapsedIconCats };
    if (next[name]) delete next[name];
    else next[name] = true;
    return { collapsedIconCats: next };
  }),
  toggleImageCat: (name) => set((s) => {
    const next = { ...s.collapsedImageCats };
    if (next[name]) delete next[name];
    else next[name] = true;
    return { collapsedImageCats: next };
  }),

  setLeftPanelWidth: (n) => {
    set({ leftPanelWidth: n });
    persistSizes({
      leftPanelWidth: n,
      rightPanelWidth: get().rightPanelWidth,
      gridHeight:      get().gridHeight,
    });
  },
  setRightPanelWidth: (n) => {
    set({ rightPanelWidth: n });
    persistSizes({
      leftPanelWidth:  get().leftPanelWidth,
      rightPanelWidth: n,
      gridHeight:      get().gridHeight,
    });
  },
  setGridHeight: (n) => {
    set({ gridHeight: n });
    persistSizes({
      leftPanelWidth:  get().leftPanelWidth,
      rightPanelWidth: get().rightPanelWidth,
      gridHeight:      n,
    });
  },
}));
