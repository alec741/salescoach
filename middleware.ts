import { auth, isNeonAuthConfigured } from "@/lib/auth/server";
import type { NextRequest } from "next/server";

const protectedRoutes = ["/rep", "/manager", "/settings"];

export default function middleware(request: NextRequest) {
  if (!isNeonAuthConfigured) return;
  if (!protectedRoutes.some((route) => request.nextUrl.pathname.startsWith(route))) return;

  return auth.middleware({ loginUrl: "/login" })(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"]
};
