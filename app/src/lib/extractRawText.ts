import ExcelJS from "exceljs";
import mammoth from "mammoth";

export type RawTextResult = {
  text: string;
  sourceType: "xlsx" | "csv" | "pdf" | "docx" | "txt";
  truncated: boolean;
};

const MAX_CHARS = 60_000; // keep the extraction prompt within a safe context budget

function truncate(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_CHARS), truncated: true };
}

function detectType(filename: string, mimeType: string): RawTextResult["sourceType"] {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "xlsx" || ext === "xlsm" || mimeType.includes("spreadsheet")) return "xlsx";
  if (ext === "csv") return "csv";
  if (ext === "pdf" || mimeType.includes("pdf")) return "pdf";
  if (ext === "docx" || mimeType.includes("wordprocessingml")) return "docx";
  return "txt";
}

function cellToText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && "result" in (v as object)) {
    return cellToText((v as { result: ExcelJS.CellValue }).result);
  }
  if (typeof v === "object" && "formula" in (v as object)) {
    return ""; // formula with no cached result (never recalculated) — treat as blank
  }
  if (typeof v === "object" && "error" in (v as object)) {
    return `#ERROR(${(v as { error: string }).error})`;
  }
  if (typeof v === "object" && "richText" in (v as object)) {
    return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  }
  if (typeof v === "number") {
    const rounded = Math.round(v * 10000) / 10000;
    return String(rounded);
  }
  return String(v);
}

async function xlsxToText(buffer: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const parts: string[] = [];

  wb.eachSheet((sheet) => {
    let nonEmptyRows = 0;
    const rowLines: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cellParts: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        // Merged cells report the master's value for every cell in the range;
        // only emit it once, from the master (top-left) cell.
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        let text = cellToText(cell.value).trim().replace(/\s+/g, " ");
        if (!text) return;
        if (text.length > 1500) text = text.slice(0, 1500) + `…[+${text.length - 1500} chars]`;
        cellParts.push(`${cell.address.replace(/\d+$/, "")}:${text}`);
      });
      if (cellParts.length > 0) {
        nonEmptyRows++;
        rowLines.push(`R${rowNumber} | ${cellParts.join(" | ")}`);
      }
    });
    if (nonEmptyRows > 0) {
      parts.push(`=== Sheet "${sheet.name}" — ${nonEmptyRows} non-empty rows ===`);
      parts.push(...rowLines);
    }
  });

  return parts.join("\n");
}

export async function extractRawText(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<RawTextResult> {
  const sourceType = detectType(filename, mimeType);
  let text: string;

  switch (sourceType) {
    case "xlsx":
      text = await xlsxToText(buffer);
      break;
    case "csv":
    case "txt":
      text = buffer.toString("utf-8");
      break;
    case "pdf": {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text;
      await parser.destroy();
      break;
    }
    case "docx": {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      break;
    }
    default:
      text = buffer.toString("utf-8");
  }

  const { text: finalText, truncated } = truncate(text);
  return { text: finalText, sourceType, truncated };
}
