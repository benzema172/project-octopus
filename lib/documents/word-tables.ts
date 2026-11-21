import { SaxesParser } from "saxes";

export type WordLink = { label: string; target: string };
export type WordRow = { table: number; row: number; cells: string[]; links: WordLink[] };

const local = (name: string) => name.split(":").at(-1) ?? name;
const plain = (text: string) => text.replace(/\s+/g, " ").trim();

export function attachmentTarget(raw: string) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    // A relative sibling may be resolved only against files visible in this project.
    if (Array.from(raw).some(c => c.charCodeAt(0) < 32)) return "";
    return /^[^\\/:?#%]+\.(?:pdf|docx?|xlsx?|png|jpe?g)$/iu.test(raw) ? raw : "";
  }
}

function relationships(xml?: string) {
  const links = new Map<string, string>();
  if (!xml) return links;
  const parser = new SaxesParser();
  parser.on("opentag", ({ name, attributes }) => {
    if (local(name) !== "Relationship" || !String(attributes.Type).endsWith("/hyperlink")) return;
    const target = attachmentTarget(String(attributes.Target ?? ""));
    if (target) links.set(String(attributes.Id), target);
  });
  parser.write(xml).close();
  return links;
}

type Cell = { text: string; links: WordLink[] };
function readNotes(xml: string | undefined, rels: Map<string, string>) {
  const notes = new Map<string, Cell>();
  if (!xml) return notes;
  const parser = new SaxesParser();
  let note: Cell | undefined, link: WordLink | undefined, inText = false;
  parser.on("opentag", ({ name, attributes }) => {
    const tag = local(name);
    if (tag === "footnote" || tag === "endnote") {
      note = { text: "", links: [] };
      notes.set(String(attributes["w:id"] ?? attributes.id), note);
    }
    if (tag === "hyperlink") link = { label: "", target: rels.get(String(attributes["r:id"])) ?? "" };
    if (tag === "t") inText = true;
  });
  parser.on("text", value => { if (note && inText) { note.text += value; if (link) link.label += value; } });
  parser.on("closetag", ({ name }) => {
    const tag = local(name);
    if (tag === "t") inText = false;
    if (tag === "p" && note) note.text += " ";
    if (tag === "hyperlink") { if (link?.target && note) note.links.push(link); link = undefined; }
    if (tag === "footnote" || tag === "endnote") note = undefined;
  });
  parser.write(xml).close();
  return notes;
}

export function readWordDocument(part: (path: string) => string | undefined) {
  const xml = part("word/document.xml");
  if (!xml) throw new Error("DOCX nie zawiera word/document.xml.");
  const links = relationships(part("word/_rels/document.xml.rels"));
  const notes = (name: string) => readNotes(part(`word/${name}.xml`), relationships(part(`word/_rels/${name}.xml.rels`)));
  const footnotes = notes("footnotes"), endnotes = notes("endnotes");
  const rows: WordRow[] = [], paragraphs: string[] = [];
  let depth = 0, table = 0, row = 0, paragraph = "", inText = false;
  let cells: Cell[] = [], cell: Cell | undefined, link: WordLink | undefined;
  let outputLength = 0;
  function append(value: string) {
    outputLength += value.length;
    if (outputLength > 8_000_000) throw new Error("Treść dokumentu Word przekracza limit odczytu.");
    if (cell) cell.text += value; else paragraph += value;
  }
  function finishParagraph() { if (paragraph.trim()) paragraphs.push(paragraph.trim()); paragraph = ""; }
  const parser = new SaxesParser();
  parser.on("opentag", ({ name, attributes }) => {
    const tag = local(name);
    if (tag === "tbl") { if (depth++ === 0) { finishParagraph(); table++; row = 0; } }
    if (tag === "tr" && depth === 1) { row++; cells = []; }
    if (tag === "tc" && depth === 1) { cell = { text: "", links: [] }; cells.push(cell); }
    if (tag === "t" || tag === "delText") inText = true;
    if (tag === "tab" || tag === "br") append(cell ? " " : tag === "br" ? "\n" : "\t");
    if (tag === "hyperlink") link = { label: "", target: links.get(String(attributes["r:id"])) ?? "" };
    if (tag === "footnoteReference" || tag === "endnoteReference") {
      const note = (tag === "footnoteReference" ? footnotes : endnotes).get(String(attributes["w:id"] ?? attributes.id));
      if (note) {
        append(` [${plain(note.text)}${note.links.length ? " " + note.links.map(item => item.target).join(" ") : ""}] `);
        if (cell) cell.links.push(...note.links);
      }
    }
  });
  parser.on("text", value => { if (inText) { append(value); if (link) link.label += value; } });
  parser.on("closetag", ({ name }) => {
    const tag = local(name);
    if (tag === "t" || tag === "delText") inText = false;
    if (tag === "hyperlink") {
      if (link?.target) { if (cell) cell.links.push(link); append(` [${link.target}]`); }
      link = undefined;
    }
    if (tag === "p") { if (cell) append(" "); else finishParagraph(); }
    if (tag === "tc") { if (depth === 1) cell = undefined; else if (cell) append(" "); }
    if (tag === "tr" && depth === 1) {
      const item = { table, row, cells: cells.map(c => plain(c.text)), links: cells.flatMap(c => c.links) };
      rows.push(item);
      paragraphs.push(`[Tabela ${table}, wiersz ${row}] ${item.cells.join("\t")}`);
    }
    if (tag === "tbl") depth--;
  });
  parser.write(xml).close();
  finishParagraph();
  return { text: paragraphs.join("\n").trim(), rows };
}
