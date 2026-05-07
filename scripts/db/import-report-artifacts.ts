import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../../src/db/client";
import { appUsers, reportArtifacts } from "../../src/db/schema";

type ManifestPdf = {
  path: string;
  pages?: number;
};

type ReportManifest = {
  date: string;
  manager_summary_pdf?: ManifestPdf;
  rep_summary_pdfs?: ManifestPdf[];
};

type ArtifactInput = {
  reportType: string;
  periodType: "daily" | "weekly" | "monthly" | "quarterly";
  periodStart: string;
  periodEnd: string;
  storagePath: string;
  repUserId?: string | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--manifest");
  const defaultManifest = path.join(process.cwd(), "output", "pdf", "daily", "2026-05-06", "codex-leverage-fix", "manifest.json");
  return {
    manifest: manifestIndex >= 0 ? args[manifestIndex + 1] : defaultManifest
  };
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function readManifest(filePath: string): ReportManifest {
  if (!fs.existsSync(filePath)) throw new Error(`Manifest file does not exist: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as ReportManifest;
}

function normalizeStoragePath(filePath: string) {
  return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, "/");
}

function repSlugFromPdf(filePath: string) {
  return slug(path.basename(filePath, ".pdf"));
}

async function repIdBySlug() {
  const db = getDb();
  const reps = await db
    .select({ id: appUsers.id, displayName: appUsers.displayName })
    .from(appUsers)
    .where(eq(appUsers.role, "rep"));
  return new Map(reps.map((rep) => [slug(rep.displayName), rep.id]));
}

async function upsertArtifact(input: ArtifactInput) {
  const db = getDb();
  const existing = await db
    .select({ id: reportArtifacts.id })
    .from(reportArtifacts)
    .where(eq(reportArtifacts.storagePath, input.storagePath))
    .limit(1);

  const values = {
    reportType: input.reportType,
    periodType: input.periodType,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    repUserId: input.repUserId || null,
    storagePath: input.storagePath,
    contentMarkdown: null
  };

  if (existing[0]) {
    await db.update(reportArtifacts).set(values).where(eq(reportArtifacts.id, existing[0].id));
    return "updated";
  }

  await db.insert(reportArtifacts).values(values);
  return "inserted";
}

async function main() {
  const args = parseArgs();
  const manifest = readManifest(args.manifest);
  const bySlug = await repIdBySlug();
  const artifacts: ArtifactInput[] = [];

  if (manifest.manager_summary_pdf?.path) {
    artifacts.push({
      reportType: "manager_summary",
      periodType: "daily",
      periodStart: manifest.date,
      periodEnd: manifest.date,
      storagePath: normalizeStoragePath(manifest.manager_summary_pdf.path)
    });
  }

  for (const pdf of manifest.rep_summary_pdfs || []) {
    const repSlug = repSlugFromPdf(pdf.path);
    artifacts.push({
      reportType: "rep_summary",
      periodType: "daily",
      periodStart: manifest.date,
      periodEnd: manifest.date,
      repUserId: bySlug.get(repSlug) || null,
      storagePath: normalizeStoragePath(pdf.path)
    });
  }

  const results = { inserted: 0, updated: 0, missingRepMappings: 0 };
  for (const artifact of artifacts) {
    const result = await upsertArtifact(artifact);
    results[result] += 1;
    if (artifact.reportType === "rep_summary" && !artifact.repUserId) results.missingRepMappings += 1;
  }

  console.log(JSON.stringify({ ok: true, manifest: args.manifest, artifacts: artifacts.length, ...results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
