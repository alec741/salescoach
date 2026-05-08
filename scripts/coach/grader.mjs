import fs from "node:fs";
import path from "node:path";
import { average, clampScore, readJson, transcriptText } from "./shared.mjs";

const RUBRIC_KEYS = [
  "opening",
  "qualification",
  "discovery",
  "quantification",
  "solution_to_pain",
  "feature_dump_control",
  "close_or_next_step",
  "compliance"
];

const SELLING_SEQUENCE = [
  "qualification",
  "quantification",
  "discovery",
  "solution_to_pain",
  "close_or_next_step",
  "feature_dump_control",
  "opening"
];

const THEMES = {
  opening: "Set a cleaner opening agenda before discovery.",
  qualification: "Tighten ICP and Contractor A/B qualification before solutioning.",
  discovery: "Diagnose current process, desired outcome, and status-quo consequence before product explanation.",
  quantification: "Quantify the financing gap before presenting Enhancify.",
  solution_to_pain: "Turn diagnosed pain into one concise solution narrative.",
  feature_dump_control: "Reduce product detail with shorter confirmation loops.",
  close_or_next_step: "Convert diagnosed pain into a clear decision or calendar-controlled next step.",
  compliance: "Tighten high-risk financing expectation language immediately."
};

const NEXT_BEHAVIORS = {
  opening: "Open with the inbound reason, confirm owner/decision-maker status, and earn permission to ask fit questions before explaining product.",
  qualification: "By minute 5, identify whether the buyer is no-financing, dealer-fee financing, adjacent, or poor-fit before explaining Enhancify.",
  discovery: "Ask current situation, desired situation, and consequence questions before describing how the platform works.",
  quantification: "Ask one math question before solutioning: out of 10 estimates, how many stall because of price or financing, and what is that worth per month?",
  solution_to_pain: "Before each product point, name the exact pain it solves and confirm the buyer sees the connection.",
  feature_dump_control: "After each relevant product point, pause and ask whether that fits their sales process instead of continuing the explanation.",
  close_or_next_step: "End with a direct close ask or a dated next step tied to the decision maker, decision criteria, and timing.",
  compliance: "Use approved language on marketplace status, soft pull, final lender approval, hard inquiry, customer-received funds, and no guaranteed rates, approvals, amounts, or timelines."
};

const COMBINED_FOCUS = new Map([
  ["qualification|quantification", {
    headline: "Tighten qualification and quantify the financing gap before solutioning.",
    behavior: "Confirm Contractor A/B fit, current financing setup, lost-job volume, dealer-fee cost, and decision timing before explaining the platform."
  }],
  ["discovery|quantification", {
    headline: "Diagnose and quantify pain before presenting Enhancify.",
    behavior: "Get the current process, the consequence of staying there, and one clear business-impact number before solutioning."
  }],
  ["quantification|solution_to_pain", {
    headline: "Use quantified pain to create a tighter solution narrative.",
    behavior: "State the ROI problem in the buyer's words, then map only the smallest set of Enhancify capabilities to that pain."
  }],
  ["qualification|discovery", {
    headline: "Qualify fit and diagnose the current selling motion before solutioning.",
    behavior: "Confirm segment, timing, financing process, and desired outcome before moving into product mechanics."
  }]
]);

const SEGMENT_LABELS = {
  contractor_a_no_financing: "Contractor A - no financing solution",
  contractor_b_dealer_fee: "Contractor B - dealer-fee/direct-lender financing",
  poor_fit: "Poor fit",
  adjacent: "Adjacent/non-core fit",
  unknown: "Unknown / not enough evidence"
};

const CALL_TYPES = [
  "first_call",
  "follow_up",
  "payment_close",
  "no_show_recovery",
  "partner_follow_up",
  "post_close_handoff",
  "nurture",
  "disqualification",
  "unknown"
];

const OUTCOME_TYPES = [
  "won_despite_weak_process",
  "won_with_strong_process",
  "lost_because_of_weak_process",
  "advanced_with_risk",
  "advanced_strong",
  "disqualified_correctly",
  "no_decision_due_to_missing_pain",
  "no_decision_other",
  "unknown"
];

const LEVERAGE_WEIGHTS = {
  qualification: 1.25,
  quantification: 1.25,
  discovery: 1.15,
  solution_to_pain: 1.1,
  close_or_next_step: 1,
  feature_dump_control: 0.85,
  opening: 0.8
};

