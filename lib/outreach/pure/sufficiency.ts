/**
 * Decide whether there is enough verified public information to write to a
 * company at all. Pure module.
 */

import type { FactKind, SourcedFact, Sufficiency } from "@/types/outreach";

/** Register context (company age, business line) does not count. */
const SUBSTANTIVE: ReadonlySet<FactKind> = new Set<FactKind>([
  "strategy_goal",
  "financial",
  "hiring",
  "why_now",
  "leader_statement",
]);

export const countSubstantiveFacts = (facts: SourcedFact[]): number =>
  facts.filter((fact) => SUBSTANTIVE.has(fact.kind)).length;

/**
 * - ready:        >= 2 substantive verified facts AND a named CEO
 * - weak:         >= 1 substantive verified fact (CEO email only, low confidence)
 * - insufficient: nothing verified — do not write
 */
export const assessSufficiency = (
  facts: SourcedFact[],
  hasCeoName: boolean,
): Sufficiency => {
  const count = countSubstantiveFacts(facts);
  if (count >= 2 && hasCeoName) return "ready";
  if (count >= 1) return "weak";
  return "insufficient";
};
