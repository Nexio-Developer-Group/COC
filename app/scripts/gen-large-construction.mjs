import ExcelJS from "exceljs";

const sections = [
  {
    name: "Civil & Structural",
    items: [
      ["Excavation for foundation", "Mechanical excavation in ordinary soil up to 2m depth, incl. disposal", "cum", 850],
      ["PCC M15 below footing", "Plain cement concrete M15 grade below footings and raft", "cum", 120],
      ["RCC M25 footing & column", "Reinforced cement concrete M25 for footings and columns incl. shuttering", "cum", 380],
      ["RCC M25 slab (roof)", "Reinforced cement concrete M25 for roof/floor slabs incl. shuttering", "cum", 420],
      ["Brickwork 230mm in CM 1:6", "Brick masonry 230mm thick in cement mortar 1:6", "cum", 650],
      ["Plastering 12mm internal", "Internal cement plaster 12mm thick, single coat", "sqm", 4200],
      ["Plastering 15mm external", "External weatherproof cement plaster 15mm, two coats", "sqm", 2800],
      ["Waterproofing treatment (terrace)", "Brickbat coba waterproofing with APP membrane on terrace", "sqm", 600],
    ],
  },
  {
    name: "Electrical",
    items: [
      ["Main LT Panel with ACB", "Incoming main LT panel with ACB as per load calculation", "nos", 1],
      ["Floor Distribution Board", "TPN distribution board per floor incl. MCBs", "nos", 8],
      ["Cable tray (GI, perforated)", "Perforated GI cable tray with supports", "rmt", 600],
      ["Power cable 3.5core 95sqmm", "XLPE armoured power cable for riser", "rmt", 350],
      ["Light point wiring", "Concealed conduit wiring for light point incl. switch", "point", 400],
      ["Power socket point wiring", "Concealed wiring for 6A/16A socket point", "point", 250],
      ["LED lighting fixtures", "Assorted LED panel/downlight fixtures as per layout", "nos", 320],
      ["DG Set 125kVA with AMF panel", "Diesel generator set with acoustic enclosure and AMF panel", "nos", 1],
    ],
  },
  {
    name: "Plumbing & Fire Fighting",
    items: [
      ["CPVC pipe 25mm dia", "CPVC pressure pipe for domestic water supply, 25mm", "rmt", 900],
      ["CPVC pipe 50mm dia", "CPVC pressure pipe for domestic water supply, 50mm", "rmt", 400],
      ["UPVC soil pipe 110mm", "UPVC soil/waste pipe with fittings, 110mm", "rmt", 600],
      ["Water storage tank 5000L", "Sintex/equivalent water storage tank 5000L with fittings", "nos", 4],
      ["Fire hydrant system", "Fire hydrant point with hose reel, landing valve complete", "nos", 12],
      ["Sprinkler heads", "Quartzoid bulb sprinkler head, pendant type", "nos", 180],
      ["Fire pump set", "Electric + diesel fire pump set with jockey pump, complete", "set", 1],
      ["Sanitary fixtures set", "WC + wash basin + fittings, standard set per toilet", "set", 48],
    ],
  },
  {
    name: "HVAC",
    items: [
      ["VRF outdoor unit 10TR", "Variable refrigerant flow outdoor condensing unit, 10TR", "nos", 6],
      ["VRF indoor unit (cassette)", "Cassette type indoor unit with grille", "nos", 48],
      ["Refrigerant copper piping", "Insulated copper refrigerant piping, various sizes", "rmt", 800],
      ["GI ducting (sheet metal)", "Factory fabricated GI sheet metal ducting", "sqm", 450],
      ["Exhaust air system (toilets)", "Toilet exhaust fan with ducting connection", "nos", 48],
      ["Fresh air handling unit", "Fresh air handling unit with filters", "nos", 2],
      ["Thermostat & BMS point", "Room thermostat integrated with building management system", "nos", 48],
      ["Insulation for ducting", "Nitrile rubber insulation for ducting, 13mm", "sqm", 450],
    ],
  },
  {
    name: "Finishing & Interiors",
    items: [
      ["Vitrified tile flooring 600x600", "Vitrified tile flooring laid in cement mortar with grouting", "sqm", 2200],
      ["Granite flooring (lobby)", "Polished granite flooring for lobby areas", "sqm", 180],
      ["False ceiling (gypsum, grid)", "Gypsum board false ceiling on GI grid system", "sqm", 1800],
      ["Interior emulsion paint", "Premium acrylic emulsion paint, two coats with primer", "sqm", 3600],
      ["Aluminium window (powder coated)", "Powder coated aluminium window with glazing", "sqm", 420],
      ["UPVC door with frame", "UPVC door shutter with frame, toilet/utility doors", "nos", 36],
      ["Toughened glass partition", "12mm toughened glass office partition with hardware", "sqm", 280],
      ["Granite kitchen platform", "Polished granite platform for pantry, with sink cutout", "rmt", 45],
    ],
  },
];

// base rate per item (INR), index-aligned with flattened item order
const baseRates = [
  320, 5200, 8800, 9200, 4800, 420, 480, 380, // Civil
  185000, 42000, 650, 1450, 480, 540, 2200, 2850000, // Electrical
  380, 620, 850, 28000, 32000, 450, 950000, 18500, // Plumbing & Fire
  165000, 48000, 1250, 1850, 2400, 285000, 3200, 420, // HVAC
  1150, 3200, 950, 185, 7800, 12500, 2400, 4800, // Finishing
];

function flat() {
  const out = [];
  sections.forEach((s, si) => s.items.forEach((it, ii) => out.push({ ...itemObj(it), section: s.name, si, ii })));
  return out;
}
function itemObj([name, desc, unit, qty]) {
  return { name, desc, unit, qty };
}

