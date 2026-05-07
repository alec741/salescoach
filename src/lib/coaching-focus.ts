import { rubricKeys, type RubricKey } from "./types";

export const sellingSequence = [
  "qualification",
  "quantification",
  "discovery",
  "solution_to_pain",
  "close_or_next_step",
  "feature_dump_control",
  "opening"
] as const satisfies readonly RubricKey[];

const coachingTarget = 8;

const leverageWeights: Partial<Record<RubricKey, number>> = {
  qualification: 1.25,
  quantification: 1.25,
  discovery: 1.15,
  solution_to_pain: 1.1,
  close_or_next_step: 1,
  feature_dump_control: 0.85,
  opening: 0.8
};

const focusCopy: Record<RubricKey, { headline: string; behavior: string }> = {
  opening: {
    headline: "Set a cleaner opening agenda before discovery.",
    behavior:
      "Open with the inbound reason, confirm owner/decision-maker status, and earn permission to ask fit questions before explaining product."
  },
  qualification: {
    headline: "Tighten ICP and Contractor A/B qualification before solutioning.",
    behavior:
      "By minute 5, identify whether the buyer is no-financing, dealer-fee financing, adjacent, or poor-fit before explaining Enhancify."
  },
  discovery: {
    headline: "Diagnose current process, desired outcome, and status-quo consequence before product explanation.",
    behavior: "Ask current situation, desired situation, and consequence questions before describing how the platform works."
  },
  quantification: {
    headline: "Quantify the financing gap before presenting Enhancify.",
    behavior:
      "Ask one math question before solutioning: out of 10 estimates, how many stall because of price or financing, and what is that worth per month?"
  },
  solution_to_pain: {
    headline: "Turn diagnosed pain into one concise solution narrative.",
    behavior: "Before each product point, name the exact pain it solves and confirm the buyer sees the connection."
  },
  feature_dump_control: {
    headline: "Reduce product detail with shorter confirmation loops.",
    behavior:
      "After each relevant product point, pause and ask whether that fits their sales process instead of continuing the explanation."
  },
  close_or_next_step: {
    headline: "Convert diagnosed pain into a clear decision or calendar-controlled next step.",
    behavior: "End with a direct close ask or a dated next step tied to the decision maker, decision criteria, and timing."
  },
  compliance: {
    headline: "Tighten high-risk financing expectation language immediately.",
    behavior:
      "Use approved language on marketplace status, soft pull, final lender approval, hard inquiry, customer-received funds, and no guaranteed rates, approvals, amounts, or timelines."
  }
};

const combinedFocus = new Map<string, { headline: string; behavior: string }>([
  [
    "qualification|quantification",
    {
      headline: "Tighten qualification and quantify the financing gap before solutioning.",
      behavior:
        "Confirm Contractor A/B fit, current financing setup, lost-job volume, dealer-fee cost, and decision timing before explaining the platform."
    }
  ],
  [
    "discovery|quantification",
    {
      headline: "Diagnose and quantify pain before presenting Enhancify.",
      behavior: "Get the current process, the consequence of staying there, and one clear business-impact number before solutioning."
    }
  ],
  [
    "quantification|solution_to_pain",
    {
      headline: "Use quantified pain to create a tighter solution narrative.",
      behavior:
        "State the ROI problem in the buyer's words, then map only the smallest set of Enhancify capabilities to that pain."
    }
  ],
  [
    "qualification|discovery",
    {
      headline: "Qualify fit and diagnose the current selling motion before solutioning.",
      behavior: "Confirm segment, timing, financing process, and desired outcome before moving into product mechanics."
    }
  ]
]);

export type CoachingFocus = {
  dimensions: RubricKey[];
  primaryDimension: RubricKey;
  headline: string;
  behavior: string;
  rationale: string;
};

export function weakestScoreDimension(scores: Record<RubricKey, number>) {
  return rubricKeys.reduce((min, key) => (scores[key] < scores[min] ? key : min), rubricKeys[0]);
}

export function strongestScoreDimension(scores: Record<RubricKey, number>) {
  return rubricKeys.reduce((max, key) => (scores[key] > scores[max] ? key : max), rubricKeys[0]);
}

function complianceShouldDriveFocus(scores: Record<RubricKey, number>, complianceFlagCount: number, calls = 1) {
  if (calls <= 0) return false;
  const complianceScore = Number(scores.compliance || 0);
  return complianceScore <= 5.5 || (complianceScore <= 6 && complianceFlagCount >= Math.max(3, calls * 0.75));
}

function leverageDeficit(scores: Record<RubricKey, number>, key: RubricKey) {
  return Math.max(0, coachingTarget - Number(scores[key] || 0)) * (leverageWeights[key] || 1);
}

export function chooseCoachingFocus(
  scores: Record<RubricKey, number>,
  complianceFlagCount = 0,
  calls = 1
): CoachingFocus {
  if (complianceShouldDriveFocus(scores, complianceFlagCount, calls)) {
    return {
      dimensions: ["compliance"],
      primaryDimension: "compliance",
      headline: focusCopy.compliance.headline,
      behavior: focusCopy.compliance.behavior,
      rationale: "Compliance is the coaching focus because the score or repeated flags indicate material risk."
    };
  }

  const ranked = [...sellingSequence].sort((a, b) => {
    const gap = leverageDeficit(scores, b) - leverageDeficit(scores, a);
    return gap || sellingSequence.indexOf(a) - sellingSequence.indexOf(b);
  });
  const primary = ranked[0] || "quantification";
  const secondary = ranked[1];
  const pair = secondary
    ? [primary, secondary].sort((a, b) => sellingSequence.indexOf(a) - sellingSequence.indexOf(b)).join("|")
    : "";
  const combined = combinedFocus.get(pair);
  const useCombined = Boolean(secondary && combined && leverageDeficit(scores, secondary) >= leverageDeficit(scores, primary) - 0.35);

  return {
    dimensions: useCombined ? (pair.split("|") as RubricKey[]) : [primary],
    primaryDimension: primary,
    headline: useCombined ? combined!.headline : focusCopy[primary].headline,
    behavior: useCombined ? combined!.behavior : focusCopy[primary].behavior,
    rationale:
      "Primary focus selected by Decoded leverage: upstream selling behaviors beat compliance watchouts unless compliance risk is severe."
  };
}