function complianceShouldDriveFocus(scores, complianceFlags = [], calls = 1) {
  const score = Number(scores?.compliance || 0);
  return score <= 5.5 || (score <= 6 && complianceFlags.length >= Math.max(3, calls * 0.75));
}

function leverageDeficit(scores, key) {
  return Math.max(0, 8 - Number(scores?.[key] || 0)) * (LEVERAGE_WEIGHTS[key] || 1);
}

function chooseCoachingFocus(scores, complianceFlags = [], calls = 1) {
  if (complianceShouldDriveFocus(scores, complianceFlags, calls)) {
    return {
      dimensions: ["compliance"],
      primaryDimension: "compliance",
      headline: THEMES.compliance,
      behavior: NEXT_BEHAVIORS.compliance,
      rationale: "Compliance is the coaching focus because the score or repeated flags indicate material risk."
    };
  }

  const ranked = [...SELLING_SEQUENCE].sort((a, b) => {
    const gap = leverageDeficit(scores, b) - leverageDeficit(scores, a);
    return gap || SELLING_SEQUENCE.indexOf(a) - SELLING_SEQUENCE.indexOf(b);
  });
  const primary = ranked[0] || "quantification";
  const secondary = ranked[1];
  const pair = secondary
    ? [primary, secondary].sort((a, b) => SELLING_SEQUENCE.indexOf(a) - SELLING_SEQUENCE.indexOf(b)).join("|")
    : "";
  const combined = COMBINED_FOCUS.get(pair);
  const useCombined = combined && leverageDeficit(scores, secondary) >= leverageDeficit(scores, primary) - 0.35;

  return {
    dimensions: useCombined ? pair.split("|") : [primary],
    primaryDimension: primary,
    headline: useCombined ? combined.headline : THEMES[primary],
    behavior: useCombined ? combined.behavior : NEXT_BEHAVIORS[primary],
    rationale: "Primary focus selected by Decoded leverage: upstream selling behaviors beat compliance watchouts unless compliance risk is severe."
  };
}

const SCORECARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    grader_provider: { type: "string" },
    call_id: { type: "string" },
    lead_id: { type: "string" },
    rep_id: { type: "string" },
    rep_name: { type: "string" },
    direction: { type: "string" },
    status: { type: "string" },
    activity_at: { type: "string" },
    date_created: { type: "string" },
    duration_seconds: { type: "number" },
    duration_minutes: { type: "number" },
    transcript_utterances: { type: "integer" },
    lead_segment: { type: "string" },
    call_type: { type: "string", enum: CALL_TYPES },
    outcome_type: { type: "string", enum: OUTCOME_TYPES },
    outcome_rationale: { type: "string" },
    focus_dimension: { type: "string", enum: RUBRIC_KEYS },
    scores: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(RUBRIC_KEYS.map((key) => [key, { type: "number" }])),
      required: RUBRIC_KEYS
    },
    overall_score: { type: "number" },
    top_strength: { type: "string" },
    biggest_coaching_opportunity: { type: "string" },
    next_call_focus: { type: "string" },
    coachable_moment: {
      type: "object",
      additionalProperties: false,
      properties: {
        moment_type: { type: "string", enum: ["missed_question", "premature_solution", "strong_move", "compliance_risk", "close_control", "fit_risk"] },
        timestamp_hint: { type: "string" },
        what_happened: { type: "string" },
        why_it_matters: { type: "string" },
        better_rep_language: { type: "string" }
      },
      required: ["moment_type", "timestamp_hint", "what_happened", "why_it_matters", "better_rep_language"]
    },
    manager_coaching_note: { type: "string" },
    manager_action: {
      type: "object",
      additionalProperties: false,
      properties: {
        listen_for: { type: "string" },
        review_call_reason: { type: "string" },
        roleplay: { type: "string" },
        metric_to_move: { type: "string" },
        ignore_for_now: { type: "string" }
      },
      required: ["listen_for", "review_call_reason", "roleplay", "metric_to_move", "ignore_for_now"]
    },
    success_pattern: {
      type: "object",
      additionalProperties: false,
      properties: {
        what_worked: { type: "string" },
        when_it_works: { type: "string" },
        shareable_talk_track: { type: "string" }
      },
      required: ["what_worked", "when_it_works", "shareable_talk_track"]
    },
    rep_practice_drill: { type: "string" },
    compliance_flags: { type: "array", items: { type: "string" } },
    evidence_summary: {
      type: "object",
      additionalProperties: false,
      properties: {
        rep_talk_ratio: { type: ["number", "null"] },
        contact_talk_seconds: { type: "number" },
        rep_talk_seconds: { type: "number" },
        detected_topics: { type: "array", items: { type: "string" } },
        concise_call_readout: { type: "string" }
      },
      required: ["rep_talk_ratio", "contact_talk_seconds", "rep_talk_seconds", "detected_topics", "concise_call_readout"]
    }
  },
  required: [
    "grader_provider",
    "call_id",
    "lead_id",
    "rep_id",
    "rep_name",
    "direction",
    "status",
    "activity_at",
    "date_created",
    "duration_seconds",
    "duration_minutes",
    "transcript_utterances",
    "lead_segment",
    "call_type",
    "outcome_type",
    "outcome_rationale",
    "focus_dimension",
    "scores",
    "overall_score",
    "top_strength",
    "biggest_coaching_opportunity",
    "next_call_focus",
    "coachable_moment",
    "manager_coaching_note",
    "manager_action",
    "success_pattern",
    "rep_practice_drill",
    "compliance_flags",
    "evidence_summary"
  ]
};

