import type { SlideLayout } from "../types";
import { coverLayout } from "./cover";
import { sectionLayout } from "./section";
import { keyPointsLayout } from "./key-points";
import { metricsLayout } from "./metrics";
import { comparisonLayout } from "./comparison";
import { closingLayout } from "./closing";

const LAYOUTS = new Map<string, SlideLayout>([
  ["cover", coverLayout],
  ["section", sectionLayout],
  ["key_points", keyPointsLayout],
  ["metrics", metricsLayout],
  ["comparison", comparisonLayout],
  ["closing", closingLayout],
]);

export function getLayout(type: string): SlideLayout | undefined {
  return LAYOUTS.get(type);
}

export function listLayoutSummaries() {
  return Array.from(LAYOUTS.values()).map((l) => ({
    type: l.type,
    name: l.name,
    description: l.description,
    dataSchema: l.dataSchema,
  }));
}
