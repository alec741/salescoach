import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Headphones, Target, TrendingUp, TriangleAlert } from "lucide-react";
import { ScoreTrend } from "./charts";
import { DimensionTrends } from "./dimension-trends";
import { EmptyState, MetricCard, PageBadge } from "./app-shell";
import { formatDate, formatScore, initials, titleCaseDimension } from "@/lib/format";
import type { CallRow, CoachingAction, CoachingSummary, DashboardData, RepPerformance } from "@/lib/types";

export function DashboardOverview({ data, mode }: { data: DashboardData; mode: "rep" | "manager" }) {
  const leverageFocusLabel = data.teamFocusDimensions.length
    ? data.teamFocusDimensions.map((dimension) => titleCaseDimension(dimension)).join(" + ")
    : "Quantification";
  const highestRisk = data.reps.slice().sort((a, b) => b.complianceFlags - a.complianceFlags)[0];
  const biggestMover = data.reps.slice().sort((a, b) => b.improvement - a.improvement)[0] || data.reps[0];
  return (
    <section>
      <div className="decision-brief card">
        <div>
          <div className="eyebrow">{mode === "rep" ? "Next action" : "Manager review queue"}</div>
          <h2>{mode === "rep" ? `Practice ${leverageFocusLabel} on the next call block` : `Start with ${highestRisk?.name || "the highest-risk rep"}`}</h2>
          <p className="muted">
            {mode === "rep"
              ? data.teamFocusRationale
              : "Prioritize dimension regressions, compliance exposure, and low-scoring reps before reviewing the full leaderboard."}
          </p>
        </div>
        <div className="brief-actions">
          <Link className="button" href={mode === "rep" ? "/rep/calls" : `/manager/reps/${highestRisk?.id || data.reps[0]?.id || ""}`}>
            Review evidence
            <ArrowRight size={15} />
          </Link>
          <span className="metric-pill">{mode === "rep" ? leverageFocusLabel : `${highestRisk?.complianceFlags || 0} flags`}</span>
          {mode === "manager" && biggestMover ? <span className="metric-pill">{biggestMover.name} improving</span> : null}
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label={mode === "rep" ? "My score" : "Team score"} value={formatScore(data.teamAverage)} note="Average graded coaching score" />
        <MetricCard label="Calls graded" value={String(data.totalCalls)} note="Substantive calls in current view" />
        <MetricCard label="Compliance flags" value={String(data.complianceFlags)} note="Items requiring manager attention" />
        <MetricCard label="Leverage focus" value={leverageFocusLabel} note="Highest-impact coaching behavior" />
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card panel">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Performance trend</div>
                <h2>{mode === "rep" ? "Your coaching score over time" : "Team coaching score over time"}</h2>
              </div>
              <PageBadge>Weekly, monthly, quarterly ready</PageBadge>
            </div>
            <ScoreTrend data={data.scoreTrend} />
          </section>

          <DimensionTrends
            scores={data.categoryAverages}
            mode={mode}
            title={mode === "rep" ? "Are your trained behaviors improving?" : "Are team coaching dimensions improving?"}
            history={data.dimensionTrends}
          />

          {mode === "manager" ? <ManagerReviewQueue reps={data.reps} /> : <RecentCalls calls={data.calls.slice(0, 6)} />}
        </div>

        <div className="stack">
          <CoachingFocus opportunity={data.teamOpportunity} actions={data.actions} />
          {mode === "manager" ? <TeamActionQueue reps={data.reps} actions={data.actions} /> : <SummaryList summaries={data.summaries.slice(0, 4)} />}
        </div>
      </div>
    </section>
  );
}

