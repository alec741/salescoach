import fs from "node:fs";
import path from "node:path";

const CLOSE_API_BASE = "https://api.close.com/api/v1";
const DEFAULT_SCORECARDS = "data/coach/codex-review/2026-05-06-over-10min/codex-scorecards.jsonl";
const DEFAULT_CALLS = "data/close/backfill-2026-04-08_to_2026-05-07.jsonl";
const LEAD_CACHE = "data/coach/lead-cache.json";

function loadDotEnv(filePath = ".env") {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {
    scorecards: DEFAULT_SCORECARDS,
    calls: DEFAULT_CALLS,
    callId: null,
    index: 0
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--scorecards") {
      args.scorecards = next;
      index += 1;
    } else if (arg === "--calls") {
      args.calls = next;
      index += 1;
    } else if (arg === "--call-id") {
      args.callId = next;
      index += 1;
    } else if (arg === "--index") {
      args.index = Number(next);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function titleCase(value) {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function authHeader(apiKey) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
}

async function closeFetch(pathname, apiKey) {
  if (!apiKey) return null;
  const response = await fetch(new URL(pathname, CLOSE_API_BASE), {
    headers: {
      Authorization: authHeader(apiKey),
      Accept: "application/json"
    }
  });
  if (!response.ok) return null;
  return response.json();
}

function compactLead(lead) {
  if (!lead) return null;
  return {
    id: lead.id,
    name: lead.name || null,
    status_label: lead.status_label || null,
    opportunities: (lead.opportunities || []).map((opportunity) => ({
      id: opportunity.id,
      status_label: opportunity.status_label || null,
      status_type: opportunity.status_type || null,
      pipeline_name: opportunity.pipeline_name || null,
      value: opportunity.value || 0,
      value_period: opportunity.value_period || null
    })),
    custom: lead.custom || {}
  };
}

async function getLead(leadId, apiKey) {
  if (!leadId) return null;
  const cache = readJson(LEAD_CACHE, {});
  if (cache[leadId]) return cache[leadId];
  const lead = compactLead(await closeFetch(`/lead/${leadId}/`, apiKey));
  if (!lead) return null;
  cache[leadId] = lead;
  fs.mkdirSync(path.dirname(LEAD_CACHE), { recursive: true });
  fs.writeFileSync(LEAD_CACHE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  return lead;
}

async function getContact(contactId, apiKey) {
  if (!contactId) return null;
  return closeFetch(`/contact/${contactId}/`, apiKey);
}

function closeLeadUrl(leadId) {
  return leadId ? `https://app.close.com/lead/${leadId}/` : null;
}

function closeOpportunityUrl(leadId, opportunityId) {
  return leadId && opportunityId ? `https://app.close.com/lead/${leadId}/?opportunity_id=${opportunityId}` : null;
}

function closeCallUrl(leadId, callId) {
  return leadId && callId ? `https://app.close.com/lead/${leadId}/?activity_id=${callId}` : null;
}

function formatTimestamp(seconds) {
  const value = Number(seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.floor(value % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function weakestScoreLines(scores) {
  return Object.entries(scores || {})
    .sort(([, a], [, b]) => Number(a) - Number(b))
    .slice(0, 3)
    .map(([key, value]) => `*${titleCase(key)}:* ${Number(value).toFixed(1)} - ${dimensionImplication(key)}`)
    .join("\n");
}

function dimensionImplication(key) {
  const implications = {
    opening: "Opening structure needs tightening.",
    qualification: "Buyer fit or decision criteria were not fully confirmed.",
    discovery: "Pain, context, or decision process was not explored deeply enough.",
    quantification: "Economic impact, cash gap, timeline, or ROI was not fully sized.",
    solution_to_pain: "Solution was not tied tightly enough to the buyer's stated pain.",
    feature_dump_control: "Explanation came before discovery was complete.",
    close_or_next_step: "Next step or buyer commitment needed more precision.",
    compliance: "Process adherence or required talk-track elements need review."
  };
  return implications[key] || "Review this behavior in the scorecard.";
}

function scoreEmoji(score) {
  if (score < 5.5) return ":red_circle:";
  if (score < 7) return ":large_orange_circle:";
  return ":large_green_circle:";
}

function riskLabel(score, flagCount) {
  if (flagCount > 0 || score < 5.5) return "Manager review needed";
  if (score < 7) return "Coaching opportunity";
  return "Positive example";
}

function behaviorLabel(scorecard) {
  const focus = scorecard.focus_dimension || scorecard.primary_focus_dimension;
  if (focus === "quantification" || Number(scorecard.scores?.quantification || 0) <= 4.5) return "Premature solutioning";
  if (focus === "compliance" || Number(scorecard.scores?.compliance || 0) <= 5) return "Compliance talk-track risk";
  if (focus === "discovery") return "Shallow discovery";
  if (focus === "qualification") return "Incomplete qualification";
  return titleCase(focus || scorecard.next_call_focus || "Coaching opportunity");
}

function coachingPriority(scorecard) {
  const behavior = behaviorLabel(scorecard);
  if (behavior === "Premature solutioning") return "Quantify the buyer's economic pain before explaining financing options.";
  if (behavior === "Compliance talk-track risk") return "Use approved financing language before discussing approval, rates, funding, or customer expectations.";
  return scorecard.next_call_focus || "Coach the rep on the next highest-impact behavior from this call.";
}

function behaviorChecklist(scorecard) {
  if (behaviorLabel(scorecard) === "Premature solutioning") {
    return [
      "What is the project amount?",
      "How much cash is the homeowner short?",
      "Is financing the difference between winning and losing the job?",
      "What is the timeline?",
      "What does losing this job cost you?"
    ];
  }
  return [scorecard.next_call_focus || "Confirm the next buyer behavior before moving forward."];
}

function truncate(value, limit = 280) {
  const text = String(value || "").trim();
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function findEvidenceMoments(call) {
  const utterances = call?.recording_transcript?.utterances || [];
  const moments = [
    {
      label: "Pain surfaced",
      pattern: /clients are asking for financing|looking into customer financing|projects are those|more than 200/i
    },
    {
      label: "Premature product/rate talk",
      pattern: /best rates|zero interest|6\.74|550 credit|three different plans|1749|5000|1249/i
    },
    {
      label: "Missed quantification follow-up",
      pattern: /credit score|annual income|how much money|upwards of 200,000|chances of.*approval/i
    }
  ];

  const used = new Set();
  return moments
    .map((moment) => {
      const utterance = utterances.find((item, index) => !used.has(index) && moment.pattern.test(item.text || ""));
      if (!utterance) return null;
      const index = utterances.indexOf(utterance);
      used.add(index);
      return {
        label: moment.label,
        timestamp: formatTimestamp(utterance.start),
        speaker: utterance.speaker_label || "Speaker",
        text: truncate(utterance.text, 190)
      };
    })
    .filter(Boolean);
}

function fallbackProspectName(contact, call) {
  const direct = contact?.name || [contact?.first_name, contact?.last_name].filter(Boolean).join(" ");
  if (direct) return direct;
  const contactUtterance = (call?.recording_transcript?.utterances || []).find((utterance) => utterance.speaker_side === "contact" && utterance.speaker_label);
  return contactUtterance?.speaker_label || "Unknown prospect";
}

function buildManagerBlocks({ scorecard, call, lead, contact }) {
  const opportunity = (lead?.opportunities || []).find((item) => item.pipeline_name === "Sales") || lead?.opportunities?.[0] || null;
  const companyName = lead?.custom?.["Company Name"] || lead?.name || "Unknown company";
  const prospectName = fallbackProspectName(contact, call);
  const opportunityStage = opportunity?.status_label || "No opportunity found";
  const flags = Array.isArray(scorecard.compliance_flags) && scorecard.compliance_flags.length
    ? scorecard.compliance_flags.map((flag) => `- ${flag}`).join("\n")
    : "No compliance flags.";
  const lowest = weakestScoreLines(scorecard.scores);
  const overall = Number(scorecard.overall_score || 0);
  const durationMinutes = Number(scorecard.duration_minutes || call?.duration_seconds / 60 || 0).toFixed(1);
  const flagCount = Array.isArray(scorecard.compliance_flags) ? scorecard.compliance_flags.length : 0;
  const risk = riskLabel(overall, flagCount);
  const behavior = behaviorLabel(scorecard);
  const priority = coachingPriority(scorecard);
  const leadUrl = closeLeadUrl(scorecard.lead_id);
  const callUrl = closeCallUrl(scorecard.lead_id, scorecard.call_id);
  const opportunityUrl = closeOpportunityUrl(scorecard.lead_id, opportunity?.id);
  const evidenceMoments = findEvidenceMoments(call);
  const firstEvidenceMoment = evidenceMoments[0];
  const managerPrompt =
    firstEvidenceMoment?.label === "Pain surfaced"
      ? `Ask ${scorecard.rep_name}: "At ${firstEvidenceMoment.timestamp}, the buyer gave you a pain signal. What two money questions should you ask before explaining options?"`
      : `Ask ${scorecard.rep_name}: "Where should you have quantified project amount, cash gap, timeline, or lost-job cost before discussing plan options?"`;
  const momentsText = evidenceMoments.length
    ? evidenceMoments
        .slice(0, 2)
        .map((moment) => `*${moment.timestamp}* - ${moment.label}: ${truncate(moment.text, 120)}`)
        .join("\n")
    : "No timestamped moments were available from the local transcript.";
  const actionText = `1. Replay *${firstEvidenceMoment?.timestamp || "the strongest moment"}*.
2. Ask: "${managerPrompt.replace(/^Ask [^:]+:\s*/, "")}"
3. Have ${scorecard.rep_name} write the next 3 questions before plans, rates, or approval probability.`;
  const checklistInline = behaviorChecklist(scorecard).join(" | ");

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${scoreEmoji(overall)} ${scorecard.rep_name} | ${companyName} | ${prospectName} | ${durationMinutes} min`,
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${overall.toFixed(1)}/10* | *${risk}* | *${opportunityStage}*\n*:dart: Priority:* ${priority}\n*:warning: Issue:* ${behavior}`
      }
    },
    { type: "divider" },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:rotating_light: Manager action*\n${actionText}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:mag: Diagnosis*\n${truncate(scorecard.concise_call_readout || scorecard.evidence_summary?.concise_call_readout, 300)}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:white_check_mark: Coach this next*\nBefore explaining options, confirm: ${checklistInline}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:headphones: Call moments*\n${momentsText}`
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:bar_chart: Evidence*\n${lowest}\n*Strength:* ${truncate(scorecard.top_strength, 140)}`
      }
    },
    ...(flagCount
      ? [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*:shield: Compliance watchouts*\n${truncate(flags, 300)}`
            }
          }
        ]
      : []),
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:bulb: Why it matters:* ${truncate(scorecard.biggest_coaching_opportunity, 220)}`
      }
    },
    {
      type: "actions",
      elements: [
        ...(callUrl ? [{ type: "button", text: { type: "plain_text", text: "Open call in Close" }, url: callUrl, style: "primary" }] : []),
        ...(leadUrl ? [{ type: "button", text: { type: "plain_text", text: "Open lead" }, url: leadUrl }] : []),
        ...(opportunityUrl ? [{ type: "button", text: { type: "plain_text", text: "Open opportunity" }, url: opportunityUrl }] : [])
      ]
    }
  ];

  return {
    text: `Call coaching brief for ${scorecard.rep_name}: ${companyName}, ${overall.toFixed(1)}/10. Priority: ${priority}`,
    blocks
  };
}

async function postSlackMessage({ channel, text, blocks }) {
  const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_ACCESS_TOKEN;
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({ channel, text, blocks })
  });
  return response.json();
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.CLOSE_API_KEY;
  const channel = process.env.SLACK_MANAGER_CHANNEL_ID;
  if (!process.env.SLACK_BOT_TOKEN && !process.env.SLACK_ACCESS_TOKEN) throw new Error("Missing SLACK_BOT_TOKEN or SLACK_ACCESS_TOKEN.");
  if (!channel) throw new Error("Missing SLACK_MANAGER_CHANNEL_ID.");

  const scorecards = readJsonl(args.scorecards);
  const scorecard = args.callId ? scorecards.find((item) => item.call_id === args.callId) : scorecards[args.index];
  if (!scorecard) throw new Error("No scorecard found for the requested call.");

  const calls = readJsonl(args.calls);
  const call = calls.find((item) => item.id === scorecard.call_id) || null;
  const contactId = call?.contact_id || scorecard.contact_id || null;
  const [lead, contact] = await Promise.all([getLead(scorecard.lead_id, apiKey), getContact(contactId, apiKey)]);
  const message = buildManagerBlocks({ scorecard, call, lead, contact });
  const result = await postSlackMessage({ channel, ...message });
  if (!result.ok) throw new Error(`Slack post failed: ${result.error || "unknown_error"}`);
  console.log(`Manager call report sent: ts=${result.ts}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
