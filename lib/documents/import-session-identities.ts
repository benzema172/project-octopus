import { createHash } from "node:crypto";

// Reproducible identifiers let a disconnected upload safely locate a document
// that was persisted before its session item could be linked.
export function stableSessionUuid(workspaceId: string, itemId: string, kind: "document" | "version"): string {
  const bytes = createHash("sha256").update(`octopus-import-v1:${workspaceId}:${itemId}:${kind}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