export function TeamActionQueue({ reps, actions }: { reps: RepPerformance[]; actions: CoachingAction[] }) {
  const risk = reps.filter((rep) => rep.complianceFlags > 0).sort((a, b) => b.complianceFlags - a.complianceFlags).slice(0, 3);
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Action queue</div>
          <h2>Review order</h2>
        </div>
        <TriangleAlert size={20} color="currentColor" />
      </div>
      <div className="summary-list">
        {risk.map((rep) => (
          <Link key={rep.id} href={`/manager/reps/${rep.id}`} className="action-item action-link">
            <div className="action-meta">
              <strong>{rep.name}</strong>
              <span className="badge amber">{rep.complianceFlags} flags</span>
            </div>
            <p className="muted">Coach {titleCaseDimension(rep.primaryFocusDimension)} and check compliance language.</p>
          </Link>
        ))}
        {actions.slice(0, 1).map((action) => (
          <div key={action.id} className="action-item">
            <div className="action-meta">
              <span className="badge">{titleCaseDimension(action.dimension)}</span>
              <span className="muted">Team drill</span>
            </div>
            <strong>{action.actionText}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CoachingFocus({ opportunity, actions }: { opportunity: string; actions: CoachingAction[] }) {
  const labels = ["Practice", "Apply", "Review"];
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">7-day coaching focus</div>
          <h2>Actionable next behavior</h2>
        </div>
        <Target size={20} color="#1d7f74" />
      </div>
      <p>{opportunity}</p>
      <div className="action-list" style={{ marginTop: 14 }}>
        {actions.slice(0, 3).map((action, index) => (
          <article key={action.id} className="action-item">
            <div className="action-meta">
              <span className="badge">{titleCaseDimension(action.dimension)}</span>
              <span className="muted">{labels[index] || action.status}</span>
            </div>
            <h3>{action.actionText}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              {index === 0
                ? action.whyItMatters
                : index === 1
                  ? "Use it before plan, rate, promotion, or platform walkthrough language."
                  : "After the call block, compare whether the quantified pain changed the sales conversation."}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RepLeaderboard({ reps }: { reps: RepPerformance[] }) {
  if (!reps.length) return <EmptyState title="No reps mapped yet" body="Add reps to app_users and manager_rep_assignments to populate the manager dashboard." />;
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Rep performance</div>
          <h2>Leaderboard and risk scan</h2>
        </div>
        <Link className="button secondary" href="/settings/users">
          Manage users
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Score</th>
              <th>Calls</th>
              <th>Focus</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {reps
              .slice()
              .sort((a, b) => b.averageScore - a.averageScore)
              .map((rep) => (
                <tr key={rep.id}>
                  <td>
                    <Link href={`/manager/reps/${rep.id}`} className="rep-cell">
                      <span className="avatar">{initials(rep.name)}</span>
                      <span>
                        <strong>{rep.name}</strong>
                        <br />
                        <span className="muted">{rep.email}</span>
                      </span>
                    </Link>
                  </td>
                  <td className={rep.averageScore >= 7 ? "good" : ""}>{formatScore(rep.averageScore)}</td>
                  <td>{rep.calls}</td>
                  <td title={`Lowest score: ${titleCaseDimension(rep.weakestScoreDimension)}`}>{titleCaseDimension(rep.primaryFocusDimension)}</td>
                  <td className={rep.complianceFlags > 5 ? "risk" : ""}>{rep.complianceFlags}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ManagerReviewQueue({ reps }: { reps: RepPerformance[] }) {
  if (!reps.length) return <EmptyState title="No reps mapped yet" body="Add reps to app_users and manager_rep_assignments to populate the manager dashboard." />;
  const queue = reps
    .slice()
    .sort((a, b) => b.complianceFlags - a.complianceFlags || a.averageScore - b.averageScore);
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Manager review queue</div>
          <h2>Who needs attention first</h2>
        </div>
        <Link className="button secondary" href="/settings/users">
          Manage users
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="review-queue">
        {queue.map((rep) => {
          const status = rep.complianceFlags > 6 ? "Compliance risk" : rep.averageScore < 6 ? "Needs lift" : rep.calls < 3 ? "Low volume" : "Improving";
          return (
            <Link key={rep.id} href={`/manager/reps/${rep.id}`} className="review-row">
              <span className="avatar">{initials(rep.name)}</span>
              <span>
                <strong>{rep.name}</strong>
                <small>{titleCaseDimension(rep.primaryFocusDimension)} focus</small>
              </span>
              <span className={status === "Improving" ? "badge" : "badge amber"}>{status}</span>
              <strong>{formatScore(rep.averageScore)}</strong>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function ComplianceWatch({ reps }: { reps: RepPerformance[] }) {
  const watchlist = reps.filter((rep) => rep.complianceFlags > 0).sort((a, b) => b.complianceFlags - a.complianceFlags);
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Compliance</div>
          <h2>Watchlist</h2>
        </div>
        <TriangleAlert size={20} color="#c68122" />
      </div>
      <div className="summary-list">
        {watchlist.slice(0, 5).map((rep) => (
          <div key={rep.id} className="action-item">
            <div className="action-meta">
              <strong>{rep.name}</strong>
              <span className="badge amber">{rep.complianceFlags} flags</span>
            </div>
            <p className="muted">Review lender, approval, funding, rate, and 0% claims on recent calls.</p>
          </div>
        ))}
        {!watchlist.length ? <p className="muted">No repeated compliance flags in the current view.</p> : null}
      </div>
    </section>
  );
}

export function RecentCalls({ calls }: { calls: CallRow[] }) {
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Recent calls</div>
          <h2>Latest graded scorecards</h2>
        </div>
        <Headphones size={20} color="#1d7f74" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Rep</th>
              <th>Score</th>
              <th>Focus</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call) => (
              <tr key={call.id}>
                <td>{formatDate(call.activityAt)}</td>
                <td>{call.repName}</td>
                <td>{formatScore(call.overallScore)}</td>
                <td title={`Lowest score: ${titleCaseDimension(call.weakestScoreDimension)}`}>{titleCaseDimension(call.primaryFocusDimension)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SummaryList({ summaries }: { summaries: CoachingSummary[] }) {
  return (
    <section className="card panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Past summaries</div>
          <h2>Daily, weekly, monthly</h2>
        </div>
        <FileText size={20} color="#1d7f74" />
      </div>
      <div className="summary-list">
        {summaries.map((summary) => (
          <article key={summary.id} className="action-item">
            <div className="action-meta">
              <span className="badge">{summary.periodType}</span>
              <span className="muted">{formatScore(summary.averageScore)}</span>
            </div>
            <strong>{summary.repName}</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              {summary.nextCallFocus}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function TargetStrip({ reps }: { reps: RepPerformance[] }) {
  return (
    <section className="card wide-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Targets</div>
          <h2>Improvement targets by rep</h2>
        </div>
        <CheckCircle2 size={20} color="#1d7f74" />
      </div>
      <div className="category-grid">
        {reps.slice(0, 4).map((rep, index) => {
          const focusDimension = rep.primaryFocusDimension;
          return (
          <article key={rep.id} className="category-card">
            <div className="metric-label">{rep.name}</div>
            <h3 style={{ marginTop: 8 }}>Raise {titleCaseDimension(focusDimension)} to 7.0</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Current: {formatScore(rep.scores[focusDimension])}
            </p>
            <div className="score-bar" role="meter" aria-label={`${rep.name} target progress`} aria-valuemin={0} aria-valuemax={7} aria-valuenow={Number(rep.scores[focusDimension].toFixed(1))}>
              <span style={{ width: `${Math.min(100, (rep.scores[focusDimension] / 7) * 100)}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              Due {index < 2 ? "this week" : "this month"} - {rep.calls} scored calls
            </p>
          </article>
        );})}
      </div>
    </section>
  );
}

export function ReportsTable({ data }: { data: DashboardData }) {
  return (
    <section className="card wide-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Artifacts</div>
          <h2>Report history and exports</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Report</th>
              <th>Period</th>
              <th>Owner</th>
              <th>Export</th>
            </tr>
          </thead>
          <tbody>
            {data.reports.map((report) => (
              <tr key={report.id}>
                <td>
                  <strong>{report.title}</strong>
                  <br />
                  <span className="muted">{report.reportType}</span>
                </td>
                <td>
                  {report.periodType} - {formatDate(report.periodStart)}
                </td>
                <td>{report.owner}</td>
                <td>{report.storagePath ? <span className="badge">PDF ready</span> : <span className="muted">Markdown only</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OpportunityHeader({ title, body }: { title: string; body: string }) {
  return (
    <section className="card wide-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Control center</div>
          <h2>{title}</h2>
        </div>
        <span className="badge">
          <TrendingUp size={13} />
          Live rollups
        </span>
      </div>
      <p className="muted">{body}</p>
    </section>
  );
}
