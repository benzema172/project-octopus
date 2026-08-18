import { type Db, type SeedInput } from "@/lib/demo/wysoka-seed-shared";
import { seedProjectFoundation } from "@/lib/demo/wysoka-seed-project-foundation";
import { seedProjectControl } from "@/lib/demo/wysoka-seed-project-control";

export async function seedProjectCore(db: Db, input: SeedInput) {
  const foundation = await seedProjectFoundation(db, input);
  const controlCreated = await seedProjectControl(db, input, foundation.wbs, foundation.boq, foundation.boqVersionId);
  return { created: foundation.created + controlCreated, wbs: foundation.wbs, boq: foundation.boq, materials: foundation.materials };
}
