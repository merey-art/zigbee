// Floor + office layout data for the interactive map.
// Coordinates are PERCENT of the viewbox (top-left origin).
// Edge offices are shifted toward the hull walls; center offices stay.
// clipPath on the SVG trims anything that goes outside the hull shape.

export interface Office {
  id: string;
  name: string;
  x: number; y: number; w: number; h: number;
}

export interface Floor {
  id: number;
  label: string;
  offices: Office[];
}

const o = (id: string, x: number, y: number, w: number, h: number): Office => ({ id, name: "", x, y, w, h });

// Hull outline (SVG units 1280×600, converted to %):
//   Top:    y ≈ 3–4 %  (hull top edge)
//   Bottom: y ≈ 95–97% (hull bottom edge)
//   Left:   x ≈ 5–6 %  at mid-height
//   Right:  x ≈ 88–94% at mid-height (tapers to point at x≈97%, y=50%)

const RAW_FLOORS: Omit<Floor, never>[] = [
  {
    id: 1, label: "Floor 1",
    offices: [
      // ── Top row: pushed up to y=4 (was 12–14) ────────────────
      o("f1-1",  13.5,  4, 8.5, 19),
      o("f1-2",  22,    4, 8,   19),
      o("f1-3",  30,    4, 8,   19),
      o("f1-4",  38,    4, 8,   19),
      o("f1-5",  46,    4, 8,   19),
      o("f1-6",  54,    4, 7,   19),
      o("f1-7",  61,    3, 8,   22),   // top-right — hull clips corner
      // ── Corridor: center, stays ───────────────────────────────
      o("f1-8",  16,   33, 22,   6),
      // ── Middle: center, stays ────────────────────────────────
      o("f1-9",  15.5, 42, 9,   18),
      o("f1-10", 24.5, 42, 7,   18),
      // ── Right room: pushed right (was x=70) ──────────────────
      o("f1-11", 74,   36, 22,  30),   // right wall
      // ── Bottom row: pushed down to y=74 (was 67–72) ──────────
      o("f1-12",  6,   74, 11,  23),   // left wall + bottom
      o("f1-13", 22,   74,  9,  22),
      o("f1-14", 31,   74,  9,  22),
      o("f1-15", 40,   74,  9,  22),
      o("f1-16", 49,   74, 10,  22),
      o("f1-17", 59,   74,  9,  22),
    ],
  },
  {
    id: 2, label: "Floor 2",
    offices: [
      // ── Top row: pushed up to y=4 (was 14) ───────────────────
      o("f2-1",  18,   4,  8,  19),
      o("f2-2",  26,   4,  8,  19),
      o("f2-3",  34,   4,  8,  19),
      o("f2-4",  42,   4,  8,  19),
      o("f2-5",  50,   3,  8,  25),   // tallest — top wall
      o("f2-6",  58,   4,  9,  19),
      o("f2-7",  67,   4,  8,  19),
      // ── Right rooms: pushed right ─────────────────────────────
      o("f2-8",  82,  24, 14,  16),
      o("f2-10", 84,  49, 12,  25),   // right wall (was 81)
      // ── Left room: pushed left ────────────────────────────────
      o("f2-9",   6,  33, 12,  28),   // left wall (was 13)
      // ── Bottom row: pushed down to y≈74–83 (was 65–81) ───────
      o("f2-11",  6,  74, 12,  13),   // left wall
      o("f2-12", 23,  74,  9,  13),
      o("f2-13", 39,  73, 13,  14),
      o("f2-14", 55,  74,  9,  13),
      o("f2-15", 64,  76, 12,  15),
      o("f2-16", 18,  84, 15,  14),   // bottom wall
      o("f2-17", 43,  84, 15,  14),   // bottom wall
    ],
  },
  {
    id: 3, label: "Floor 3",
    offices: [
      // ── Top row: pushed up to y=3–4 (was 10) ─────────────────
      o("f3-1",  19,  3,  7,  22),
      o("f3-2",  26,  3,  6,  22),
      o("f3-3",  32,  3,  6,  22),
      o("f3-4",  38,  3,  6,  22),
      o("f3-5",  44,  3,  6,  22),
      o("f3-6",  50,  3,  7,  22),
      o("f3-7",  57,  3,  8,  22),
      o("f3-8",  55, 11,  6,  14),
      o("f3-9",  61, 11,  7,  14),
      o("f3-10", 65,  3,  9,  22),
      // ── Right room: pushed right (was x=77) ───────────────────
      o("f3-11", 80,  27, 18, 45),   // right wall
      // ── Left room: pushed left (was x=7) ─────────────────────
      o("f3-12",  4,  64, 11, 18),   // left wall + bottom
      // ── Bottom rooms: pushed down (was y=58–67) ───────────────
      o("f3-13", 20,  64, 12, 25),   // bottom wall
      o("f3-14", 32,  64, 15, 25),   // bottom wall
      o("f3-15", 52,  72, 10, 18),   // bottom wall
      o("f3-16", 63,  72,  8, 18),   // bottom wall
    ],
  },
  {
    id: 4, label: "Floor 4",
    offices: [
      // ── Top row: pushed up to y=2 (was 6) ────────────────────
      o("f4-1",  20,  2,  8,  18),
      o("f4-2",  28,  2,  6,  18),
      o("f4-3",  34,  2,  7,  18),
      o("f4-4",  41,  2,  6,  18),
      o("f4-5",  47,  2,  9,  18),
      // ── Mid row: left edge pushed left (was x=14) ────────────
      o("f4-6",   7,  22,  8, 14),   // left wall
      o("f4-7",  22,  22,  7, 14),
      o("f4-8",  29,  22,  7, 14),
      o("f4-9",  45,  22,  9, 14),
      o("f4-10", 54,  25, 12, 15),
      // ── Left outlier: pushed left (was x=5) ──────────────────
      o("f4-11",  4,  62,  9, 16),   // left wall
      // ── Bottom row: pushed down to y=74 (was 65) ─────────────
      o("f4-12", 17,  74,  9, 18),   // bottom wall
      o("f4-13", 26,  74,  7, 18),
      o("f4-14", 33,  74,  8, 18),
      o("f4-15", 41,  74,  8, 18),
      o("f4-16", 49,  74,  7, 18),
      o("f4-17", 56,  74,  6, 18),
      o("f4-18", 62,  74,  7, 18),
      o("f4-19", 69,  74,  7, 18),
      // ── Bottom-bottom: pushed down to y=84 (was 84) ──────────
      o("f4-20", 33,  82,  6, 12),   // bottom wall
      o("f4-21", 39,  82,  6, 12),
      o("f4-22", 45,  82,  9, 12),
    ],
  },
];

// Auto-assign names: "Office {floor}.{n}"
export const FLOORS: Floor[] = RAW_FLOORS.map(f => ({
  ...f,
  offices: f.offices.map((office, i) => ({
    ...office,
    name: `Office ${f.id}.${i + 1}`,
  })),
}));
