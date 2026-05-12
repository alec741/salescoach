import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDatabase } from "@/db/client";
import { appUsers, managerRepAssignments, reportArtifacts } from "@/db/schema";
import { auth, isNeonAuthConfigured } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

function safeFilename(filePath: string) {
  return path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveReportPath(storagePath: string) {
  const outputRoot = path.resolve(process.cwd(), "output", "pdf");
  const normalized = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const relativePath = normalized.startsWith("output/pdf/") ? normalized.slice("output/pdf/".length) : normalized;
  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute report paths are not allowed.");
  }
  const resolved = path.resolve(outputRoot, relativePath);
  if (!resolved.startsWith(outputRoot + path.sep) && resolved !== outputRoot) {
    throw new Error("Report path is outside the allowed PDF output directory.");
  }
  return resolved;
}

type SessionUser = { email?: string | null };

function reportLinkSecret() {
  return process.env.REPORT_LINK_SECRET || process.env.CRON_SECRET || process.env.NEON_AUTH_COOKIE_SECRET || "";
}

function signedReportToken(id: string) {
  const secret = reportLinkSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(`report-pdf:${id}`).digest("hex");
}

function isValidSignedReportToken(id: string, token: string | null) {
  if (!token) return false;
  const expected = signedReportToken(id);
  if (!expected || expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

async function currentUser() {
  if (!hasDatabase || !isNeonAuthConfigured) return null;
  const { data: session } = await auth.getSession();
  const email = (session?.user as SessionUser | undefined)?.email;
  if (!email) return null;
  const normalizedEmail = email.toLowerCase();
  const rows = await getDb()
    .select({
      id: appUsers.id,
      role: appUsers.role
    })
    .from(appUsers)
    .where(and(sql`lower(${appUsers.email}) = ${normalizedEmail}`, eq(appUsers.active, true)))
    .limit(1);
  return rows[0] || null;
}

async function canAccessReport(input: {
  user: { id: string; role: "rep" | "manager" | "admin" };
  report: { repUserId: string | null; managerUserId: string | null };
}) {
  if (input.user.role === "admin") return true;
  if (input.user.role === "rep") return input.report.repUserId === input.user.id;
  if (input.report.managerUserId) return input.report.managerUserId === input.user.id;
  if (!input.report.repUserId) return true;
  const rows = await getDb()
    .select({ repUserId: managerRepAssignments.repUserId })
    .from(managerRepAssignments)
    .where(and(eq(managerRepAssignments.managerUserId, input.user.id), eq(managerRepAssignments.repUserId, input.report.repUserId)))
    .limit(1);
  return Boolean(rows[0]);
}

async function storagePathFromRequest(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id && hasDatabase) {
    const rows = await getDb()
      .select({
        storagePath: reportArtifacts.storagePath,
        repUserId: reportArtifacts.repUserId,
        managerUserId: reportArtifacts.managerUserId
      })
      .from(reportArtifacts)
      .where(eq(reportArtifacts.id, id))
      .limit(1);
    if (!rows[0]?.storagePath) return null;

    if (isValidSignedReportToken(id, request.nextUrl.searchParams.get("token"))) {
      return rows[0].storagePath;
    }

    if (!isNeonAuthConfigured) throw new Error("Authentication is not configured.");
    const user = await currentUser();
    if (!user) throw new Error("Authentication required.");
    if (!(await canAccessReport({ user, report: rows[0] }))) throw new Error("Not authorized for this report.");
    return rows[0].storagePath;
  }

  const requestedPath = request.nextUrl.searchParams.get("path");
  if (requestedPath && (!hasDatabase || process.env.NODE_ENV !== "production")) return requestedPath;
  return null;
}

export async function GET(request: NextRequest) {
  let storagePath: string | null;
  try {
    storagePath = await storagePathFromRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report access denied.";
    return NextResponse.json(
      { error: message },
      { status: message.includes("configured") ? 503 : message.includes("Authentication") ? 401 : 403 }
    );
  }
  if (!storagePath) {
    return NextResponse.json({ error: "Report PDF was not found or is not available." }, { status: 404 });
  }

  try {
    const filePath = resolveReportPath(storagePath);
    const file = await fs.readFile(filePath);
    const download = request.nextUrl.searchParams.get("download") === "1";
    return new NextResponse(file, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(file.byteLength),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeFilename(filePath)}"`
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to read report PDF." },
      { status: 404 }
    );
  }
}
