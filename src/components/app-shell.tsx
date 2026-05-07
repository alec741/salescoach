import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  FileText,
  Gauge,
  Headphones,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Users
} from "lucide-react";
import type { AppUser } from "@/lib/types";
import { initials } from "@/lib/format";

const managerNav = [
  { href: "/manager", label: "Manager Dashboard", icon: LayoutDashboard },
  { href: "/manager/reports", label: "Reports", icon: FileText },
  { href: "/settings/users", label: "User Mapping", icon: Settings }
];

const repNav = [
  { href: "/rep", label: "My Dashboard", icon: Gauge },
  { href: "/rep/calls", label: "My Calls", icon: Headphones },
  { href: "/rep/summaries", label: "Summaries", icon: ClipboardList }
];

export function AppShell({
  user,
  active,
  eyebrow = "Coaching Control Center",
  title,
  subtitle,
  children
}: {
  user: AppUser;
  active: string;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const nav = user.role === "rep" ? repNav : [...managerNav, ...repNav];
  return (
    <div className="app-shell">
      <header className="sidebar">
        <Link href={user.role === "rep" ? "/rep" : "/manager"} className="brand">
          <span className="brand-mark">
            <ShieldCheck size={18} />
          </span>
          <span>Decoded Coach</span>
        </Link>

        <nav className="side-nav" aria-label="Primary navigation">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`side-link ${active === item.href ? "active" : ""}`}>
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="eyebrow">Role</div>
          <strong>{user.role === "rep" ? "Sales rep access" : user.role === "admin" ? "Admin access" : "Manager access"}</strong>
          <p className="muted" style={{ marginTop: 8 }}>
            Calls, reports, and coaching visibility are scoped by DB role mappings.
          </p>
        </div>
      </header>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h1>{title || (user.role === "rep" ? "Your coaching dashboard" : "Team performance and coaching priorities")}</h1>
            {subtitle ? (
              <p className="muted topbar-subtitle">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="user-pill">
            <span className="avatar">{initials(user.displayName)}</span>
            <span>{user.displayName}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

export function PendingAccess() {
  return (
    <main className="pending-shell">
      <section className="card login-card" style={{ gridTemplateColumns: "1fr" }}>
        <div className="login-auth">
          <div className="eyebrow">Access pending</div>
          <h1>Your OAuth login is working, but no app role is mapped yet.</h1>
          <p className="muted" style={{ marginTop: 12 }}>
            Add this user to `app_users` with a `rep`, `manager`, or `admin` role and, for managers, add rows in
            `manager_rep_assignments`.
          </p>
        </div>
      </section>
    </main>
  );
}

export function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="card metric-card">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </article>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <section className="card wide-panel state-panel">
      <div className="eyebrow">No data</div>
      <h2>{title}</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        {body}
      </p>
      {action ? <div className="detail-actions">{action}</div> : null}
    </section>
  );
}

export function LoadingState({ title = "Loading workspace" }: { title?: string }) {
  return (
    <section className="card wide-panel state-panel" aria-busy="true">
      <div className="skeleton-line short" />
      <h2>{title}</h2>
      <div className="skeleton-grid">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <section className="card wide-panel state-panel" role="alert">
      <div className="eyebrow">Needs attention</div>
      <h2>{title}</h2>
      <p className="muted" style={{ marginTop: 8 }}>{body}</p>
      <div className="detail-actions">
        <button className="button secondary" type="button">Retry</button>
      </div>
    </section>
  );
}

export function ManagerOnly({ children }: { children: React.ReactNode }) {
  return (
    <span className="badge amber">
      <Users size={13} />
      {children}
    </span>
  );
}

export function PageBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="status-pill">
      <BarChart3 size={15} />
      {children}
    </span>
  );
}
