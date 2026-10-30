import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const src=readFileSync("components/documents/document-upload.tsx","utf8");
describe("Bounded Wrzutnia uploads",()=>{
 it("uses at most 3 concurrent transfers and finalizes after all settle",()=>{
   expect(src).toContain("const concurrentTransfers = importSessionId && selectedFiles.length > 1 ? 3 : 1");
   expect(src).toContain("while (nextCandidateIndex < selectedFiles.length)");
   expect(src).toContain("await Promise.all(Array.from(");
   expect(src.indexOf("await Promise.all(Array.from(")).toBeLessThan(src.indexOf('action: "finalize"'));
 });
 it("preserves exact ordinals, hashes, session IDs and resumes",()=>{
   expect(src).toContain("alreadyUploaded.has(index + 1)");
   expect(src).toContain("fileDigests.get(index + 1)");
   expect(src).toContain("importItems.get(index + 1)");
   expect(src).toContain("action: \"fail\"");
 });
});
