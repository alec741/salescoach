import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { getDb, hasDatabase } from "@/db/client";
import { reportArtifacts } from "@/db/schema";

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

async function storagePathFromRequest(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (id && hasDatabase) {
    const rows = await getDb()
      .select({ storagePath: reportArtifacts.storagePath })
      .from(reportArtifacts)
      .where(eq(reportArtifacts.id, id))
      .limit(1);
    if (rows[0]?.storagePath) return rows[0].storagePath;
  }

  const requestedPath = request.nextUrl.searchParams.get("path");
  if (requestedPath && (!hasDatabase || process.env.NODE_ENV !== "production")) return requestedPath;
  return null;
}

export async function GET(request: NextRequest) {
  const storagePath = await storagePathFromRequest(request);
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
