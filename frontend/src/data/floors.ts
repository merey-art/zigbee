// Floor + office layout data for the interactive map.
// Coordinates are PERCENT of the viewbox (top-left origin).
// Names are generic — real company names come from the database.

export interface Office {
  id: string;
  name: string; // e.g. "Office 1.3" — shown when no company is assigned
  x: number; y: number; w: number; h: number;
}

export interface Floor {
  id: number;
  label: string;
  offices: Office[];
}

const o = (id: string, x: number, y: number, w: number, h: number): Office => ({ id, name: "", x, y, w, h });

// Floors with office cells — positions unchanged from design, names auto-generated below
const RAW_FLOORS: Omit<Floor, never>[] = [
  {
    id: 1, label: "Floor 1",
    offices: [
      o("f1-1",  13.5, 14, 8.5, 19),
      o("f1-2",  22,   14, 8,   19),
      o("f1-3",  30,   14, 8,   19),
      o("f1-4",  38,   14, 8,   19),
      o("f1-5",  46,   14, 8,   19),
      o("f1-6",  54,   14, 7,   19),
      o("f1-7",  61,   12, 8,   22),
      o("f1-8",  16,   33, 22,  6 ),
      o("f1-9",  15.5, 42, 9,   18),
      o("f1-10", 24.5, 42, 7,   18),
      o("f1-11", 70,   38, 22,  28),
      o("f1-12", 11,   72, 11,  23),
      o("f1-13", 22,   67, 9,   22),
      o("f1-14", 31,   67, 9,   22),
      o("f1-15", 40,   67, 9,   22),
      o("f1-16", 49,   67, 10,  22),
      o("f1-17", 59,   67, 9,   22),
    ],
  },
  {
    id: 2, label: "Floor 2",
    offices: [
      o("f2-1",  18,  14, 8,  19),
      o("f2-2",  26,  14, 8,  19),
      o("f2-3",  34,  14, 8,  19),
      o("f2-4",  42,  14, 8,  19),
      o("f2-5",  50,  8,  8,  25),
      o("f2-6",  58,  14, 9,  19),
      o("f2-7",  67,  14, 8,  19),
      o("f2-8",  78,  25, 14, 16),
      o("f2-9",  13,  33, 12, 28),
      o("f2-10", 81,  50, 14, 25),
      o("f2-11", 11,  65, 12, 13),
      o("f2-12", 23,  65, 9,  13),
      o("f2-13", 39,  64, 13, 14),
      o("f2-14", 55,  65, 9,  13),
      o("f2-15", 64,  67, 12, 15),
      o("f2-16", 18,  81, 15, 14),
      o("f2-17", 43,  81, 15, 14),
    ],
  },
  {
    id: 3, label: "Floor 3",
    offices: [
      o("f3-1",  19, 10, 7,  22),
      o("f3-2",  26, 10, 6,  22),
      o("f3-3",  32, 10, 6,  22),
      o("f3-4",  38, 10, 6,  22),
      o("f3-5",  44, 10, 6,  22),
      o("f3-6",  50, 10, 7,  22),
      o("f3-7",  57, 10, 8,  22),
      o("f3-8",  55, 18, 6,  14),
      o("f3-9",  61, 18, 7,  14),
      o("f3-10", 65, 10, 9,  22),
      o("f3-11", 77, 28, 18, 45),
      o("f3-12", 7,  65, 11, 18),
      o("f3-13", 20, 58, 12, 25),
      o("f3-14", 32, 58, 15, 25),
      o("f3-15", 52, 67, 10, 18),
      o("f3-16", 63, 67, 8,  18),
    ],
  },
  {
    id: 4, label: "Floor 4",
    offices: [
      o("f4-1",  20, 6,  8,  18),
      o("f4-2",  28, 6,  6,  18),
      o("f4-3",  34, 6,  7,  18),
      o("f4-4",  41, 6,  6,  18),
      o("f4-5",  47, 6,  9,  18),
      o("f4-6",  14, 22, 8,  14),
      o("f4-7",  22, 22, 7,  14),
      o("f4-8",  29, 22, 7,  14),
      o("f4-9",  45, 22, 9,  14),
      o("f4-10", 54, 25, 12, 15),
      o("f4-11", 5,  62, 9,  16),
      o("f4-12", 17, 65, 9,  18),
      o("f4-13", 26, 65, 7,  18),
      o("f4-14", 33, 65, 8,  18),
      o("f4-15", 41, 65, 8,  18),
      o("f4-16", 49, 65, 7,  18),
      o("f4-17", 56, 65, 6,  18),
      o("f4-18", 62, 65, 7,  18),
      o("f4-19", 69, 65, 7,  18),
      o("f4-20", 33, 84, 6,  12),
      o("f4-21", 39, 84, 6,  12),
      o("f4-22", 45, 84, 9,  12),
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
