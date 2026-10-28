import ExcelJS from "exceljs";

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Quote");

const rows = [
  ["PowerLine Engineers", null, null, null, null, null, null],
  ["Quote for SR-ELEC-2026-07", null, null, null, null, null, null],
  ["Sr.No", "Item", "Description", "Unit", "Qty", "Rate", "Amount"],
  [null, "WIRING", null, null, null, null, null],
  [1, "Light point wiring", "Concealed PVC conduit wiring for light point incl. switch", "point", 120, 430, 51600],
  [2, "6A socket point wiring", "Concealed wiring for 6A general purpose socket", "point", 80, 460, 36800],
  [3, "16A AC socket point wiring", "Concealed wiring for 16A AC/geyser point with dedicated MCB", "point", 20, 610, 12200],
  [4, "Cable 4 core 16 sqmm armoured", "XLPE armoured cable - laying & termination only", "rmt", 450, 60, 27000, "Cable supplied by client"],
  [5, "Cable 2 core 2.5 sqmm", "PVC copper cable - laying & termination only", "rmt", 1200, 14, 16800, "Cable supplied by client"],
  [null, "PANELS & PROTECTION", null, null, null, null, null],
  [6, "MCB Distribution Board 12-way", "TPN DB with MCBs as required incl. installation", "nos", 6, 4100, 24600],
  [7, "MCB Distribution Board 24-way", "TPN DB with MCBs as required incl. installation", "nos", 2, 7600, 15200],
  [8, "Main LT Panel", "Incoming main panel with ACB/MCCB as per load", "nos", 1, 178000, 178000],
  [9, "Earthing pit with GI strip", "Chemical earthing pit complete with GI strip and funnel", "nos", 4, 8200, 32800],
  [null, "LIGHTING", null, null, null, null, null],
  [10, "LED Panel Light 2x2 ft", "40W LED panel light recessed mounting", "nos", 60, 1180, 70800],
  [11, "LED Batten 4ft", "20W LED batten surface mounted", "nos", 40, 610, 24400],
  [12, "Exit Sign Light", "LED exit sign with battery backup", "nos", 15, 1700, 25500],
  [13, "Emergency Light Unit", "LED emergency light 2hr battery backup", "nos", 10, 2100, 21000],
  [null, "FITTINGS", null, null, null, null, null],
  [14, "Modular Switch Plate 1-way", "6A modular switch with plate", "nos", 150, 170, 25500],
  [15, "Modular Switch Plate 2-way", "6A two-way modular switch with plate", "nos", 60, 300, 18000],
  [16, "Ceiling Fan with regulator", "1200mm ceiling fan incl. electronic regulator", "nos", 30, 2250, 67500],
  [null, null, null, null, "Grand Total", null, 647700],
  [null, "Note: Exhaust fans and DB-to-DB cable laying excluded from this quote — not our scope.", null, null, null, null, null],
];

for (const r of rows) ws.addRow(r);
await wb.xlsx.writeFile("../test-data/medium-electrical/bid-powerline.xlsx");
console.log("written");
