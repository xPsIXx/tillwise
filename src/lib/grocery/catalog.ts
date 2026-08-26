import type { LabelExtraction, ProductMemory } from "./types";
import { extractionIsThin } from "./parse-local";

export function fillFromMemory(data: LabelExtraction, mem: ProductMemory): LabelExtraction {
  const thin = extractionIsThin(data);
  return {
    ...data,
    name: thin ? mem.name : data.name,
    brand: data.brand ?? mem.brand,
    category: data.category ?? mem.category,
    unitPrice: data.unitPrice ?? mem.lastUnitPrice,
    linePrice: data.linePrice ?? mem.lastLinePrice,
    weightValue: data.weightValue ?? mem.lastWeightValue,
    barcode: data.barcode ?? mem.barcode,
  };
}
