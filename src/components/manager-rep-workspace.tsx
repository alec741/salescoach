"use client";

import { useState, useTransition } from "react";
import { MessageSquareText, ShieldAlert, Target } from "lucide-react";
import { assignFocusAction, markOneOnOnePreparedAction } from "@/app/actions";
import { CallsBrowser } from "./calls-browser";
import { ScoreTrend } from "./charts";
import { DimensionTrends } from "./dimension-trends";
import { CoachingFocus, TargetStrip } from "./dashboard";
import { FeedbackPanel } from "./feedback-panel";
import { formatPercent, formatScore, titleCaseDimension } from "@/lib/format";
import { rubricKeys, type DashboardData, type RubricKey } from "@/lib/types";

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function ManagerRepWorkspace({ data }: { data: DashboardData }) {
  const rep = data.reps[0];
  const latestSummary = data.summaries.find((summary) => summary.repId === rep.id) || data.summaries[0];
  const suggestedFocusDimension = rep.primaryFocusDimension;
  const suggestedActionText = rep.nextCallFocus;
  const managerSession = rep.managerSession;
  const [isPending, startTransition] = useTransition();
  const [prepState, setPrepState] = useState(managerSession?.status || "draft");
  const [actionMessage, setActionMessage] = useState(managerSession ? "Saved manager focus loaded." : "Draft plan ready.");
  const [focusDimension, setFocusDimension] = useState<RubricKey>(managerSession?.focusDimension || suggestedFocusDimension);
  const [actionText, setActionText] = useState(managerSession?.actionText || suggestedActionText);
  const [whyItMatters, setWhyItMatters] = useState(managerSession?.whyItMatters || rep.focusRationale);
  const [managerNote, setManagerNote] = useState(managerSession?.managerNote || "");
  const teamComparison = Number((rep.averageScore - data.teamAverage).toFixed(1));
  const outcomeTrend =
    rep.outcomes.won > rep.outcomes.lost
      ? "More won than lost"
      : rep.outcomes.lost > rep.outcomes.won
        ? "Losses outpacing wins"
        : rep.outcomes.open > 0
          ? "Pipeline still open"
          : "Early outcome sample";
  const evidenceCalls = data.calls.filter((call) => call.repId === rep.id || call.repName === rep.name).slice(0, 3);
  const focusDecision =
    managerSession?.focusDecision ||
    (focusDimension === suggestedFocusDimension && normalizeText(actionText) === normalizeText(suggestedActionText) ? "accepted" : "edited");
  return (
    <div className="page-section">
      <section className="card rep-coach-hero accent-report">
        <div>
          <div className="eyebrow">Manager coaching prep</div>
          <h2>{rep.name}</h2>
          <p className="muted">
            Prepare the next 1:1 around the evidence that matters: dimension movement, team comparison, compliance risk,
            and one assigned behavior.
          </p>
        </div>
        <div className="rep-prep-metrics">
          <div className="metric-card mini">
            <div className="metric-label">Rep score</div>
            <div className="metric-value">{formatScore(rep.averageScore)}</div>
          </div>
          <div className="metric-card mini">
            <div className="metric-label">Vs team</div>
            <div className={teamComparison >= 0 ? "metric-value good" : "metric-value risk"}>
              {teamComparison >= 0 ? "+" : ""}
              {formatScore(teamComparison)}
            </div>
          </div>
          <div className="metric-card mini">
            <div className="metric-label">Risk</div>
            <div className={rep.complianceFlags > 5 ? "metric-value risk" : "metric-value good"}>{rep.complianceFlags}</div>
          </div>
        </div>
      </section>

      <section className="card prep-brief accent-focus">
        <div>
          <div className="eyebrow">1:1 brief</div>
          <h2>What changed, what regressed, what to coach</h2>
        </div>
        <div className="brief-grid">
          <article>
            <span className="badge good">Changed</span>
            <strong>{titleCaseDimension(rep.strongestDimension)} is the current strength.</strong>
          </article>
          <article>
            <span className="badge risk">Regressed</span>
            <strong>{titleCaseDimension(rep.weakestScoreDimension)} is the lowest score category.</strong>
          </article>
          <article>
            <span className="badge risk">Risk</span>
            <strong>{rep.complianceFlags} compliance flags need review.</strong>
          </article>
          <article>
            <span className="badge info">Evidence</span>
            <strong>{evidenceCalls.length} recent calls support this 1:1.</strong>
          </article>
          <article>
            <span className="badge amber">Outcomes</span>
            <strong>
              {rep.outcomes.won} won, {rep.outcomes.lost} lost, {rep.outcomes.open} open, {rep.outcomes.noDecision} no-decision.
            </strong>
          </article>
        </div>
      </section>

      <div className="manager-prep-grid">
        <section className="card panel accent-focus">
          <div className="panel-header">
            <div>
              <div className="eyebrow">1:1 agenda</div>
              <h2>Manager actions</h2>
            </div>
            <MessageSquareText size={20} color="#1d7f74" />
          </div>
          <div className="agenda-list">
            <div className="action-item state-focus">
              <div className="action-meta">
                <span className="badge">{focusDecision === "accepted" ? "Accepted focus" : "Edited focus"}</span>
                <span>{titleCaseDimension(focusDimension)}</span>
              </div>
              <h3>{actionText}</h3>
              <p className="muted">{whyItMatters}</p>
            </div>
            <div className="action-item state-risk">
              <div className="action-meta">
                <span className="badge risk">Compliance</span>
                <span>{rep.complianceFlags} flags</span>
              </div>
              <h3>Confirm lender, approval, funding, rate, and 0% language.</h3>
              <p className="muted">Use the checklist before discussing offer mechanics or payments.</p>
            </div>
          </div>
          <div className="manager-focus-form">
            <label className="feedback-label">
              <span>Focus dimension</span>
              <select className="input" value={focusDimension} onChange={(event) => setFocusDimension(event.target.value as RubricKey)}>
                {rubricKeys.map((key) => (
                  <option key={key} value={key}>
                    {titleCaseDimension(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="feedback-label">
              <span>Assigned next-call behavior</span>
              <textarea className="feedback-textarea" rows={3} value={actionText} onChange={(event) => setActionText(event.target.value)} />
            </label>
            <label className="feedback-label">
              <span>Why it matters</span>
              <textarea className="feedback-textarea" rows={3} value={whyItMatters} onChange={(event) => setWhyItMatters(event.target.value)} />
            </label>
            <label className="feedback-label">
              <span>Manager note</span>
              <textarea
                className="feedback-textarea"
                rows={3}
                value={managerNote}
                onChange={(event) => setManagerNote(event.target.value)}
                placeholder="Optional: note how the rep should practice this before the next 1:1."
              />
            </label>
            <div className="insight-strip card" aria-label="Focus decision summary">
              <span>
                <strong>{titleCaseDimension(suggestedFocusDimension)}</strong>
                <small>AI suggested focus</small>
              </span>
              <span>
                <strong>{focusDecision === "accepted" ? "Accepted" : "Edited"}</strong>
                <small>manager decision</small>
              </span>
              <span>
                <strong>{prepState}</strong>
                <small>current session status</small>
              </span>
            </div>
          </div>
          <div className="detail-actions">
            <button
              className="button"
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await markOneOnOnePreparedAction({
                    repId: rep.id,
                    focusDimension,
                    actionText,
                    whyItMatters,
                    managerNote,
                    suggestedFocusDimension,
                    suggestedActionText
                  });
                  setActionMessage(result.message);
                  if (result.ok) setPrepState("prepared");
                })
              }
            >
              {isPending ? "Saving..." : prepState === "prepared" || prepState === "assigned" ? "1:1 prepared" : "Mark 1:1 prepared"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={isPending}
              onClick={() => {
                setFocusDimension(suggestedFocusDimension);
                setActionText(suggestedActionText);
                setWhyItMatters(rep.focusRationale);
              }}
            >
              Reset to suggested focus
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await assignFocusAction({
                    repId: rep.id,
                    focusDimension,
                    actionText,
                    whyItMatters,
                    managerNote,
                    suggestedFocusDimension,
                    suggestedActionText
                  });
                  setActionMessage(result.message);
                  if (result.ok) setPrepState("assigned");
                })
              }
            >
              {isPending ? "Saving..." : prepState === "assigned" ? "Focus assigned" : focusDecision === "accepted" ? "Assign accepted focus" : "Assign edited focus"}
            </button>
          </div>
          <p className="status-note" role="status">
            {actionMessage}
          </p>
          <div className="coach-plan">
            <div className="metric-label">Manager-only plan</div>
            <p><strong>Practice prompt:</strong> {actionText}</p>
            <p><strong>Success signal:</strong> Next two calls improve {titleCaseDimension(focusDimension).toLowerCase()} before pricing or product language.</p>
            <p><strong>Follow-up:</strong> Recheck in the next weekly summary.</p>
          </div>
        </section>

        <DimensionTrends
          scores={rep.scores}
          mode="manager"
          title="Rep dimension movement"
          subtitle="Filter the review window and look for trained behaviors that are improving, flat, or retroceding before setting the next 1:1 focus."
          history={data.dimensionTrends}
        />

        <section className="card panel accent-progress">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Trend</div>
              <h2>Score movement</h2>
            </div>
            <Target size={20} color="#1d7f74" />
          </div>
          <ScoreTrend data={data.scoreTrend} />
        </section>

        <section className="card panel accent-progress">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Outcome pattern</div>
              <h2>CRM and call outcome signal</h2>
            </div>
            <span className="metric-pill">{formatPercent(rep.outcomes.winRate)} won rate</span>
          </div>
          <div className="brief-grid">
            <article>
              <span className="badge good">Won</span>
              <strong>{rep.outcomes.won} calls tied to won opportunities.</strong>
            </article>
            <article>
              <span className="badge risk">Lost</span>
              <strong>{rep.outcomes.lost} calls tied to lost opportunities.</strong>
            </article>
            <article>
              <span className="badge info">Open</span>
              <strong>{rep.outcomes.open} opportunities still remain open.</strong>
            </article>
            <article>
              <span className="badge amber">No decision</span>
              <strong>{rep.outcomes.noDecision} calls ended with no-decision signal.</strong>
            </article>
          </div>
          <p className="muted" style={{ marginTop: 16 }}>
            {outcomeTrend}. Use this with the score trend to separate weak-process losses from open pipeline and stalled decisions.
          </p>
        </section>

        {latestSummary ? (
          <section className="card panel accent-progress">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Latest summary</div>
                <h2>Manager summary feedback</h2>
              </div>
            </div>
            <div className="action-item state-progress">
              <div className="action-meta">
                <span className="badge">{latestSummary.periodType}</span>
                <span>{formatScore(latestSummary.averageScore)}</span>
              </div>
              <h3>{latestSummary.primaryFocus}</h3>
              <p className="muted">{latestSummary.nextCallFocus}</p>
            </div>
            <FeedbackPanel
              entityType="summary"
              entityId={latestSummary.id}
              repId={latestSummary.repId}
              currentUserId={data.currentUser.id}
              currentUserName={data.currentUser.displayName}
              currentUserRole={data.currentUser.role}
              feedback={latestSummary.feedback}
              feedbackStorageReady={data.feedbackStorageReady}
              feedbackStorageMessage={data.feedbackStorageMessage}
              title="Summary feedback"
              subtitle="Record whether the summary focus was useful before the rep sees the next coaching loop."
            />
          </section>
        ) : null}

        <section className="card panel accent-risk">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Risk note</div>
              <h2>Manager watch area</h2>
            </div>
            <ShieldAlert size={20} color="#c68122" />
          </div>
          <p>
            {rep.name} should focus on {titleCaseDimension(focusDimension).toLowerCase()}. {actionText}
          </p>
        </section>
      </div>

      <CoachingFocus opportunity={data.teamOpportunity} actions={data.actions} mode="manager" />
      <TargetStrip reps={data.reps} targets={data.targets} />
      <section className="card panel accent-report">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Team comparison</div>
            <h2>Dimension gap to team average</h2>
          </div>
          <span className="metric-pill">Per-dimension context</span>
        </div>
        <div className="dimension-matrix">
          {rubricKeys.map((key) => {
            const team = data.categoryAverages[key];
            const gap = rep.scores[key] - team;
            return (
              <article key={key} className={`matrix-row ${gap >= 0 ? "state-progress" : "state-risk"}`}>
                <span>
                  <strong>{titleCaseDimension(key)}</strong>
                  <small>{gap >= 0 ? "Ahead of team" : "Behind team"}</small>
                </span>
                <span>{formatScore(team)}</span>
                <span className={gap >= 0 ? "good" : "risk"}>{gap >= 0 ? "+" : ""}{formatScore(gap)}</span>
                <span>{formatScore(rep.scores[key])}</span>
              </article>
            );
          })}
        </div>
      </section>
      <div className="section-divider">
        <div>
          <div className="eyebrow">Supporting evidence</div>
          <h2>Calls behind the coaching plan</h2>
        </div>
      </div>
      <details className="evidence-disclosure">
        <summary>
          <span>Open supporting call evidence</span>
          <small>{data.calls.length} scored calls available</small>
        </summary>
        <CallsBrowser
          calls={data.calls}
          currentUserId={data.currentUser.id}
          currentUserName={data.currentUser.displayName}
          currentUserRole={data.currentUser.role}
          feedbackStorageReady={data.feedbackStorageReady}
          feedbackStorageMessage={data.feedbackStorageMessage}
        />
      </details>
    </div>
  );
}
