"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarRange, Clock, Target } from "lucide-react";
import { formatDate, formatScore, titleCaseDimension } from "@/lib/format";
import { rubricKeys, type CoachingSummary, type PeriodType, type RepPerformance, type RubricKey } from "@/lib/types";

const periods: PeriodType[] = ["daily", "weekly", "monthly", "quarterly"];

export function SummariesWorkspace({ summaries, reps }: { summaries: CoachingSummary[]; reps: RepPerformance[] }) {
  const [period, setPeriod] = useState<PeriodType>("daily");
  const visible = useMemo(() => summaries.filter((summary) => summary.periodType === period), [period, summaries]);
  const latest = visible[0] || summaries[0];
  const rep = reps.find((item) => item.id === latest?.repId) || reps[0];
  const targetDimension = latest?.primaryFocusDimension || rep?.primaryFocusDimension || "quantification";
  const previous = latest
    ? visible.find((summary) => summary.repId === latest.repId && summary.id !== latest.id) ||
      summaries.find((summary) => summary.repId === latest.repId && summary.id !== latest.id)
    : undefined;
  const previousScore = previous?.averageScore ?? latest?.averageScore ?? 0;
  const delta = latest ? latest.averageScore - previousScore : 0;
  const dimensionRows = rep
    ? rubricKeys.map((key) => {
        const current = latest?.dimensionAverages?.[key] ?? rep.scores[key];
        const prior = previous?.dimensionAverages?.[key] ?? current;
        return { key, current, prior, delta: Number((current - prior).toFixed(1)) };
      })
    : [];
  const strongest = dimensionRows.slice().sort((a, b) => b.delta - a.delta)[0];
  const weakest = dimensionRows.slice().sort((a, b) => a.delta - b.delta)[0];

  return (
    <section className="summary-workspace">
      <div className="card progress-hero">
        <div>
          <div className="eyebrow">Progress history</div>
          <h2>{latest ? `${latest.repName}'s ${period} coaching summary` : "No summaries yet"}</h2>
          <p className="muted">
            Compare dimension movement by period, identify regressions, and decide the next checkpoint before the next call block.
          </p>
        </div>
        <div className="progress-metrics">
          <div className="metric-card mini">
            <div className="metric-label">Current</div>
            <div className="metric-value">{latest ? formatScore(latest.averageScore) : "0.0"}</div>
          </div>
          <div className="metric-card mini">
            <div className="metric-label">Delta</div>
            <div className={delta >= 0 ? "metric-value good" : "metric-value risk"}>
              {delta >= 0 ? "+" : ""}
              {formatScore(delta)}
            </div>
          </div>
          <div className="metric-card mini">
            <div className="metric-label">Calls</div>
            <div className="metric-value">{latest?.callsGraded || 0}</div>
          </div>
        </div>
      </div>

      <div className="segmented-control" aria-label="Summary period">
        {periods.map((item) => (
          <button key={item} className={period === item ? "active" : ""} type="button" onClick={() => setPeriod(item)}>
            {item}
          </button>
        ))}
      </div>

      <div className="insight-strip card" aria-label="Summary movement highlights">
        <span>
          <strong>{strongest ? titleCaseDimension(strongest.key) : "No movement"}</strong>
          <small>strongest improvement</small>
        </span>
        <span>
          <strong>{weakest ? titleCaseDimension(weakest.key) : "No regression"}</strong>
          <small>biggest regression</small>
        </span>
        <span>
          <strong>{latest ? formatDate(latest.periodEnd) : "Next run"}</strong>
          <small>next checkpoint</small>
        </span>
      </div>

      <div className="summary-grid">
        <div className="card panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Timeline</div>
              <h2>{period[0].toUpperCase() + period.slice(1)} coaching records</h2>
            </div>
            <CalendarRange size={20} color="#1d7f74" />
          </div>
          <div className="timeline-list">
            {visible.map((summary, index) => {
              const prior = visible[index + 1]?.averageScore ?? summary.averageScore;
              const change = summary.averageScore - prior;
              return (
              <button key={summary.id} className="timeline-item" type="button">
                <span className="timeline-marker" />
                <span>
                  <strong>{summary.repName}</strong>
                  <small>
                    {formatDate(summary.periodStart)} to {formatDate(summary.periodEnd)}
                  </small>
                  <small>{summary.callsGraded} calls - {change >= 0 ? "+" : ""}{formatScore(change)} vs prior</small>
                </span>
                <span className={index % 2 === 0 ? "badge" : "badge amber"}>
                  {formatScore(summary.averageScore)}
                </span>
              </button>
            );})}
            {!visible.length ? <p className="muted">No {period} summaries are available yet.</p> : null}
          </div>
        </div>

        <div className="card panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Summary detail</div>
              <h2>What changed</h2>
            </div>
            <ArrowUpRight size={20} color="#1d7f74" />
          </div>
          {latest ? (
            <div className="summary-detail">
              <div className="action-item">
                <div className="action-meta">
                  <span className="badge">{latest.periodType}</span>
                  <span className="muted">{latest.callsGraded} calls</span>
                </div>
                <h3>{latest.primaryFocus}</h3>
                <p className="muted">{latest.nextCallFocus}</p>
              </div>
              <div className="action-item">
                <div className="action-meta">
                  <span className="badge amber">Target</span>
                  <span>{rep ? formatScore(rep.scores[targetDimension]) : "0.0"} / 7.0</span>
                </div>
                <h3>{rep ? titleCaseDimension(targetDimension) : "Quantification"}</h3>
                <div className="score-bar" role="meter" aria-label="Target progress" aria-valuemin={0} aria-valuemax={7} aria-valuenow={rep ? Number(rep.scores[targetDimension].toFixed(1)) : 0}>
                  <span style={{ width: `${rep ? Math.min(100, (rep.scores[targetDimension] / 7) * 100) : 0}%` }} />
                </div>
              </div>
              <div className="next-steps">
                <span>
                  <Target size={15} />
                  {latest.nextCallFocus}
                </span>
                <span>
                  <Clock size={15} />
                  Recheck in the next {period} summary.
                </span>
              </div>
            </div>
          ) : (
            <p className="muted">Generate summaries from DB-backed scorecards to populate this panel.</p>
          )}
        </div>
      </div>

      <section className="card panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Dimension history</div>
            <h2>{period[0].toUpperCase() + period.slice(1)} movement matrix</h2>
          </div>
          <span className="metric-pill">Current vs prior</span>
        </div>
        <div className="dimension-matrix">
          {dimensionRows.map((row) => (
            <article key={row.key} className="matrix-row">
              <span>
                <strong>{titleCaseDimension(row.key as RubricKey)}</strong>
                <small>{row.delta < 0 ? "Retroceding" : row.delta > 0 ? "Improving" : "Flat"}</small>
              </span>
              <span>{formatScore(row.prior)}</span>
              <span className={row.delta < 0 ? "risk" : "good"}>{row.delta >= 0 ? "+" : ""}{formatScore(row.delta)}</span>
              <span>{formatScore(row.current)}</span>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
