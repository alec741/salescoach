import Link from "next/link";
import { ArrowRight, CheckCircle2, FileText, Headphones, Target, TrendingUp, TriangleAlert } from "lucide-react";
import { ScoreTrend } from "./charts";
import { CompleteActionButton } from "./complete-action-button";
import { DimensionTrends } from "./dimension-trends";
import { EmptyState, MetricCard, PageBadge } from "./app-shell";
import { formatDate, formatPercent, formatScore, initials, titleCaseDimension } from "@/lib/format";
import type { CallRow, CoachingAction, CoachingSummary, CoachingTarget, DashboardData, RepPerformance } from "@/lib/types";

export function DashboardOverview({ data, mode }: { data: DashboardData; mode: "rep" | "manager" }) {
  const leverageFocusLabel = data.teamFocusDimensions.length
    ? data.teamFocusDimensions.map((dimension) => titleCaseDimension(dimension)).join(" + ")
    : "No focus yet";
  const highestRisk = data.reps.slice().sort((a, b) => b.complianceFlags - a.complianceFlags)[0];
  const biggestMover = data.reps.slice().sort((a, b) => b.improvement - a.improvement)[0] || data.reps[0];
  return (
    <section>
      <div className={`decision-brief card ${mode === "manager" ? "accent-risk" : "accent-focus"}`}>
        <div>
          <div className="eyebrow">{mode === "rep" ? "Next action" : "Manager review queue"}</div>
          <h2>{mode === "rep" ? (data.totalCalls ? `Practice ${leverageFocusLabel} on the next call block` : "No graded calls yet") : `Start with ${highestRisk?.name || "the highest-risk rep"}`}</h2>
          <p className="muted">
            {mode === "rep"
              ? data.teamFocusRationale
              : "Prioritize dimension regressions, compliance exposure, and low-scoring reps before reviewing the full leaderboard."}
          </p>
        </div>
        <div className="brief-actions">
          <Link className="button" href={mode === "rep" ? "/rep/calls" : highestRisk ? `/manager/reps/${highestRisk.id}` : "/settings/users"}>
            Review evidence
            <ArrowRight size={15} />
          </Link>
          <span className={mode === "rep" ? "metric-pill" : "metric-pill badge risk"}>{mode === "rep" ? leverageFocusLabel : `${highestRisk?.complianceFlags || 0} flags`}</span>
          {mode === "manager" && biggestMover ? <span className="metric-pill badge good">{biggestMover.name} improving</span> : null}
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label={mode === "rep" ? "My score" : "Team score"} value={formatScore(data.teamAverage)} note="Average graded coaching score" />
        <MetricCard label="Calls graded" value={String(data.totalCalls)} note="Substantive calls in current view" />
        <MetricCard label="Compliance flags" value={String(data.complianceFlags)} note="Items requiring manager attention" tone="risk" />
        <MetricCard label="Leverage focus" value={leverageFocusLabel} note="Highest-impact coaching behavior" tone="focus" />
        {mode === "manager" ? (
          <MetricCard
            label="Won rate"
            value={formatPercent(data.teamOutcomes.winRate)}
            note={`${data.teamOutcomes.won} won, ${data.teamOutcomes.lost} lost, ${data.teamOutcomes.open} open`}
            tone="progress"
          />
        ) : null}
      </div>

      <div className="dashboard-grid">
        <div className="stack">
          <section className="card panel accent-progress">
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

          {mode === "manager" ? <OutcomeTrendBoard reps={data.reps} teamOutcomes={data.teamOutcomes} /> : null}
          {mode === "manager" ? <ManagerReviewQueue reps={data.reps} /> : <RecentCalls calls={data.calls.slice(0, 6)} />}
        </div>

        <div className="stack">
          <CoachingFocus opportunity={data.teamOpportunity} actions={data.actions} mode={mode} />
          {mode === "manager" ? <TeamActionQueue reps={data.reps} actions={data.actions} /> : <SummaryList summaries={data.summaries.slice(0, 4)} />}
        </div>
      </div>
    </section>
  );
}

