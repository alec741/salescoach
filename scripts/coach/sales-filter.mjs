import path from "node:path";
import { API_BASE, ROOT, closeFetch, ensureDir, readJson, writeJson } from "./shared.mjs";

const DEFAULT_CONFIG_PATH = path.join(ROOT, "config", "sales-filter.json");
const LEAD_CACHE_PATH = path.join(ROOT, "data", "coach", "lead-cache.json");
const LEAD_FIELDS = [
  "id",
  "name",
  "status_id",
  "status_label",
  "custom",
  "opportunities"
];

export function loadSalesFilterConfig() {
  return readJson(DEFAULT_CONFIG_PATH, {
    mode: "exclude_clients_default_include",
    excludeLeadStatuses: ["Client", "DO NOT CONTACT"],
    excludeCustomFieldValues: [
      { field: "Customer type", values: ["Client"] },
      { field: "Lead type", values: ["Client"] },
      { field: "Customer Data", values: ["Client"] },
      { field: "Customer data", values: ["Client"] }
    ],
    trackedCustomFields: ["Customer type", "Lead type", "Customer Data", "Customer data"],
    excludeRepUserIds: [],
    includeRepUserIds: [],
    includeRepNameMatches: [],
    excludeRepNameMatches: [],
    strictRequireSalesPipeline: false,
    strictRequireCustomerType: false,
    includePipelineNames: ["Sales"],
    includeCustomerTypes: ["Contractor"]
  });
}

function getCache() {
  return readJson(LEAD_CACHE_PATH, {});
}

function saveCache(cache) {
  ensureDir(path.dirname(LEAD_CACHE_PATH));
  writeJson(LEAD_CACHE_PATH, cache);
}

export function createLeadCacheSession() {
  return {
    cache: getCache(),
    dirty: false,
    fetched: 0
  };
}

export function flushLeadCache(session) {
  if (!session?.dirty) return;
  saveCache(session.cache);
  session.dirty = false;
}

