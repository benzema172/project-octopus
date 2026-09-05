import "server-only";

import { PDFDocument } from "pdf-lib";

export type PdfPageChunkPlan = {
  key: string;
  pageStart: number;
  pageEnd: number;
};

export type PdfPageChunk = PdfPageChunkPlan & {
  bytes: Buffer;
};

export function planPdfPageChunks(pageCount: number, pagesPerChunk = 4, overlapPages = 1): PdfPageChunkPlan[] {
  const total = Math.max(0, Math.floor(pageCount));
  if (!total) return [];
  const size = Math.max(1, Math.floor(pagesPerChunk));
  const overlap = Math.max(0, Math.min(size - 1, Math.floor(overlapPages)));
  const step = Math.max(1, size - overlap);
  const chunks: PdfPageChunkPlan[] = [];

  for (let pageStart = 1; pageStart <= total; pageStart += step) {
    const pageEnd = Math.min(total, pageStart + size - 1);
    chunks.push({ key: `${pageStart}-${pageEnd}`, pageStart, pageEnd });
    if (pageEnd >= total) break;
  }
  return chunks;
}

export async function splitPdfIntoPageChunks(
  bytes: Buffer,
  pagesPerChunk = 4,
  overlapPages = 1
): Promise<{ pageCount: number; chunks: PdfPageChunk[] }> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const pageCount = source.getPageCount();
  const plans = planPdfPageChunks(pageCount, pagesPerChunk, overlapPages);
  const chunks: PdfPageChunk[] = [];

  for (const plan of plans) {
    const target = await PDFDocument.create();
    const indexes = Array.from(
      { length: plan.pageEnd - plan.pageStart + 1 },
      (_, index) => plan.pageStart - 1 + index
    );
    const copiedPages = await target.copyPages(source, indexes);
    copiedPages.forEach((page) => target.addPage(page));
    const chunkBytes = await target.save({ useObjectStreams: true, addDefaultPage: false });
    chunks.push({ ...plan, bytes: Buffer.from(chunkBytes) });
  }

  return { pageCount, chunks };
}