export function OutcomeTrendBoard({
  reps,
  teamOutcomes
}: {
  reps: RepPerformance[];
  teamOutcomes: DashboardData["teamOutcomes"];
}) {
  return (
    <section className="card panel accent-progress">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Outcome reporting</div>
          <h2>Won, lost, open, and no-decision by rep</h2>
        </div>
        <span className="metric-pill">{formatPercent(teamOutcomes.winRate)} won rate</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Rep</th>
              <th>Won</th>
              <th>Lost</th>
              <th>Open</th>
              <th>No decision</th>
              <th>Win rate</th>
            </tr>
          </thead>
          <tbody>
            {reps
              .slice()
              .sort((a, b) => b.outcomes.closed - a.outcomes.closed || b.outcomes.total - a.outcomes.total || a.name.localeCompare(b.name))
              .map((rep) => (
                <tr key={rep.id}>
                  <td>
                    <Link href={`/manager/reps/${rep.id}`} className="rep-cell">
                      <span className="avatar">{initials(rep.name)}</span>
                      <span>
                        <strong>{rep.name}</strong>
                        <br />
                        <span className="muted">{rep.outcomes.total} tracked calls</span>
                      </span>
                    </Link>
                  </td>
                  <td className="good">{rep.outcomes.won}</td>
                  <td className={rep.outcomes.lost > rep.outcomes.won ? "risk" : ""}>{rep.outcomes.lost}</td>
                  <td>{rep.outcomes.open}</td>
                  <td>{rep.outcomes.noDecision}</td>
                  <td>{formatPercent(rep.outcomes.winRate)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TeamActionQueue({ reps, actions }: { reps: RepPerformance[]; actions: CoachingAction[] }) {
  const risk = reps.filter((rep) => rep.complianceFlags > 0).sort((a, b) => b.complianceFlags - a.complianceFlags).slice(0, 3);
  return (
    <section className="card panel accent-risk">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Action queue</div>
          <h2>Review order</h2>
        </div>
        <TriangleAlert size={20} color="currentColor" />
      </div>
      <div className="summary-list">
        {risk.map((rep) => (
          <Link key={rep.id} href={`/manager/reps/${rep.id}`} className="action-item state-risk action-link">
            <div className="action-meta">
              <strong>{rep.name}</strong>
              <span className="badge risk">{rep.complianceFlags} flags</span>
            </div>
            <p className="muted">{rep.nextCallFocus}</p>
          </Link>
        ))}
        {actions.slice(0, 1).map((action) => (
          <div key={action.id} className="action-item state-focus">
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

export function CoachingFocus({
  opportunity,
  actions,
  mode = "manager"
}: {
  opportunity: string;
  actions: CoachingAction[];
  mode?: "rep" | "manager";
}) {
  return (
    <section className="card panel accent-focus">
      <div className="panel-header">
        <div>
          <div className="eyebrow">7-day coaching focus</div>
          <h2>Actionable next behavior</h2>
        </div>
        <Target size={20} color="#1d7f74" />
      </div>
      <p>{opportunity}</p>
      <div className="action-list" style={{ marginTop: 14 }}>
        {actions.length ? actions.slice(0, 3).map((action, index) => (
          <article key={action.id} className={`action-item ${index === 0 ? "state-focus" : index === 1 ? "state-progress" : "state-risk"}`}>
            <div className="action-meta">
              <span className={index === 2 ? "badge info" : "badge"}>{titleCaseDimension(action.dimension)}</span>
              <span className="muted">{action.status}</span>
            </div>
            <h3>{action.actionText}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              {action.whyItMatters}
            </p>
            {mode === "rep" ? (
              <div className="detail-actions" style={{ marginTop: 12 }}>
                <CompleteActionButton actionId={action.id} />
              </div>
            ) : null}
          </article>
        )) : <p className="muted">No active coaching actions are in the database for this view.</p>}
      </div>
    </section>
  );
}

export function RepLeaderboard({ reps }: { reps: RepPerformance[] }) {
  if (!reps.length) return <EmptyState title="No reps mapped yet" body="Add reps to app_users and manager_rep_assignments to populate the manager dashboard." />;
  return (
    <section className="card panel accent-risk">
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
                <small>
                  {rep.outcomes.won} won, {rep.outcomes.lost} lost, {rep.outcomes.open} open, {rep.outcomes.noDecision} no-decision
                </small>
              </span>
              <span className={status === "Improving" ? "badge good" : status === "Compliance risk" ? "badge risk" : "badge amber"}>{status}</span>
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
    <section className="card panel accent-risk">
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
              <span className="badge risk">{rep.complianceFlags} flags</span>
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
    <section className="card panel accent-report">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Recent calls</div>
          <h2>Latest graded scorecards</h2>
        </div>
        <Headphones size={20} color="#1d7f74" />
      </div>
      <div className="table-wrap">
        {calls.length ? <table>
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
        </table> : <p className="muted">No graded calls are available yet.</p>}
      </div>
    </section>
  );
}

export function SummaryList({ summaries }: { summaries: CoachingSummary[] }) {
  return (
    <section className="card panel accent-progress">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Past summaries</div>
          <h2>Daily, weekly, monthly</h2>
        </div>
        <FileText size={20} color="#1d7f74" />
      </div>
      <div className="summary-list">
        {summaries.length ? summaries.map((summary) => (
          <article key={summary.id} className="action-item state-progress">
            <div className="action-meta">
              <span className="badge">{summary.periodType}</span>
              <span className="muted">{formatScore(summary.averageScore)}</span>
            </div>
            <strong>{summary.repName}</strong>
            <p className="muted" style={{ marginTop: 6 }}>
              {summary.nextCallFocus}
            </p>
          </article>
        )) : <p className="muted">No coaching summaries are available yet.</p>}
      </div>
    </section>
  );
}

export function TargetStrip({ reps, targets }: { reps: RepPerformance[]; targets: CoachingTarget[] }) {
  const repsById = new Map(reps.map((rep) => [rep.id, rep]));
  const visibleTargets = targets.filter((target) => repsById.has(target.repId)).slice(0, 4);
  return (
    <section className="card wide-panel accent-focus">
      <div className="panel-header">
        <div>
          <div className="eyebrow">Targets</div>
          <h2>Improvement targets by rep</h2>
        </div>
        <CheckCircle2 size={20} color="#1d7f74" />
      </div>
      <div className="category-grid">
        {visibleTargets.length ? visibleTargets.map((target) => {
          const rep = repsById.get(target.repId);
          if (!rep) return null;
          const currentScore = rep.scores[target.dimension] || 0;
          return (
          <article key={target.id} className="category-card">
            <div className="metric-label">{rep.name}</div>
            <h3 style={{ marginTop: 8 }}>Raise {titleCaseDimension(target.dimension)} to {formatScore(target.targetScore)}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Current: {formatScore(currentScore)}
            </p>
            <div className="score-bar" role="meter" aria-label={`${rep.name} target progress`} aria-valuemin={0} aria-valuemax={target.targetScore} aria-valuenow={Number(currentScore.toFixed(1))}>
              <span style={{ width: `${target.targetScore ? Math.min(100, (currentScore / target.targetScore) * 100) : 0}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              {target.periodType} target through {formatDate(target.periodEnd)} - {rep.calls} scored calls
            </p>
          </article>
        );}) : <p className="muted">No active coaching targets are configured in the database.</p>}
      </div>
    </section>
  );
}

export function ReportsTable({ data }: { data: DashboardData }) {
  return (
    <section className="card wide-panel accent-report">
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
                <td>{report.storagePath ? <span className="badge info">PDF ready</span> : <span className="badge amber">Markdown only</span>}</td>
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
