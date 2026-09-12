import { notFound } from "next/navigation";

import { ServiceDown } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import type { DecisionResponse } from "@/lib/types";

import { SiteDecisionsClient } from "./SiteDecisionsClient";

/**
 * The despatch plan.
 *
 * This is the page the product exists for. A forecast is an observation; this
 * is the instruction that follows from it, priced and ordered by merit.
 *
 * The page hierarchy:
 * 1. WHAT IS HAPPENING? (Hero decision summary)
 * 2. WHAT SHOULD I DO? (Primary recommendation & action affordance)
 * 3. WHY? (Attribution & physics drivers)
 * 4. DETAILED EVIDENCE (Progressive disclosure of events, merit order, and 96-block table)
 */
export default async function DecisionsPage(
  props: PageProps<"/sites/[siteId]/decisions">,
) {
  const { siteId } = await props.params;

  let decisions: DecisionResponse;
  try {
    decisions = await api.decisions(siteId, 24);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return (
      <ServiceDown
        title="Despatch plan unavailable"
        message={error instanceof ApiError ? error.message : "The service didn't respond."}
        hint={error instanceof ApiError ? error.hint : undefined}
      />
    );
  }

  return <SiteDecisionsClient decisions={decisions} />;
}
