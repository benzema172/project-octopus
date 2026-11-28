import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { extractSpreadsheetIntelligence } from "../lib/documents/spreadsheet-intelligence";
import { readWordDocument } from "../lib/documents/word-tables";
vi.mock("server-only", () => ({}));

describe("źródła protokołu i kosztorysu", () => {
  it("zachowuje operator Worda obok obrazu i tekstu OMML, a obcy glif pozostawia nierozpoznany", () => {
    const xml = '<w:tbl><w:tr><w:tc><w:p><w:r><w:drawing/><w:sym w:font="Symbol" w:char="F0A3"/></w:r><m:oMath><m:r><m:t> 5 bar</m:t></m:r></m:oMath></w:p></w:tc><w:tc><w:sym w:font="Wingdings" w:char="F0A3"/></w:tc></w:tr></w:tbl>';
    expect(readWordDocument(path => path === "word/document.xml" ? xml : undefined).rows[0])
      .toMatchObject({ table: 1, row: 1, cells: ["≤ 5 bar", "�"] });
  });

  it.each(["PLN", "EUR"])("zachowuje kwotę i walutę %s z korekty we właściwej komórce", currency => {
    const book = XLSX.utils.book_new();
    const base = XLSX.utils.aoa_to_sheet([["Lp","Opis","Jm","Ilość","Cena","Wartość"],["B1","Zwrot","m",1,10,10]]);
    base.F2.z = '0 "EUR"';
    XLSX.utils.book_append_sheet(book, base, "Przedmiar");
    const correction = XLSX.utils.aoa_to_sheet([["Lp","Rewizja","Wartość"],["B1","R2",-1250]]);
    correction.C2.z = '#,##0.00 "' + currency + '";(#,##0.00 "' + currency + '")';
    XLSX.utils.book_append_sheet(book, correction, "Korekty");
    const analysis = extractSpreadsheetIntelligence(XLSX.write(book, { type:"buffer", bookType:"xlsx" }));
    expect(analysis.boqItems[0].totalPrice).toBe(-1250);
    expect(analysis.fieldEvidence.find(x => x.path === "boqItems.0.totalPrice")).toMatchObject({quote:"-1250", currency, cell:"C2", locator:expect.stringContaining("Korekty")});
    expect(analysis.workbookReview.some(reason => reason.includes("EUR"))).toBe(currency === "EUR");
  });
});
