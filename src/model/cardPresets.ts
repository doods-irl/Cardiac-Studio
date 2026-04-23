/**
 * Common physical card sizes used in tabletop games and print.
 * All dimensions in millimetres; `corner` is the typical rounded
 * corner radius cards ship with (near-0 for print stock, ~3 mm for
 * standard retail cards).
 */

export interface CardPreset {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  cornerMm: number;
  note?: string;
}

export const CARD_PRESETS: CardPreset[] = [
  { id: "poker",       name: "Poker",             widthMm: 63.5, heightMm: 88.9,  cornerMm: 3.0,
    note: "standard TCG (MTG, Pokémon, L5R)" },
  { id: "bridge",      name: "Bridge",            widthMm: 57.0, heightMm: 89.0,  cornerMm: 3.0 },
  { id: "tarot",       name: "Tarot",             widthMm: 70.0, heightMm: 120.0, cornerMm: 3.0 },
  { id: "mini-usa",    name: "Mini USA",          widthMm: 41.0, heightMm: 63.0,  cornerMm: 2.0 },
  { id: "mini-euro",   name: "Mini Euro",         widthMm: 44.0, heightMm: 68.0,  cornerMm: 2.5 },
  { id: "euro-small",  name: "Euro Small",        widthMm: 45.0, heightMm: 68.0,  cornerMm: 2.5 },
  { id: "euro-std",    name: "Euro Standard",     widthMm: 59.0, heightMm: 92.0,  cornerMm: 3.0,
    note: "Dominion, 7 Wonders" },
  { id: "square-s",    name: "Square Small",      widthMm: 60.0, heightMm: 60.0,  cornerMm: 2.5 },
  { id: "square-l",    name: "Square Large",      widthMm: 80.0, heightMm: 80.0,  cornerMm: 3.0 },
  { id: "business",    name: "Business card",     widthMm: 85.0, heightMm: 55.0,  cornerMm: 1.5 },
  { id: "jumbo",       name: "Jumbo",             widthMm: 89.0, heightMm: 127.0, cornerMm: 3.5 },
  { id: "hex-small",   name: "Landscape Poker",   widthMm: 88.9, heightMm: 63.5,  cornerMm: 3.0 },
];
