import { createNeonAuth, type NeonAuth } from "@neondatabase/auth/next/server";
import { NextResponse, type NextRequest } from "next/server";

const authEnabled = Boolean(process.env.NEON_AUTH_BASE_URL && process.env.NEON_AUTH_COOKIE_SECRET);

function resolveNeonAuthBaseUrl() {
  const rawBaseUrl = process.env.NEON_AUTH_BASE_URL;
  if (!rawBaseUrl) return rawBaseUrl;

  try {
    const authUrl = new URL(rawBaseUrl);
    const normalizedPath = authUrl.pathname.replace(/\/+$/, "");
    if (normalizedPath.endsWith("/auth")) return authUrl.toString().replace(/\/+$/, "");

    if (normalizedPath && normalizedPath !== "/") {
      authUrl.pathname = `${normalizedPath}/auth`;
      return authUrl.toString().replace(/\/+$/, "");
    }

    if (process.env.DATABASE_URL) {
      const databaseName = new URL(process.env.DATABASE_URL).pathname.replace(/^\/+/, "").split("?")[0];
      if (databaseName) {
        authUrl.pathname = `/${databaseName}/auth`;
        return authUrl.toString().replace(/\/+$/, "");
      }
    }
  } catch {
    return rawBaseUrl;
  }

  return rawBaseUrl;
}

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
      baseUrl: resolveNeonAuthBaseUrl()!,
      cookies: {
        secret: process.env.NEON_AUTH_COOKIE_SECRET!
      }
    })
  : disabledAuth();

export const isNeonAuthConfigured = authEnabled;
