import { describe, it, expect } from "vitest";
import { resolveBinding, setPath, applyBindings } from "./resolve";
import type { Binding, DataRecord, Variable } from "@/model/types";

const rec: DataRecord = {
  id: "r1", name: "Goblin", cost: 3, rarity: "rare", pct: 0.123,
};

describe("resolveBinding", () => {
  it("returns static when no field", () => {
    expect(resolveBinding({ static: "hi" }, rec)).toBe("hi");
  });
  it("reads a field", () => {
    expect(resolveBinding({ field: "name" }, rec)).toBe("Goblin");
  });
  it("falls back when field is missing", () => {
    expect(resolveBinding({ field: "missing", fallback: "—" }, rec)).toBe("—");
  });
  it("applies upper", () => {
    expect(resolveBinding({ field: "name", transforms: [{ kind: "upper" }] }, rec)).toBe("GOBLIN");
  });
  it("applies prefix + suffix", () => {
    expect(resolveBinding({
      field: "cost",
      transforms: [{ kind: "prefix", value: "$" }, { kind: "suffix", value: " coins" }],
    }, rec)).toBe("$3 coins");
  });
  it("applies format", () => {
    expect(resolveBinding({
      field: "name", transforms: [{ kind: "format", pattern: "— {value} —" }],
    }, rec)).toBe("— Goblin —");
  });
  it("applies map", () => {
    expect(resolveBinding({
      field: "rarity", transforms: [{ kind: "map", map: { rare: "#d6e0ff", common: "#eee" } }],
    }, rec)).toBe("#d6e0ff");
  });
  it("applies number formatting", () => {
    expect(resolveBinding({ field: "pct", transforms: [{ kind: "number", decimals: 2 }] }, rec)).toBe("0.12");
  });
  it("applies if predicate", () => {
    const v = resolveBinding({
      field: "cost",
      transforms: [{ kind: "if", when: { op: "gte", value: 3 }, then: "big", else: "small" }],
    }, rec);
    expect(v).toBe("big");
  });
});

describe("setPath", () => {
  it("sets a nested value immutably", () => {
    const a = { s: { c: "red" }, x: 1 };
    const b = setPath(a, "s.c", "blue");
    expect(a.s.c).toBe("red");
    expect(b.s.c).toBe("blue");
    expect(b.x).toBe(1);
  });
});

describe("var transform", () => {
  const rarityIcon: Variable = {
    id: "var-rarity",
    name: "rarityIcon",
    keyType: "enum",
    enumOptions: ["common", "uncommon", "rare", "legendary"],
    valueType: "image",
    entries: {
      common: "asset-c",
      uncommon: "asset-u",
      rare: "asset-r",
      legendary: "asset-l",
    },
  };

  it("looks up the current value in a variable", () => {
    const result = resolveBinding(
      { field: "rarity", transforms: [{ kind: "var", variableId: "var-rarity" }] },
      { id: "x", rarity: "rare" } as DataRecord,
      { variables: [rarityIcon] },
    );
    expect(result).toBe("asset-r");
  });

  it("returns the variable's defaultValue when key missing", () => {
    const variable: Variable = { ...rarityIcon, defaultValue: "asset-fallback" };
    const result = resolveBinding(
      { field: "rarity", transforms: [{ kind: "var", variableId: "var-rarity" }] },
      { id: "x", rarity: "mythic" } as DataRecord,
      { variables: [variable] },
    );
    expect(result).toBe("asset-fallback");
  });

  it("passes the original value through when variable isn't registered", () => {
    const result = resolveBinding(
      { field: "rarity", transforms: [{ kind: "var", variableId: "missing" }] },
      { id: "x", rarity: "rare" } as DataRecord,
      { variables: [rarityIcon] },
    );
    expect(result).toBe("rare");
  });

  it("composes with other transforms", () => {
    // rarity "common" → var → "asset-c" → prefix "file:"
    const result = resolveBinding(
      {
        field: "rarity",
        transforms: [
          { kind: "var", variableId: "var-rarity" },
          { kind: "prefix", value: "file:" },
        ],
      },
      { id: "x", rarity: "common" } as DataRecord,
      { variables: [rarityIcon] },
    );
    expect(result).toBe("file:asset-c");
  });
});

describe("applyBindings", () => {
  it("writes resolved values onto the element", () => {
    const el = {
      id: "e1", type: "text", name: "t",
      x: 0, y: 0, w: 10, h: 5, rotation: 0, opacity: 1,
      locked: false, hidden: false, zIndex: 0,
      content: "",
      style: { color: "#000" },
      bindings: {
        content: { field: "name" } as Binding,
        "style.color": { field: "rarity", transforms: [{ kind: "map", map: { rare: "#00f" } }] } as Binding,
      },
    };
    const out = applyBindings(el as any, rec) as any;
    expect(out.content).toBe("Goblin");
    expect(out.style.color).toBe("#00f");
  });
});
