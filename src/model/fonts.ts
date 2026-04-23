/**
 * Fonts are either:
 *  - "bundled": system / web-safe families we expect to be available on
 *    every target platform without the user doing anything;
 *  - "imported": TTF/OTF files the user brought into the project.
 *
 * The font family dropdown in the editor unions these two lists.
 */

export interface BundledFont {
  family: string;
  weights: number[];
}

export const BUNDLED_FONTS: BundledFont[] = [
  { family: "Inter",            weights: [400, 500, 600, 700, 800, 900] },
  { family: "system-ui",        weights: [400, 500, 600, 700] },
  { family: "Georgia",          weights: [400, 700] },
  { family: "Times New Roman",  weights: [400, 700] },
  { family: "Arial",            weights: [400, 700] },
  { family: "Helvetica",        weights: [400, 700] },
  { family: "Courier New",      weights: [400, 700] },
  { family: "Trebuchet MS",     weights: [400, 700] },
  { family: "Verdana",          weights: [400, 700] },
  { family: "Impact",           weights: [400] },
  { family: "Palatino",         weights: [400, 700] },
];

/**
 * Build the family list shown in the font-picker.
 *
 * Policy (per user decision): we don't merge a system-font set into
 * every project. The picker shows ONLY the project's imported fonts
 * once any exist, so the user never has to scroll past Arial/Verdana
 * to find their own typefaces. If no fonts have been imported yet,
 * we fall back to Arial as a safe default the browser is guaranteed
 * to resolve — avoiding an empty picker.
 */
export function listFamilies(importedFamilies: string[]): string[] {
  const unique = Array.from(new Set(importedFamilies.filter(Boolean)));
  if (unique.length === 0) return ["Arial"];
  return unique.sort((a, b) => a.localeCompare(b));
}

/**
 * Curated starter font set seeded into new projects. Each entry is a
 * `FontRef` with `bundled: true` so the Fonts tab can distinguish
 * removable-but-restorable starter fonts from user-imported ones.
 * `assetId: ""` signals "no file on disk, uses a system / web-safe
 * family by name" — render time doesn't need an AssetRef for these,
 * only the family string lands in CSS.
 */
export interface BundledFontSeed {
  family: string;
  weight: number;
  italic?: boolean;
}
export const STARTER_FONTS: BundledFontSeed[] = [
  { family: "Archivo",       weight: 400 },
  { family: "Archivo",       weight: 700 },
  { family: "Archivo Black", weight: 900 },
  { family: "Space Grotesk", weight: 400 },
  { family: "Space Grotesk", weight: 700 },
  { family: "Inter",         weight: 400 },
  { family: "Inter",         weight: 600 },
  { family: "Inter",         weight: 800 },
  { family: "IBM Plex Sans", weight: 400 },
  { family: "Bebas Neue",    weight: 400 },
  { family: "Oswald",        weight: 600 },
  { family: "DM Sans",       weight: 500 },
  { family: "JetBrains Mono",weight: 400 },
];

export function weightsForFamily(family: string, imported: { family: string; weight: number }[]): number[] {
  const importedWeights = imported.filter((f) => f.family === family).map((f) => f.weight);
  if (importedWeights.length > 0) {
    return Array.from(new Set(importedWeights)).sort((a, b) => a - b);
  }
  // Fall back to a sensible default weight set for the Arial-only empty
  // case, or any family name that was used without ever being imported
  // (legacy projects). Matches the CSS weight ladder most fonts offer.
  return [400, 700];
}
