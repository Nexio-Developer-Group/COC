import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";
import { cellTone, cellValue, type ExportDoc, type Tone } from "./model";

const TONE_RGB: Record<Tone, [number, number, number]> = {
  good: [228, 242, 231], bad: [251, 227, 215], warn: [255, 244, 204], info: [227, 236, 250], auto: [227, 236, 250], converted: [221, 243, 239], manual: [255, 244, 204], flag: [251, 213, 213],
};

// Helvetica has no rupee glyph; keep PDFs readable instead of rendering a box.
const clean = (s: string) => s.replace(/₹/g, "Rs. ").replace(/[→]/g, "->").replace(/[×]/g, "x").replace(/[—–]/g, "-").replace(/[^\x00-\xFF]/g, "?");

const indian = (n: number, frac = 2) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: frac }).format(n);

async function fetchImage(url: string): Promise<{ data: string; type: "PNG" | "JPEG" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = (res.headers.get("content-type") ?? "").includes("png") ? "PNG" : "JPEG";
    if (!/png|jpe?g/.test(res.headers.get("content-type") ?? "")) return null;
    return { data: `data:image/${type.toLowerCase()};base64,${buf.toString("base64")}`, type };
  } catch {
    return null;
  }
}

export async function toPdf(doc: ExportDoc): Promise<Buffer> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  let first = true;

  for (const sheet of doc.sheets) {
    if (!first) pdf.addPage();
    first = false;
    pdf.setFillColor(92, 49, 30);
    pdf.rect(0, 0, pageW, 46, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(15);
    pdf.text(clean(sheet.title ?? doc.title), 36, 29);
    pdf.setFontSize(9);
    if (doc.subtitle) pdf.text(clean(doc.subtitle), pageW - 36, 29, { align: "right" });
    pdf.setTextColor(30, 30, 30);

    const head = [sheet.columns.map((c) => clean(c.label))];
    const body: CellDef[][] = sheet.rows.map((row) =>
      sheet.columns.map((c) => {
        const raw = row.cells[c.key];
        const v = cellValue(raw);
        const tone = cellTone(raw);
        let text = v == null ? "" : typeof v === "number" ? (c.kind === "money" ? `Rs. ${indian(v)}` : c.kind === "pct" ? `${indian(v, 1)}%` : indian(v, 2)) : clean(String(v));
        if (row.indent && c.key === sheet.columns[0].key) text = "  " + text;
        const def: CellDef = { content: text, styles: { halign: typeof v === "number" || c.align === "right" ? "right" : "left" } };
        if (row.band) def.styles = { ...def.styles, fillColor: [126, 66, 40], textColor: [255, 255, 255], fontStyle: "bold" };
        else if (row.total) def.styles = { ...def.styles, fontStyle: "bold", fillColor: [237, 234, 230] };
        else if (tone) def.styles = { ...def.styles, fillColor: TONE_RGB[tone] };
        return def;
      })
    );
    const widths = sheet.columns.map((c) => c.width);
    autoTable(pdf, {
      head,
      body,
      startY: 62,
      margin: { left: 36, right: 36, bottom: 36 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: "linebreak", lineColor: [225, 220, 214], lineWidth: 0.4 },
      headStyles: { fillColor: [92, 49, 30], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [250, 249, 247] },
      columnStyles: Object.fromEntries(widths.map((w, i) => [i, w ? { cellWidth: Math.max(40, Math.min(w * 5.2, 260)) } : {}])),
      didDrawPage: () => {
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);
        pdf.text(`TenderBoard  -  page ${pdf.getNumberOfPages()}`, pageW - 36, pageH - 16, { align: "right" });
        pdf.setTextColor(30, 30, 30);
      },
    });

    let y = (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
    if (sheet.notes?.length) {
      y += 18;
      pdf.setFontSize(9);
      for (const n of sheet.notes) {
        const lines = pdf.splitTextToSize(clean(n), pageW - 72) as string[];
        if (y + lines.length * 11 > pageH - 30) {
          pdf.addPage();
          y = 50;
        }
        pdf.text(lines, 36, y);
        y += lines.length * 11 + 2;
      }
    }
    if (sheet.images?.length) {
      let x = 36;
      y += 14;
      for (const im of sheet.images.slice(0, 12)) {
        const img = await fetchImage(im.url);
        if (!img) continue;
        if (x + 130 > pageW - 36) {
          x = 36;
          y += 108;
        }
        if (y + 100 > pageH - 30) {
          pdf.addPage();
          y = 50;
          x = 36;
        }
        try {
          pdf.addImage(img.data, img.type, x, y, 120, 90);
        } catch {
          /* skip undecodable image */
        }
        if (im.caption) {
          pdf.setFontSize(7);
          pdf.text(clean(im.caption).slice(0, 34), x, y + 99);
        }
        x += 130;
      }
    }
  }
  return Buffer.from(pdf.output("arraybuffer"));
}