function projectPath(...segments) {
  return path.join(/* turbopackIgnore: true */ process.cwd(), ...segments);
}

function readText(...segments) {
  return fs.readFileSync(projectPath(...segments), "utf8");
}

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDimension(value, scores) {
  const normalized = normalizeLabel(value);
  const aliases = {
    solution: "solution_to_pain",
    solution_mapping: "solution_to_pain",
    solution_to_pain: "solution_to_pain",
    feature_dump: "feature_dump_control",
    feature_dumping: "feature_dump_control",
    feature_dump_control: "feature_dump_control",
    close: "close_or_next_step",
    closing: "close_or_next_step",
    next_step: "close_or_next_step",
    close_or_next_step: "close_or_next_step"
  };
  const key = aliases[normalized] || normalized;
  if (RUBRIC_KEYS.includes(key)) return key;
  return chooseCoachingFocus(scores).primaryDimension;
}

function normalizeLeadSegment(value) {
  const normalized = normalizeLabel(value);
  if (/contractor.*b|dealer.*fee|direct.*lender|synchrony|greensky|goodleap|service.*finance/.test(normalized)) {
    return SEGMENT_LABELS.contractor_b_dealer_fee;
  }
  if (/contractor.*a|no.*financing|new.*financing|no_financing/.test(normalized)) {
    return SEGMENT_LABELS.contractor_a_no_financing;
  }
  if (/poor|bad_fit|emergency|same_day|solar|heavy.*buydown|commercial_only|custom_home/.test(normalized)) {
    return SEGMENT_LABELS.poor_fit;
  }
  if (/partner|retailer|product|adjacent|reactivation|existing_customer|non_contractor/.test(normalized)) {
    return SEGMENT_LABELS.adjacent;
  }
  return SEGMENT_LABELS.unknown;
}

function normalizeEnum(value, allowed, fallback = "unknown") {
  const normalized = normalizeLabel(value);
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeScorecardFields(scorecard) {
  const focus = chooseCoachingFocus(scorecard.scores || {}, scorecard.compliance_flags || [], 1);
  const focusDimension = normalizeDimension(scorecard.focus_dimension || scorecard.biggest_coaching_opportunity, scorecard.scores || {});
  scorecard.focus_dimension = focusDimension;
  scorecard.biggest_coaching_opportunity = THEMES[focusDimension] || focus.headline;
  scorecard.lead_segment = normalizeLeadSegment(scorecard.lead_segment);
  scorecard.call_type = normalizeEnum(scorecard.call_type, CALL_TYPES);
  scorecard.outcome_type = normalizeEnum(scorecard.outcome_type, OUTCOME_TYPES);
  if (!scorecard.next_call_focus || scorecard.next_call_focus.length < 30) {
    scorecard.next_call_focus = focus.behavior;
  }
  return scorecard;
}

function getGroundingContext() {
  const methodology = readJson(projectPath("config", "methodology.decoded.json"));
  const profile = readJson(projectPath("config", "companies", "enhancify.json"));
  const rubric = readText("prompts", "grading", "call-scorecard.md");
  const liveCallPrompt = readText("prompts", "live-call-coach.md");

  return [
    "# Decoded Methodology",
    JSON.stringify(methodology, null, 2),
    "# Enhancify Company Profile",
    JSON.stringify(profile, null, 2),
    "# Live-Call Coaching Prompt",
    liveCallPrompt,
    "# Grading Rubric",
    rubric
  ].join("\n\n");
}

function callMetadata(call) {
  return {
    call_id: call.id || "",
    lead_id: call.lead_id || "",
    rep_id: call.user_id || "",
    rep_name: call.user_name || "Unknown Rep",
    direction: call.direction || "unknown",
    status: call.status || "unknown",
    activity_at: call.activity_at || "",
    date_created: call.date_created || "",
    duration_seconds: call.duration_seconds || 0,
    duration_minutes: Math.round(((call.duration_seconds || 0) / 60) * 10) / 10,
    transcript_utterances: call.recording_transcript?.utterances?.length || 0,
    call_summary: call.recording_transcript?.summary_text || ""
  };
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const text = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") text.push(content.text);
    }
  }
  return text.join("\n");
}