const allItems = flat();

async function writeWorkbook(filename, title, rowsFn) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  ws.addRow([title]);
  ws.addRow(["Sr.No", "Item", "Description", "Unit", "Quantity", "Rate", "Amount"]);
  let idx = 0;
  for (const section of sections) {
    ws.addRow([null, section.name]);
    for (let i = 0; i < section.items.length; i++) {
      const item = allItems[idx];
      const row = rowsFn(item, idx, i + 1);
      ws.addRow(row);
      idx++;
    }
  }
  await wb.xlsx.writeFile(filename);
  console.log("wrote", filename);
}

// --- TENDER (no rates) ---
await writeWorkbook(
  "../test-data/large-construction/tender-commercial-complex.xlsx",
  "COMMERCIAL COMPLEX - SHELL & CORE + INTERIORS, PHASE 1 - Ref: CC-2026-11",
  (item, idx, sr) => [sr, item.name, item.desc, item.unit, item.qty]
);

// --- BID A: Shivam Construction Co - full, standard rates (+5%) ---
await writeWorkbook(
  "../test-data/large-construction/bid-shivam-construction.xlsx",
  "Shivam Construction Co — Quote for CC-2026-11 — GSTIN 27AAACS5566K1Z1",
  (item, idx, sr) => {
    const rate = Math.round(baseRates[idx] * 1.05);
    return [sr, item.name, item.desc, item.unit, item.qty, rate, rate * item.qty];
  }
);

// --- BID B: Metro Builders - skip HVAC section entirely, add 2 extra items ---
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  ws.addRow(["Metro Builders Pvt Ltd — Quote for CC-2026-11"]);
  ws.addRow(["Sr.No", "Item", "Description", "Unit", "Quantity", "Rate", "Amount"]);
  let idx = 0;
  for (const section of sections) {
    if (section.name === "HVAC") {
      idx += section.items.length;
      continue;
    }
    ws.addRow([null, section.name]);
    for (let i = 0; i < section.items.length; i++) {
      const item = allItems[idx];
      const rate = Math.round(baseRates[idx] * 0.94);
      ws.addRow([i + 1, item.name, item.desc, item.unit, item.qty, rate, rate * item.qty]);
      idx++;
    }
  }
  ws.addRow([null, "Additional Items (not in tender BOQ)"]);
  ws.addRow([1, "Site Office Rental", "Temporary site office cabin rental, 6 months", "months", 6, 25000, 150000]);
  ws.addRow([2, "Safety Signage Package", "Statutory safety signage across site as per norms", "lot", 1, 85000, 85000]);
  ws.addRow([
    null,
    "Note: HVAC scope excluded from this quote. We recommend engaging a specialist MEP contractor for VRF/ducting works separately.",
  ]);
  await wb.xlsx.writeFile("../test-data/large-construction/bid-metro-builders.xlsx");
  console.log("wrote metro builders");
}

// --- BID C: Apex Infra Works - unit mismatch + qty mismatch on vitrified tile ---
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  ws.addRow(["Apex Infra Works — Quote for CC-2026-11"]);
  ws.addRow(["Sr.No", "Item", "Description", "Unit", "Quantity", "Rate", "Amount"]);
  let idx = 0;
  for (const section of sections) {
    ws.addRow([null, section.name]);
    for (let i = 0; i < section.items.length; i++) {
      const item = allItems[idx];
      let rate = Math.round(baseRates[idx] * 1.1);
      let unit = item.unit;
      let qty = item.qty;
      if (item.name === "Vitrified tile flooring 600x600") {
        // Deliberate unit mismatch (Sq.Ft instead of Sqm) and a quantity mismatch.
        unit = "Sq.Ft";
        qty = 23680; // ~2200 sqm converted (wrongly treated as if same numeric basis issue)
        rate = Math.round(rate / 10.76); // rate per sqft equivalent, messy on purpose
      }
      ws.addRow([i + 1, item.name, item.desc, unit, qty, rate, Math.round(rate * qty)]);
      idx++;
    }
  }
  await wb.xlsx.writeFile("../test-data/large-construction/bid-apex-infra.xlsx");
  console.log("wrote apex infra");
}

// --- BID D: Everest Builders - multi price variant on 3 Civil items, material-by-client remarks ---
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  ws.addRow(["Everest Builders — Quote for CC-2026-11 — Option A (Standard) / Option B (Premium Grade)"]);
  ws.addRow(["Sr.No", "Item", "Description", "Unit", "Quantity", "Rate (Std)", "Rate (Premium)", "Amount (Std)", "Amount (Premium)"]);
  let idx = 0;
  for (const section of sections) {
    ws.addRow([null, section.name]);
    for (let i = 0; i < section.items.length; i++) {
      const item = allItems[idx];
      const rateStd = Math.round(baseRates[idx] * 1.0);
      const isVariantItem = section.name === "Civil & Structural" && i < 3;
      let remark = "";
      if (section.name === "Civil & Structural" && (i === 1 || i === 2)) remark = "Steel & cement supplied by client";
      if (isVariantItem) {
        const ratePrem = Math.round(rateStd * 1.22);
        ws.addRow([i + 1, item.name, item.desc, item.unit, item.qty, rateStd, ratePrem, rateStd * item.qty, ratePrem * item.qty, remark]);
      } else {
        ws.addRow([i + 1, item.name, item.desc, item.unit, item.qty, rateStd, null, rateStd * item.qty, null, remark]);
      }
      idx++;
    }
  }
  await wb.xlsx.writeFile("../test-data/large-construction/bid-everest-builders.xlsx");
  console.log("wrote everest builders");
}
