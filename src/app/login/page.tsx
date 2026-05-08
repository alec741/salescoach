import { LockKeyhole, ShieldCheck } from "lucide-react";
import { isNeonAuthConfigured } from "@/lib/auth/server";
import { LoginActions } from "@/components/login-actions";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const showSetupNotice = !isNeonAuthConfigured;

  return (
    <main className="login-shell">
      <section className="card login-card">
        <div className="login-copy">
          <div>
            <div className="brand">
              <span className="brand-mark">DC</span>
              <span>Decoded Coach</span>
            </div>
            <h1 style={{ marginTop: 36 }}>Sign in to Decoded Coach</h1>
            <p className="login-support">
              Access your coaching dashboard, call reviews, and manager action queues from one secure workspace.
            </p>
          </div>
          <div className="login-boundary">
            <span><LockKeyhole size={16} /> Protected coaching workspace</span>
            <p>Dashboards expose scores, summaries, metadata, and coaching actions. Full transcripts are not shown.</p>
          </div>
        </div>
        <div className="login-auth">
          <div className="eyebrow">Secure sign in</div>
          <h2 style={{ marginTop: 8 }}>Continue to your workspace</h2>
          <p className="muted login-auth-copy">
            Use your company Google account. Access is limited to mapped reps, managers, and admins.
          </p>
          {isNeonAuthConfigured ? (
            <div style={{ marginTop: 20, display: "grid", gap: 14 }}>
              <LoginActions />
              <div className="login-access-note">
                <ShieldCheck size={16} />
                <span>Unmapped users are held on access pending until an admin assigns a role.</span>
              </div>
            </div>
          ) : (
            <div className="setup-notice" style={{ marginTop: 20 }} role={showSetupNotice ? "status" : undefined}>
              <strong>Authentication setup is incomplete.</strong>
              <p className="muted" style={{ marginTop: 8 }}>
                Add `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` to enable Google sign in.
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
