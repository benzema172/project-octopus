"use client";

import Link from "next/link";
import { ChevronDown, FileText, FolderOpen, Sparkles } from "lucide-react";
import type { ComponentProps } from "react";
import { HrAccountingBridge160 } from "./hr-accounting-bridge-160";
import { HrDocumentUpload157 } from "./hr-document-upload-157";
import { HrFormalDocuments160 } from "./hr-formal-documents-160";
import styles from "./hr-documents-compact-161.module.css";

type FormalData = ComponentProps<typeof HrFormalDocuments160>["data"];

type Props = {
  workspaceId: string;
  referenceDate: string;
  canWrite: boolean;
  documentCount: number;
  data: FormalData;
};

export function HrDocumentsCompact161({ workspaceId, referenceDate, canWrite, documentCount, data }: Props) {
  return <section className={styles.root} data-hr-documents-compact="1">
    <header className={styles.toolbar}>
      <div className={styles.titleBlock}>
        <span className={styles.titleIcon}><FileText size={18} /></span>
        <div>
          <h2>Dokumenty pracowników</h2>
          <span>{documentCount} {documentCount === 1 ? "plik" : "plików"} w Kadrach</span>
        </div>
      </div>
      <div className={styles.actions}>
        <Link href={`/workspace/companies/${workspaceId}/documents`}><FolderOpen size={15} /> Biblioteka</Link>
        <Link href={`/workspace/companies/${workspaceId}/ai-center`}><Sparkles size={15} /> Wzory i Brain</Link>
      </div>
    </header>

    <HrDocumentUpload157 workspaceId={workspaceId} canWrite={canWrite} documentCount={documentCount} />

    <div className={styles.sectionLabel}>
      <strong>Akta i kompletność</strong>
      <span>Umowy, badania, BHP, uprawnienia i terminy</span>
    </div>
    <HrFormalDocuments160 workspaceId={workspaceId} referenceDate={referenceDate} data={data} />

    <details className={styles.accounting}>
      <summary>
        <span>
          <strong>Eksport księgowy</strong>
          <small>Miesięczne zamknięcie danych i CSV</small>
        </span>
        <span className={styles.expand}>Rozwiń <ChevronDown size={16} /></span>
      </summary>
      <div className={styles.accountingBody}>
        <HrAccountingBridge160 workspaceId={workspaceId} referenceDate={referenceDate} />
      </div>
    </details>
  </section>;
}
