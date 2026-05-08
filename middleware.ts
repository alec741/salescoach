import { NextResponse } from "next/server";
import { auth, isNeonAuthConfigured } from "@/lib/auth/server";
import type { NextRequest } from "next/server";

const protectedRoutes = ["/rep", "/manager", "/settings", "/api/reports/pdf"];

export default function middleware(request: NextRequest) {
  if (!protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route))) return;
  if (!isNeonAuthConfigured) {
    return NextResponse.json(
      { error: "Authentication is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET." },
      { status: 503 }
    );
  }

  return auth.middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"]
};
