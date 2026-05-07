import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { NextResponse, type NextRequest } from "next/server";

const authEnabled = Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);

function disabledAuth(): NeonAuth {
  return {
    handler: () => {
      const unavailable = async () =>
        NextResponse.json(
          { error: "Neon Auth is not configured. Set NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET." },
          { status: 503 }
        );
      return {
        GET: unavailable,
        POST: unavailable,
        PUT: unavailable,
        DELETE: unavailable,
        PATCH: unavailable
      };
    },
    middleware: () => async (_request: NextRequest) => NextResponse.next(),
    getSession: async () => ({ data: null, error: null })
  } as unknown as NeonAuth;
}

export const auth = authEnabled
  ? createNeonAuth({
      baseUrl: process.env.NEON_AUTH_BASE_URL!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!
      }
    })
  : disabledAuth();

export const isNeonAuthConfigured = authEnabled;
