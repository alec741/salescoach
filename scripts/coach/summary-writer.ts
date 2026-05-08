const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    markdown: { type: "string" },
    primary_focus_dimension: { type: "string" },
    primary_focus: { type: "string" },
    next_call_focus: { type: "string" },
    focus_rationale: { type: "string" },
    manager_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rep_name: { type: "string" },
          listen_for: { type: "string" },
          call_to_review: { type: "string" },
          roleplay: { type: "string" },
          metric_to_move: { type: "string" },
          ignore_for_now: { type: "string" }
        },
        required: ["rep_name", "listen_for", "call_to_review", "roleplay", "metric_to_move", "ignore_for_now"]
      }
    },
    success_patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rep_name: { type: "string" },
          pattern: { type: "string" },
          when_to_reuse: { type: "string" },
          shareable_talk_track: { type: "string" }
        },
        required: ["rep_name", "pattern", "when_to_reuse", "shareable_talk_track"]
      }
    },
    progress_memory: {
      type: "object",
      additionalProperties: false,
      properties: {
        compared_to_previous: { type: "string" },
        repeated_issue: { type: "string" },
        improved_area: { type: "string" },
        regression_watchout: { type: "string" },
        new_issue: { type: "string" }
      },
      required: ["compared_to_previous", "repeated_issue", "improved_area", "regression_watchout", "new_issue"]
    }
  },
  required: [
    "markdown",
    "primary_focus_dimension",
    "primary_focus",
    "next_call_focus",
    "focus_rationale",
    "manager_actions",
    "success_patterns",
    "progress_memory"
  ]
};

type SummaryInput = {
  audience: "rep" | "manager";
  periodType: string;
  periodStart: string;
  periodEnd: string;
  repName?: string | null;
  aggregate: Record<string, unknown>;
  previousContext?: Record<string, unknown> | null;
  scorecards: Array<Record<string, unknown>>;
};

type ChatResponse = {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<string | { type?: string; text?: string }>;
    };
  }>;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function extractChatContent(response: ChatResponse) {
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

function parseJsonOutput(outputText: string) {
  const trimmed = outputText.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return JSON.parse(fenced[1].trim());
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw error;
  }
}

function compactScorecard(row: Record<string, unknown>) {
  const evidence = (row.evidenceSummaryJson && typeof row.evidenceSummaryJson === "object"
    ? row.evidenceSummaryJson
    : {}) as Record<string, unknown>;
  return {
    call_id: row.closeCallId,
    activity_at: row.activityAt,
    duration_seconds: row.durationSeconds,
    overall_score: Number(row.overallScore),
    scores: {
      opening: Number(row.opening),
      qualification: Number(row.qualification),
      discovery: Number(row.discovery),
      quantification: Number(row.quantification),
      solution_to_pain: Number(row.solutionToPain),
      feature_dump_control: Number(row.featureDumpControl),
      close_or_next_step: Number(row.closeOrNextStep),
      compliance: Number(row.compliance)
    },
    lead_segment: row.leadSegment,
    top_strength: row.topStrength,
    coaching_opportunity: row.biggestCoachingOpportunity,
    next_call_focus: row.nextCallFocus,
    coachable_moment: evidence.coachable_moment || row.coachableMoment || null,
    manager_coaching_note: evidence.manager_coaching_note || null,
    manager_action: evidence.manager_action || null,
    success_pattern: evidence.success_pattern || null,
    call_type: evidence.call_type || null,
    outcome_type: evidence.outcome_type || null,
    outcome_rationale: evidence.outcome_rationale || null,
    rep_practice_drill: evidence.rep_practice_drill || null,
    concise_call_readout: evidence.concise_call_readout || ""
  };
}

