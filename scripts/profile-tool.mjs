import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const companyDir = path.join(root, "config", "companies");
const defaultConfigPath = path.join(root, "config", "default.json");
const ENHANCED_REQUIRED_IDS = new Set(["enhancify"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listCompanyFiles() {
  if (!fs.existsSync(companyDir)) return [];
  return fs
    .readdirSync(companyDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.join(companyDir, file));
}

function requiredString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function requiredObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateOffer(offer, index, errors) {
  if (!requiredString(offer.id)) errors.push(`offers[${index}].id must be a non-empty string`);
  if (!requiredString(offer.name)) errors.push(`offers[${index}].name must be a non-empty string`);
  if (!requiredArray(offer.problemsSolved)) errors.push(`offers[${index}].problemsSolved must be a non-empty array`);
}

function validateEnhancedProfile(profile, errors) {
  for (const field of ["salesMotion", "callFlow", "qualificationSegments", "commercialModel", "complianceGuardrails", "sourceMetadata"]) {
    if (!requiredObject(profile[field]) && !requiredArray(profile[field])) {
      errors.push(`${field} is required for enhanced company profiles`);
    }
  }

  if (profile.salesMotion) {
    if (!requiredString(profile.salesMotion.leadSource)) errors.push("salesMotion.leadSource must be a non-empty string");
    if (!requiredString(profile.salesMotion.primaryChannel)) errors.push("salesMotion.primaryChannel must be a non-empty string");
    if (!requiredString(profile.salesMotion.averageContractValue)) errors.push("salesMotion.averageContractValue must be a non-empty string");
    if (!requiredString(profile.salesMotion.targetClosePattern)) errors.push("salesMotion.targetClosePattern must be a non-empty string");
    if (typeof profile.salesMotion.callTimeboxMinutes !== "number") errors.push("salesMotion.callTimeboxMinutes must be a number");
  }

  if (profile.callFlow) {
    if (!requiredArray(profile.callFlow.stages)) errors.push("callFlow.stages must be a non-empty array");
    if (!requiredArray(profile.callFlow.branchRules)) errors.push("callFlow.branchRules must be a non-empty array");
  }

  if (profile.qualificationSegments) {
    if (!requiredArray(profile.qualificationSegments.primarySegments)) errors.push("qualificationSegments.primarySegments must be a non-empty array");
    if (!requiredArray(profile.qualificationSegments.poorFitSegments)) errors.push("qualificationSegments.poorFitSegments must be a non-empty array");
  }

  if (profile.commercialModel) {
    if (!requiredArray(profile.commercialModel.plans)) errors.push("commercialModel.plans must be a non-empty array");
    if (!requiredArray(profile.commercialModel.closeRequirements)) errors.push("commercialModel.closeRequirements must be a non-empty array");
  }

  if (!requiredArray(profile.complianceGuardrails)) {
    errors.push("complianceGuardrails must be a non-empty array");
  }

  if (!requiredArray(profile.objections)) {
    errors.push("objections must be a non-empty array for enhanced company profiles");
  }

  if (profile.sourceMetadata) {
    if (!requiredArray(profile.sourceMetadata.sources)) errors.push("sourceMetadata.sources must be a non-empty array");
  }
}

function validateProfile(profile) {
  const errors = [];

  for (const field of ["id", "companyName", "positioning", "icp", "offers", "qualification", "voice"]) {
    if (profile[field] === undefined || profile[field] === null) {
      errors.push(`missing required field: ${field}`);
    }
  }

  if (!requiredString(profile.id)) errors.push("id must be a non-empty string");
  if (!requiredString(profile.companyName)) errors.push("companyName must be a non-empty string");

  if (profile.positioning) {
    if (!requiredString(profile.positioning.oneLiner)) errors.push("positioning.oneLiner must be a non-empty string");
    if (!requiredString(profile.positioning.primaryOutcome)) errors.push("positioning.primaryOutcome must be a non-empty string");
    if (!requiredArray(profile.positioning.differentiators)) errors.push("positioning.differentiators must be a non-empty array");
  }

  if (profile.icp) {
    if (!requiredArray(profile.icp.bestFit)) errors.push("icp.bestFit must be a non-empty array");
    if (!requiredArray(profile.icp.poorFit)) errors.push("icp.poorFit must be a non-empty array");
    if (!requiredArray(profile.icp.buyerPersonas)) errors.push("icp.buyerPersonas must be a non-empty array");
    if (!requiredArray(profile.icp.triggerEvents)) errors.push("icp.triggerEvents must be a non-empty array");
  }

  if (!requiredArray(profile.offers)) {
    errors.push("offers must be a non-empty array");
  } else {
    profile.offers.forEach((offer, index) => validateOffer(offer, index, errors));
  }

  if (profile.qualification) {
    if (!requiredArray(profile.qualification.mustHave)) errors.push("qualification.mustHave must be a non-empty array");
    if (!requiredArray(profile.qualification.discoveryQuestions)) errors.push("qualification.discoveryQuestions must be a non-empty array");
  }

  if (profile.voice && !requiredString(profile.voice.tone)) {
    errors.push("voice.tone must be a non-empty string");
  }

  if (ENHANCED_REQUIRED_IDS.has(profile.id)) validateEnhancedProfile(profile, errors);

  return errors;
}

function getProfileById(profileId) {
  const files = listCompanyFiles();
  for (const file of files) {
    const profile = readJson(file);
    if (profile.id === profileId) return { profile, file };
  }
  throw new Error(`No company profile found for id: ${profileId}`);
}

function listProfiles() {
  const files = listCompanyFiles();
  for (const file of files) {
    const profile = readJson(file);
    console.log(`${profile.id}\t${profile.companyName}\t${path.relative(root, file)}`);
  }
}

function validateAll() {
  const files = listCompanyFiles();
  let hasErrors = false;

  for (const file of files) {
    const profile = readJson(file);
    const errors = validateProfile(profile);
    if (errors.length === 0) {
      console.log(`OK ${profile.id} (${path.relative(root, file)})`);
      continue;
    }

    hasErrors = true;
    console.error(`FAIL ${profile.id || path.relative(root, file)}`);
    for (const error of errors) console.error(`  - ${error}`);
  }

  if (hasErrors) process.exitCode = 1;
}

function resolvePromptTemplate(defaults, mode) {
  if (defaults.promptTemplates && defaults.promptTemplates[mode]) {
    return defaults.promptTemplates[mode];
  }
  if (mode === "default" && defaults.promptTemplatePath) return defaults.promptTemplatePath;
  throw new Error(`No prompt template configured for mode: ${mode}`);
}

function renderPrompt(profileIdArg, modeArg) {
  const defaults = readJson(defaultConfigPath);
  const profileId = profileIdArg || defaults.activeCompanyId;
  const mode = modeArg || "default";
  const { profile } = getProfileById(profileId);
  const methodology = readJson(path.join(root, defaults.methodologyPath));
  const templatePath = resolvePromptTemplate(defaults, mode);
  const template = fs.readFileSync(path.join(root, templatePath), "utf8");

  const rendered = template
    .replaceAll("{{companyName}}", profile.companyName)
    .replaceAll("{{methodology}}", JSON.stringify(methodology, null, 2))
    .replaceAll("{{companyProfile}}", JSON.stringify(profile, null, 2));

  console.log(rendered);
}

const [command, profileId, mode] = process.argv.slice(2);

switch (command) {
  case "list":
    listProfiles();
    break;
  case "validate":
    validateAll();
    break;
  case "render":
    renderPrompt(profileId, mode);
    break;
  default:
    console.error("Usage: node scripts/profile-tool.mjs <list|validate|render> [profile-id] [mode]");
    process.exitCode = 1;
}
