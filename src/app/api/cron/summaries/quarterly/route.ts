import type { NextRequest } from "next/server";
import { summaryCronHandlers } from "@/lib/cron/summaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return summaryCronHandlers.quarterly(request);
}