export async function getLead(leadId, apiKey, session = null) {
  if (!leadId) return null;
  const cache = session?.cache || getCache();
  if (cache[leadId]) return cache[leadId];

  const url = new URL(`${API_BASE}/lead/${leadId}/`);
  url.searchParams.set("_fields", LEAD_FIELDS.join(","));
  const lead = await closeFetch(url, apiKey);
  const compact = compactLead(lead);
  cache[leadId] = compact;
  if (session) {
    session.dirty = true;
    session.fetched += 1;
    if (session.fetched % 100 === 0) flushLeadCache(session);
  } else {
    saveCache(cache);
  }
  return compact;
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function closeSignalForOpportunity(opportunity) {
  if (opportunity.status_type === "won" || opportunity.date_won) return "won";
  if (opportunity.status_type === "lost" || opportunity.date_lost) return "lost";
  if (opportunity.status_type === "active") return "open";
  return "unknown";
}

export function normalizeCloseOpportunity(opportunity) {
  const statusType = asText(opportunity?.status_type);
  const dateWon = asText(opportunity?.date_won);
  const dateLost = asText(opportunity?.date_lost);
  const closeDate = dateWon || dateLost || asText(opportunity?.date_closed);
  const normalized = {
    id: opportunity?.id || null,
    lead_id: opportunity?.lead_id || null,
    contact_id: opportunity?.contact_id || null,
    user_id: opportunity?.user_id || null,
    user_name: opportunity?.user_name || null,
    status_id: opportunity?.status_id || null,
    status_label: opportunity?.status_label || null,
    status_display_name: opportunity?.status_display_name || null,
    status_type: statusType,
    pipeline_id: opportunity?.pipeline_id || null,
    pipeline_name: opportunity?.pipeline_name || null,
    value: asNumber(opportunity?.value),
    value_period: opportunity?.value_period || null,
    value_currency: opportunity?.value_currency || null,
    value_formatted: opportunity?.value_formatted || null,
    expected_value: asNumber(opportunity?.expected_value),
    annualized_value: asNumber(opportunity?.annualized_value),
    annualized_expected_value: asNumber(opportunity?.annualized_expected_value),
    confidence: asNumber(opportunity?.confidence),
    is_stalled: typeof opportunity?.is_stalled === "boolean" ? opportunity.is_stalled : null,
    date_created: asText(opportunity?.date_created),
    date_updated: asText(opportunity?.date_updated),
    date_won: dateWon,
    date_lost: dateLost,
    close_date: closeDate
  };

  const closeSignal = closeSignalForOpportunity(normalized);
  return {
    ...normalized,
    close_signal: closeSignal,
    is_closed: closeSignal === "won" || closeSignal === "lost",
    is_won: closeSignal === "won",
    is_lost: closeSignal === "lost"
  };
}

function opportunityPriority(opportunity, preferredPipelines = []) {
  const preferred = includesCaseInsensitive(preferredPipelines, opportunity.pipeline_name) ? 0 : 1;
  const statusRank = opportunity.status_type === "active"
    ? 0
    : opportunity.status_type === "won"
      ? 1
      : opportunity.status_type === "lost"
        ? 2
        : 3;
  const valueRank = -(opportunity.value ?? -1);
  const updatedAt = opportunity.date_updated || opportunity.close_date || opportunity.date_created || "";
  const updatedRank = -(Date.parse(updatedAt) || 0);
  return [preferred, statusRank, valueRank, updatedRank];
}

function compareOpportunityPriority(a, b, preferredPipelines = []) {
  const left = opportunityPriority(a, preferredPipelines);
  const right = opportunityPriority(b, preferredPipelines);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function summarizeCloseOpportunities(opportunities, { preferredPipelines = [] } = {}) {
  const normalized = (opportunities || []).map(normalizeCloseOpportunity);
  const sorted = [...normalized].sort((a, b) => compareOpportunityPriority(a, b, preferredPipelines));
  const primary = sorted[0] || null;
  const outcomeDates = normalized
    .map((opportunity) => opportunity.close_date || opportunity.date_updated || opportunity.date_created)
    .filter(Boolean)
    .sort()
    .reverse();

  return {
    total_opportunities: normalized.length,
    active_count: normalized.filter((opportunity) => opportunity.status_type === "active").length,
    won_count: normalized.filter((opportunity) => opportunity.is_won).length,
    lost_count: normalized.filter((opportunity) => opportunity.is_lost).length,
    has_active_opportunity: normalized.some((opportunity) => opportunity.status_type === "active"),
    has_won_opportunity: normalized.some((opportunity) => opportunity.is_won),
    has_lost_opportunity: normalized.some((opportunity) => opportunity.is_lost),
    total_value: normalized.reduce((sum, opportunity) => sum + (opportunity.value || 0), 0),
    total_expected_value: normalized.reduce((sum, opportunity) => sum + (opportunity.expected_value || 0), 0),
    total_annualized_value: normalized.reduce((sum, opportunity) => sum + (opportunity.annualized_value || 0), 0),
    latest_outcome_at: outcomeDates[0] || null,
    primary_opportunity: primary
      ? {
          id: primary.id,
          pipeline_name: primary.pipeline_name,
          status_label: primary.status_label,
          status_display_name: primary.status_display_name,
          status_type: primary.status_type,
          value: primary.value,
          value_formatted: primary.value_formatted,
          value_period: primary.value_period,
          value_currency: primary.value_currency,
          close_signal: primary.close_signal,
          close_date: primary.close_date,
          is_closed: primary.is_closed,
          is_won: primary.is_won,
          is_lost: primary.is_lost
        }
      : null
  };
}

export function buildCloseContext(lead, { preferredPipelines = [] } = {}) {
  if (!lead) return null;
  return {
    lead: {
      id: lead.id,
      name: lead.name || null,
      status_id: lead.status_id || null,
      status_label: lead.status_label || null
    },
    custom: lead.custom || {},
    opportunities: (lead.opportunities || []).map(normalizeCloseOpportunity),
    opportunity_summary: lead.opportunity_summary || summarizeCloseOpportunities(lead.opportunities || [], { preferredPipelines })
  };
}

export function compactLead(lead, config = loadSalesFilterConfig()) {
  const opportunities = (lead.opportunities || []).map(normalizeCloseOpportunity);
  return {
    id: lead.id,
    name: lead.name || null,
    status_id: lead.status_id || null,
    status_label: lead.status_label || null,
    opportunities,
    opportunity_summary: summarizeCloseOpportunities(opportunities, {
      preferredPipelines: config.includePipelineNames || []
    }),
    custom: pickCustom(lead.custom || {})
  };
}

function pickCustom(custom) {
  const config = loadSalesFilterConfig();
  const keys = [
    "Business type",
    "Company Name",
    "Contractor ID",
    "Contractor Type",
    "Contractor Type (from AI)",
    "Customer type",
    "Lead Owner",
    "Lead Source",
    "Lead Source Tier",
    "Lead first touch",
    "Lead type",
    "Offer Financing",
    "Original Lead Owner",
    "Payment Status Contractor",
    "Plan Tier",
    "Specialization",
    "Subscribe",
    "User ID LO",
    "sales_opportunity",
    ...(config.trackedCustomFields || [])
  ];
  return Object.fromEntries([...new Set(keys)].filter((key) => custom[key] !== undefined).map((key) => [key, custom[key]]));
}

function includesCaseInsensitive(list, value) {
  if (!value) return false;
  return list.map((item) => String(item).toLowerCase()).includes(String(value).toLowerCase());
}

function normalizeForMatch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesNameFragment(list, value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) return false;
  return (list || []).some((item) => normalized.includes(normalizeForMatch(item)));
}

function hasIncludedPipeline(lead, config) {
  return (lead.opportunities || []).some((opportunity) =>
    includesCaseInsensitive(config.includePipelineNames || [], opportunity.pipeline_name)
  );
}

export function isSalesLead(lead, config = loadSalesFilterConfig()) {
  if (!lead) return { include: false, reason: "missing_lead" };

  if (includesCaseInsensitive(config.excludeLeadStatuses || [], lead.status_label)) {
    return { include: false, reason: `excluded_lead_status:${lead.status_label}` };
  }

  for (const rule of config.excludeCustomFieldValues || []) {
    const value = lead.custom?.[rule.field];
    if (includesCaseInsensitive(rule.values || [], value)) {
      return { include: false, reason: `excluded_custom_field:${rule.field}:${value}` };
    }
  }

  if (config.strictRequireSalesPipeline && !hasIncludedPipeline(lead, config)) {
    return { include: false, reason: "strict_no_sales_pipeline_opportunity" };
  }

  const customerType = lead.custom?.["Customer type"];
  if (config.strictRequireCustomerType && (config.includeCustomerTypes || []).length && !includesCaseInsensitive(config.includeCustomerTypes, customerType)) {
    return { include: false, reason: `strict_customer_type_not_allowed:${customerType || "missing"}` };
  }

  const reasonParts = [];
  if (hasIncludedPipeline(lead, config)) reasonParts.push("sales_pipeline");
  if (customerType) reasonParts.push(`customer_type:${customerType}`);
  if (lead.custom?.["Lead Source Tier"]) reasonParts.push(`source_tier:${lead.custom["Lead Source Tier"]}`);
  if (lead.custom?.sales_opportunity) reasonParts.push(`sales_opportunity:${lead.custom.sales_opportunity}`);

  return { include: true, reason: reasonParts.length ? `not_client:${reasonParts.join("|")}` : "not_client" };
}

export async function filterSalesCalls(calls, { apiKey, config = loadSalesFilterConfig(), explain = false } = {}) {
  const output = [];
  const excluded = [];
  const leadCache = createLeadCacheSession();
  const includeUsers = new Set(config.includeRepUserIds || []);
  const excludeUsers = new Set(config.excludeRepUserIds || []);
  const includeRepNameMatches = config.includeRepNameMatches || [];
  const excludeRepNameMatches = config.excludeRepNameMatches || [];

  for (const call of calls) {
    if (excludeUsers.has(call.user_id)) {
      excluded.push({ call, reason: "excluded_rep_user_id" });
      continue;
    }

    if (matchesNameFragment(excludeRepNameMatches, call.user_name)) {
      excluded.push({ call, reason: "excluded_rep_name" });
      continue;
    }

    const isExplicitIncludedRep = includeUsers.has(call.user_id) || matchesNameFragment(includeRepNameMatches, call.user_name);
    if ((includeUsers.size || includeRepNameMatches.length) && !isExplicitIncludedRep) {
      excluded.push({ call, reason: "excluded_rep_not_in_sales_allowlist" });
      continue;
    }

    const lead = await getLead(call.lead_id, apiKey, leadCache);
    const decision = isSalesLead(lead, config);
    if (decision.include || includeUsers.has(call.user_id)) {
      output.push({ ...call, sales_filter: { include: true, reason: decision.reason, lead } });
    } else {
      excluded.push({ call, reason: decision.reason, lead });
    }
  }

  flushLeadCache(leadCache);
  if (explain) return { included: output, excluded };
  return output;
}
