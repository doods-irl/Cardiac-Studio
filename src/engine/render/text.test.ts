import { describe, it, expect } from "vitest";
import { tokenize, layoutRuns, ellipsizeLine } from "./text";
import type { AssetRef, NamedIcon } from "@/model/types";

const assets: AssetRef[] = [
  { id: "a-sword",  kind: "image", path: "sword.png",  originalName: "sword.png",  hash: "x" },
  { id: "a-shield", kind: "image", path: "shield.png", originalName: "shield.png", hash: "y" },
];
const icons: NamedIcon[] = [
  { kind: "icon", id: "i1", name: "sword",  assetId: "a-sword" },
  { kind: "icon", id: "i2", name: "shield", assetId: "a-shield" },
];

describe("tokenize", () => {
  it("leaves plain text alone", () => {
    const out = tokenize("hello world", icons, assets);
    expect(out).toEqual([{ kind: "text", value: "hello world" }]);
  });

  it("splits on a known icon token", () => {
    const out = tokenize("deal {{sword}} damage", icons, assets);
    expect(out).toEqual([
      { kind: "text", value: "deal " },
      { kind: "icon", name: "sword", asset: assets[0] },
      { kind: "text", value: " damage" },
    ]);
  });

  it("keeps unknown tokens as literal text", () => {
    const out = tokenize("use {{mystery}} gem", icons, assets);
    expect(out).toEqual([
      { kind: "text", value: "use " },
      { kind: "text", value: "{{mystery}}" },
      { kind: "text", value: " gem" },
    ]);
  });

  it("handles multiple tokens and newlines", () => {
    const out = tokenize("a {{sword}}\nb {{shield}}", icons, assets);
    expect(out).toEqual([
      { kind: "text", value: "a " },
      { kind: "icon", name: "sword", asset: assets[0] },
      { kind: "break" },
      { kind: "text", value: "b " },
      { kind: "icon", name: "shield", asset: assets[1] },
    ]);
  });

  it("resolves categorised icons via {{category.name}}", () => {
    const gallery: NamedIcon[] = [
      { kind: "icon", id: "i-u", name: "sword", assetId: "a-sword" },
      { kind: "icon", id: "i-c", name: "sword", assetId: "a-shield", category: "combat" },
    ];
    // "{{sword}}" → uncategorised sword
    const a = tokenize("hit {{sword}}", gallery, assets);
    expect((a[1] as any).asset.id).toBe("a-sword");

    // "{{combat.sword}}" → category-combat sword
    const b = tokenize("hit {{combat.sword}}", gallery, assets);
    expect((b[1] as any).asset.id).toBe("a-shield");
  });

  it("keeps unresolved categorised tokens as literal text", () => {
    const out = tokenize("cast {{arcane.wand}}", icons, assets);
    expect(out).toEqual([
      { kind: "text", value: "cast " },
      { kind: "text", value: "{{arcane.wand}}" },
    ]);
  });
});

describe("layoutRuns", () => {
  const opts = { fontSize: 4, iconSize: 4, letterSpacing: 0, maxWidth: 40 };

  it("returns a single line for short content", () => {
    const lines = layoutRuns("short", icons, assets, opts);
    expect(lines.length).toBe(1);
    expect(lines[0].runs[0]).toMatchObject({ kind: "text", value: "short" });
  });

  it("places an icon as its own run", () => {
    const lines = layoutRuns("hit {{sword}}!", icons, assets, opts);
    const runs = lines[0].runs;
    const iconRun = runs.find((r) => r.kind === "icon");
    expect(iconRun).toMatchObject({ kind: "icon", name: "sword" });
  });

  it("wraps when content exceeds maxWidth", () => {
    const lines = layoutRuns("one two three four five six seven", icons, assets,
      { ...opts, maxWidth: 20 });
    expect(lines.length).toBeGreaterThan(1);
  });

  it("breaks at newlines", () => {
    const lines = layoutRuns("line1\nline2", icons, assets, opts);
    expect(lines.length).toBe(2);
    expect((lines[0].runs[0] as any).value).toBe("line1");
    expect((lines[1].runs[0] as any).value).toBe("line2");
  });

  it("applies uppercase", () => {
    const lines = layoutRuns("hi", icons, assets, { ...opts, uppercase: true });
    expect((lines[0].runs[0] as any).value).toBe("HI");
  });
});

describe("ellipsizeLine", () => {
  it("truncates and appends ellipsis", () => {
    const lines = layoutRuns("one two three four five six seven eight nine ten", icons, assets,
      { fontSize: 4, iconSize: 4, letterSpacing: 0, maxWidth: 1000 });
    const line = lines[0];
    const trimmed = ellipsizeLine(line, 30, 4, 0);
    // Last text run should end with an ellipsis character
    const last = trimmed.runs[trimmed.runs.length - 1];
    expect(last.kind).toBe("text");
    expect((last as any).value).toMatch(/…$/);
    expect(trimmed.width).toBeLessThanOrEqual(30 + 0.001);
  });
});
