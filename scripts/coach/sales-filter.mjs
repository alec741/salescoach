import path from "node:path";
import { API_BASE, ROOT, closeFetch, ensureDir, readJson, writeJson } from "./shared.mjs";

const DEFAULT_CONFIG_PATH = path.join(ROOT, "config", "sales-filter.json");
const LEAD_CACHE_PATH = path.join(ROOT, "data", "coach", "lead-cache.json");

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

export async function getLead(leadId, apiKey) {
  if (!leadId) return null;
  const cache = getCache();
  if (cache[leadId]) return cache[leadId];

  const lead = await closeFetch(new URL(`${API_BASE}/lead/${leadId}/`), apiKey);
  const compact = compactLead(lead);
  cache[leadId] = compact;
  saveCache(cache);
  return compact;
}

function compactLead(lead) {
  return {
    id: lead.id,
    name: lead.name || null,
    status_id: lead.status_id || null,
    status_label: lead.status_label || null,
    opportunities: (lead.opportunities || []).map((opportunity) => ({
      id: opportunity.id,
      status_id: opportunity.status_id || null,
      status_label: opportunity.status_label || null,
      status_type: opportunity.status_type || null,
      pipeline_id: opportunity.pipeline_id || null,
      pipeline_name: opportunity.pipeline_name || null,
      value: opportunity.value || 0,
      value_period: opportunity.value_period || null
    })),
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

    const lead = await getLead(call.lead_id, apiKey);
    const decision = isSalesLead(lead, config);
    if (decision.include || includeUsers.has(call.user_id)) {
      output.push({ ...call, sales_filter: { include: true, reason: decision.reason, lead } });
    } else {
      excluded.push({ call, reason: decision.reason, lead });
    }
  }

  if (explain) return { included: output, excluded };
  return output;
}