function buildPrompt(input: SummaryInput) {
  const audience = input.audience === "manager" ? "sales manager" : "individual sales rep";
  const minimumWords = input.audience === "manager" ? 900 : input.periodType === "daily" ? 600 : 800;
  return [
    `You are writing a world-class ${input.periodType} coaching report for an Enhancify ${audience}.`,
    "",
    "Standards:",
    "- Be specific to the rep and the calls in this period.",
    "- Use concrete call examples, but paraphrase. Do not quote raw transcript or include sensitive customer details.",
    "- Identify the one highest-leverage coaching focus, not a laundry list.",
    "- Tie the focus to Decoded selling leverage: qualification, quantification, discovery, solution-to-pain, close control, feature-dump control, compliance.",
    "- Generic advice like 'ask better questions' is not acceptable.",
    "- Include exact alternative talk track language the rep can use tomorrow.",
    "- Use outcome awareness: separate won despite weak process, lost because of weak process, advanced with risk, disqualified correctly, and no-decision due to missing pain.",
    "- Use call-type awareness: evaluate first calls, follow-ups, payment closes, no-show recoveries, partner follow-ups, post-close handoffs, nurtures, and disqualifications differently.",
    "- For manager reports, give each rep a short snapshot with score pattern, focus, examples, compliance watchouts, and the manager's coaching move.",
    "- Manager reports must include: what to listen for tomorrow, which call pattern to review, what roleplay to run, one metric to move, and what to ignore for now.",
    "- Extract success patterns: what each rep does that works, when it works, and any shareable talk track/pattern for the team.",
    "- Use trend/progress memory from previous_context when present: whether the rep improved, repeated the issue, regressed, or developed a new issue.",
    "- For rep reports, write directly to the rep in practical language.",
    `- Minimum useful depth: write at least ${minimumWords} words in markdown unless there are zero calls.`,
    "- Required report sections: focus, evidence from specific calls, what to do differently, exact talk track or roleplay, compliance/watchouts, and next-period success metric.",
    "",
    "Return JSON with a markdown field and the focus metadata.",
    "",
    "# Context",
    JSON.stringify({
      audience: input.audience,
      period_type: input.periodType,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      rep_name: input.repName || null,
      aggregate: input.aggregate,
      previous_context: input.previousContext || null,
      scorecards: input.scorecards.map(compactScorecard)
    }, null, 2)
  ].join("\n");
}

function minimumMarkdownLength(input: SummaryInput) {
  if (input.audience === "manager") return 3200;
  if (input.periodType === "daily") return input.scorecards.length <= 1 ? 1800 : 2500;
  return 3200;
}

function assertUsefulSummary(input: SummaryInput, parsed: Record<string, unknown>) {
  const markdown = typeof parsed.markdown === "string" ? parsed.markdown.trim() : "";
  if (markdown.length < minimumMarkdownLength(input)) {
    throw new Error(
      `LLM summary was too thin (${markdown.length} chars) for ${input.periodType} ${input.repName || input.audience}`
    );
  }

  const requiredPatterns = [
    /focus/i,
    /call|prospect|contractor|customer|lead/i,
    /talk track|roleplay|ask|say|do differently/i,
    /compliance|watchout|risk|metric|score/i
  ];
  const missing = requiredPatterns.filter((pattern) => !pattern.test(markdown));
  if (missing.length) {
    throw new Error(`LLM summary missing required coaching sections for ${input.periodType} ${input.repName || input.audience}`);
  }
}

export async function writeCoachingSummary(input: SummaryInput) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for LLM coaching summaries.");

  const model = process.env.OPENROUTER_SUMMARY_MODEL || process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
  const maxAttempts = parsePositiveInt(process.env.OPENROUTER_SUMMARY_RETRIES, 3);
  const timeoutMs = parsePositiveInt(process.env.OPENROUTER_SUMMARY_TIMEOUT_MS, 300000);
  const baseMaxTokens = parsePositiveInt(process.env.OPENROUTER_SUMMARY_MAX_TOKENS, 8000);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content: "You are Decoded Coach's senior sales coach. Your job is high-utility coaching, not generic summarization."
            },
            { role: "user", content: buildPrompt(input) }
          ],
          temperature: attempt === 1 ? 0.25 : 0.1,
          max_tokens: baseMaxTokens + (attempt - 1) * 1500,
          provider: { require_parameters: true },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "enhancify_period_coaching_summary",
              strict: true,
              schema: SUMMARY_SCHEMA
            }
          }
        })
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenRouter summary request failed (${response.status}): ${body.slice(0, 1000)}`);
      }

      const payload = (await response.json()) as ChatResponse;
      const outputText = extractChatContent(payload);
      if (!outputText) throw new Error("OpenRouter summary returned no output text.");
      const parsed = parseJsonOutput(outputText);
      assertUsefulSummary(input, parsed);
      return { ...parsed, model: payload.model || model };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.warn(
          `OpenRouter summary attempt ${attempt}/${maxAttempts} failed for ${input.periodType} ${input.periodStart} ${input.repName || input.audience}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