function validateScorecard(scorecard, call, providerName = "openai") {
  for (const key of RUBRIC_KEYS) {
    const score = scorecard.scores?.[key];
    if (!Number.isFinite(score) || score < 1 || score > 10) {
      throw new Error(`${providerName} grader returned invalid ${key} score for call ${call.id}`);
    }
  }

  scorecard.grader_provider = providerName;
  scorecard.call_id = scorecard.call_id || call.id || "";
  scorecard.lead_id = scorecard.lead_id || call.lead_id || "";
  scorecard.rep_id = scorecard.rep_id || call.user_id || "";
  scorecard.rep_name = scorecard.rep_name || call.user_name || "Unknown Rep";
  scorecard.direction = scorecard.direction || call.direction || "unknown";
  scorecard.status = scorecard.status || call.status || "unknown";
  scorecard.activity_at = scorecard.activity_at || call.activity_at || "";
  scorecard.date_created = scorecard.date_created || call.date_created || "";
  scorecard.duration_seconds = scorecard.duration_seconds || call.duration_seconds || 0;
  scorecard.duration_minutes = scorecard.duration_minutes || Math.round(((call.duration_seconds || 0) / 60) * 10) / 10;
  scorecard.transcript_utterances = scorecard.transcript_utterances || call.recording_transcript?.utterances?.length || 0;
  scorecard.overall_score = Math.round((average(Object.values(scorecard.scores)) || 0) * 10) / 10;

  return normalizeScorecardFields(scorecard);
}

async function scoreOpenAi(call) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for call grading. Add it to .env or set COACH_GRADER_PROVIDER=heuristic only for pipeline smoke tests.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const metadata = callMetadata(call);
  const transcript = transcriptText(call, Number(process.env.COACH_TRANSCRIPT_MAX_CHARS || 28000));
  const input = [
    {
      role: "system",
      content: [
        {
          type: "input_text",
          text: [
            "You are the Decoded Coach grading engine for Enhancify sales calls.",
            "Use the provided Decoded methodology and Enhancify knowledge base as the source of truth.",
            "Grade coaching behavior, not just keyword presence.",
            "Return one focused coaching opportunity with one specific coachable moment from the call.",
            "Classify call_type and outcome_type. Grade against the right call type; do not grade payment-close calls like first discovery calls.",
            "Closed-won outcomes do not erase weak process. Identify if the rep won despite weak process, advanced with risk, or lost/no-decided because pain was not established.",
            "Extract one success pattern worth reinforcing, not only one weakness.",
            "Give a manager action with what to listen for, which call to review, roleplay, metric to move, and what to ignore for now.",
            "Generic advice is a failure. Include the actual behavior pattern and a better sentence the rep could use next time.",
            "Do not include raw transcript excerpts or personally sensitive customer details."
          ].join("\n")
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            getGroundingContext(),
            "# Call Metadata",
            JSON.stringify(metadata, null, 2),
            "# Transcript",
            transcript
          ].join("\n\n")
        }
      ]
    }
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input,
      text: {
        format: {
          type: "json_schema",
          name: "enhancify_call_scorecard",
          strict: true,
          schema: SCORECARD_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI grader request failed (${response.status}): ${body.slice(0, 1000)}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error(`OpenAI grader returned no output text for call ${call.id}`);

  return validateScorecard(JSON.parse(outputText), call, "openai");
}

function extractChatContent(response) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .join("\n");
  }
  return "";
}

