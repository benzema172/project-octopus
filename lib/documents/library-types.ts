export type DocumentLibraryFact = {
  label: string;
  value: string;
  unit: string | null;
  confidence: number | null;
};

export type DocumentLibraryProposal = {
  module: string;
  title: string;
  status: string;
  confidence: number | null;
  sourceQuote: string | null;
};

export type DocumentLibraryInsight = {
  documentId: string;
  versionId: string | null;
  analysisStatus: string | null;
  schemaVersion: string | null;
  summary: string | null;
  facts: DocumentLibraryFact[];
  warnings: string[];
  extractionMethod: string | null;
  textPreview: string | null;
  pageCount: number | null;
  characterCount: number | null;
  qualityScore: number | null;
  proposals: DocumentLibraryProposal[];
};
