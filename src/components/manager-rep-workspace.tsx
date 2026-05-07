"use client";

import { useState, useTransition } from "react";
import { MessageSquareText, ShieldAlert, Target } from "lucide-react";
import { assignFocusAction, markOneOnOnePreparedAction } from "@/app/actions";
import { CallsBrowser } from "./calls-browser";
import { ScoreTrend } from "./charts";
import { DimensionTrends } from "./dimension-trends";
import { CoachingFocus, TargetStrip } from "./dashboard";
import { formatScore, titleCaseDimension } from "@/lib/format";
import { rubricKeys, type DashboardData } from "@/lib/types";

export function ManagerRepWorkspace({ data }: { data: DashboardData }) {
  const rep = data.reps[0];
  const [isPending, startTransition] = useTransition();
  const [prepState, setPrepState] = useState<"draft" | "prepared" | "assigned">("draft");
  const [actionMessage, setActionMessage] = useState("Draft plan ready.");
  const teamComparison = Number((rep.averageScore - data.teamAverage).toFixed(1));
  const evidenceCalls = data.calls.filter((call) => call.repId === rep.id || call.repName === rep.name).slice(0, 3);
  return (
    <div className="page-section">
      <section className="card rep-coach-hero">
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

      <section className="card prep-brief">
        <div>
          <div className="eyebrow">1:1 brief</div>
          <h2>What changed, what regressed, what to coach</h2>
        </div>
        <div className="brief-grid">
          <article>
            <span className="badge">Changed</span>
            <strong>{titleCaseDimension(rep.strongestDimension)} is the current strength.</strong>
          </article>
          <article>
            <span className="badge amber">Regressed</span>
            <strong>{titleCaseDimension(rep.weakestScoreDimension)} is the lowest score category.</strong>
          </article>
          <article>
            <span className="badge amber">Risk</span>
            <strong>{rep.complianceFlags} compliance flags need review.</strong>
          </article>
          <article>
            <span className="badge">Evidence</span>
            <strong>{evidenceCalls.length} recent calls support this 1:1.</strong>
          </article>
        </div>
      </section>

      <div className="manager-prep-grid">
        <section className="card panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">1:1 agenda</div>
              <h2>Manager actions</h2>
            </div>
            <MessageSquareText size={20} color="#1d7f74" />
          </div>
          <div className="agenda-list">
            <div className="action-item">
              <div className="action-meta">
                <span className="badge">Assigned focus</span>
                <span>{titleCaseDimension(rep.primaryFocusDimension)}</span>
              </div>
              <h3>{rep.nextCallFocus}</h3>
              <p className="muted">{rep.focusRationale}</p>
            </div>
            <div className="action-item">
              <div className="action-meta">
                <span className="badge amber">Compliance</span>
                <span>{rep.complianceFlags} flags</span>
              </div>
              <h3>Confirm lender, approval, funding, rate, and 0% language.</h3>
              <p className="muted">Use the checklist before discussing offer mechanics or payments.</p>
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
                    focusDimension: rep.primaryFocusDimension,
                    actionText: rep.nextCallFocus
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
              onClick={() =>
                startTransition(async () => {
                  const result = await assignFocusAction({
                    repId: rep.id,
                    focusDimension: rep.primaryFocusDimension,
                    actionText: rep.nextCallFocus,
                    whyItMatters: rep.focusRationale
                  });
                  setActionMessage(result.message);
                  if (result.ok) setPrepState("assigned");
                })
              }
            >
              {isPending ? "Saving..." : prepState === "assigned" ? "Focus assigned" : "Assign focus"}
            </button>
          </div>
          <p className="status-note" role="status">
            {actionMessage}
          </p>
          <div className="coach-plan">
            <div className="metric-label">Manager-only plan</div>
            <p><strong>Practice prompt:</strong> {rep.nextCallFocus}</p>
            <p><strong>Success signal:</strong> Next two calls improve {titleCaseDimension(rep.primaryFocusDimension).toLowerCase()} before pricing or product language.</p>
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

        <section className="card panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Trend</div>
              <h2>Score movement</h2>
            </div>
            <Target size={20} color="#1d7f74" />
          </div>
          <ScoreTrend data={data.scoreTrend} />
        </section>

        <section className="card panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Risk note</div>
              <h2>Manager watch area</h2>
            </div>
            <ShieldAlert size={20} color="#c68122" />
          </div>
          <p>
            {rep.name} should focus on {titleCaseDimension(rep.primaryFocusDimension).toLowerCase()}. {rep.primaryFocus}
          </p>
        </section>
      </div>

      <CoachingFocus opportunity={data.teamOpportunity} actions={data.actions} />
      <TargetStrip reps={data.reps} />
      <section className="card panel">
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
              <article key={key} className="matrix-row">
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
        <CallsBrowser calls={data.calls} />
      </details>
    </div>
  );
}