async function scoreOpenRouter(call) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is required for OpenRouter grading. Add it to .env, then rerun this command.");
  }

  const model = process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
  const metadata = callMetadata(call);
  const transcript = transcriptText(call, Number(process.env.COACH_TRANSCRIPT_MAX_CHARS || 28000));
  const systemPrompt = [
    "You are the Decoded Coach grading engine for Enhancify sales calls.",
    "Use the provided Decoded methodology and Enhancify knowledge base as the source of truth.",
    "Grade coaching behavior, not just keyword presence.",
    "Return one focused coaching opportunity with one specific coachable moment from the call.",
    "Classify call_type and outcome_type. Grade against the right call type; do not grade payment-close calls like first discovery calls.",
    "Closed-won outcomes do not erase weak process. Identify if the rep won despite weak process, advanced with risk, or lost/no-decided because pain was not established.",
    "Extract one success pattern worth reinforcing, not only one weakness.",
    "Give a manager action with what to listen for, which call to review, roleplay, metric to move, and what to ignore for now.",
    "Generic advice is a failure. Include the actual behavior pattern and a better sentence the rep could use next time.",
    "Do not include raw transcript excerpts or personally sensitive customer details."
  ].join("\n");
  const userPrompt = [
    getGroundingContext(),
    "# Call Metadata",
    JSON.stringify(metadata, null, 2),
    "# Transcript",
    transcript
  ].join("\n\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Experimental-Metadata": "enabled"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: Number(process.env.OPENROUTER_MAX_TOKENS || 3200),
      provider: {
        require_parameters: true
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "enhancify_call_scorecard",
          strict: true,
          schema: SCORECARD_SCHEMA
        }
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter grader request failed (${response.status}): ${body.slice(0, 1000)}`);
  }

  const payload = await response.json();
  const outputText = extractChatContent(payload);
  if (!outputText) throw new Error(`OpenRouter grader returned no output text for call ${call.id}`);

  const scorecard = validateScorecard(JSON.parse(outputText), call, "openrouter");
  scorecard.grader_model = payload.model || model;
  scorecard.openrouter_generation_id = payload.id || null;
  return scorecard;
}

// Kept only for explicit smoke tests. This is not the default coaching grader.
function scoreHeuristic(call) {
  const text = transcriptText(call).toLowerCase();
  const scores = {
    opening: clampScore(5 + (/\?/.test(text) ? 1 : 0)),
    qualification: clampScore(4 + (/dealer fee|no financing|average job|job size/.test(text) ? 3 : 0)),
    discovery: clampScore(4 + (/current|goal|problem|what happens|why now/.test(text) ? 2 : 0)),
    quantification: clampScore(3 + (/out of|how many|how often|\$|percent|%|per month/.test(text) ? 3 : 0)),
    solution_to_pain: clampScore(4 + (/because|so for you|that means|based on/.test(text) ? 2 : 0)),
    feature_dump_control: 6,
    close_or_next_step: clampScore(4 + (/next step|follow up|calendar|payment|get started|move forward/.test(text) ? 3 : 0)),
    compliance: clampScore(6 + (/not a lender|marketplace|soft pull|hard inquiry|customer receives/.test(text) ? 2 : 0))
  };
  const weakest = Object.entries(scores).sort((a, b) => a[1] - b[1])[0][0];
  const strongest = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  return {
    grader_provider: "heuristic_smoke_test_only",
    ...callMetadata(call),
    lead_segment: "heuristic_unclassified",
    scores,
    overall_score: Math.round((average(Object.values(scores)) || 0) * 10) / 10,
    top_strength: THEMES[strongest],
    biggest_coaching_opportunity: THEMES[weakest],
    next_call_focus: THEMES[weakest],
    compliance_flags: [],
    evidence_summary: {
      rep_talk_ratio: null,
      contact_talk_seconds: 0,
      rep_talk_seconds: 0,
      detected_topics: [],
      concise_call_readout: "Heuristic smoke-test scorecard. Do not use as coaching truth."
    }
  };
}

export async function gradeCall(call, { provider = process.env.COACH_GRADER_PROVIDER || "openai" } = {}) {
  if (provider === "heuristic") return scoreHeuristic(call);
  if (provider === "openrouter") return scoreOpenRouter(call);
  if (provider !== "openai") throw new Error(`Unsupported grader provider: ${provider}`);
  return scoreOpenAi(call);
}

export { RUBRIC_KEYS, THEMES, NEXT_BEHAVIORS, chooseCoachingFocus };
