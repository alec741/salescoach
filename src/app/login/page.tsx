import { AlertCircle, CheckCircle2, LockKeyhole } from "lucide-react";
import { isNeonAuthConfigured } from "@/lib/auth/server";
import { LoginActions } from "@/components/login-actions";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="login-shell">
      <section className="card login-card">
        <div className="login-copy">
          <div>
            <div className="brand">
              <span className="brand-mark">DC</span>
              <span>Decoded Coach</span>
            </div>
            <h1 style={{ marginTop: 36 }}>Sign in to your coaching control center</h1>
            <p className="login-support">
              Neon Auth verifies identity. Decoded Coach maps that identity to rep, manager, or admin access in Postgres.
            </p>
          </div>
          <div className="login-boundary">
            <span><LockKeyhole size={16} /> V1 security boundary</span>
            <p>Dashboards expose scores, summaries, metadata, and coaching actions. Full transcripts are not shown.</p>
          </div>
        </div>
        <div className="login-auth">
          <div className="eyebrow">Sign in</div>
          <h2 style={{ marginTop: 8 }}>Continue with OAuth</h2>
          <div className="auth-state-list">
            <span className={isNeonAuthConfigured ? "check-item" : "check-item warn"}>
              {isNeonAuthConfigured ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
              {isNeonAuthConfigured ? "Neon Auth configured" : "Local OAuth configuration missing"}
            </span>
            <span className="check-item">
              <CheckCircle2 size={14} />
              Access is granted after app role mapping
            </span>
          </div>
          {isNeonAuthConfigured ? (
            <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
              <LoginActions />
              <p className="muted">Google OAuth must be enabled in the Neon Auth console. Unmapped users land on access pending.</p>
            </div>
          ) : (
            <div className="action-item" style={{ marginTop: 20 }}>
              <strong>OAuth is required for dashboard access.</strong>
              <p className="muted" style={{ marginTop: 8 }}>
                Set `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, and `DATABASE_URL` to connect the dashboards to mapped
                Postgres users and coaching data.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
