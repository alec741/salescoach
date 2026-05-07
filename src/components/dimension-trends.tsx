"use client";

import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, TrendingUp } from "lucide-react";
import { formatScore, titleCaseDimension } from "@/lib/format";
import { rubricKeys, type DashboardData, type PeriodType, type RubricKey } from "@/lib/types";

type DimensionSeries = {
  key: RubricKey;
  values: number[];
  delta: number;
  status: "improving" | "flat" | "regressing";
};

function clamp(value: number) {
  return Math.max(1, Math.min(10, value));
}

function buildSeries(
  scores: Record<RubricKey, number>,
  period: PeriodType,
  history?: DashboardData["dimensionTrends"]
): { series: DimensionSeries[]; labels: string[] } {
  const points = history?.[period]?.length
    ? history[period]
    : [
        {
          label: "Current",
          periodType: period,
          periodStart: "current",
          periodEnd: "current",
          scores
        }
      ];
  const labels = points.map((point) => point.label);
  const series = rubricKeys.map((key) => {
    const values = points.map((point) => clamp(point.scores[key] || scores[key] || 0));
    const delta = Number((values[values.length - 1] - values[0]).toFixed(1));
    const status: DimensionSeries["status"] = delta > 0.2 ? "improving" : delta < -0.2 ? "regressing" : "flat";
    return {
      key,
      values,
      delta,
      status
    };
  });
  return { series, labels };
}

function Sparkline({ values, status }: { values: number[]; status: DimensionSeries["status"] }) {
  const width = 160;
  const height = 44;
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
      const y = height - (clamp(value) / 10) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const stroke = status === "regressing" ? "#b94b4b" : status === "flat" ? "#c68122" : "#1d7f74";

  return (
    <svg className="dimension-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusIcon({ status }: { status: DimensionSeries["status"] }) {
  if (status === "improving") return <ArrowUpRight size={14} />;
  if (status === "regressing") return <ArrowDownRight size={14} />;
  return <ArrowRight size={14} />;
}

export function DimensionTrends({
  scores,
  mode = "rep",
  title = "Dimension trends",
  subtitle = "Overall score is a summary. The coaching signal is whether specific trained behaviors are improving, flat, or retroceding.",
  history
}: {
  scores: Record<RubricKey, number>;
  mode?: "rep" | "manager";
  title?: string;
  subtitle?: string;
  history?: DashboardData["dimensionTrends"];
}) {
  const [period, setPeriod] = useState<PeriodType>("weekly");
  const { series, labels } = useMemo(() => buildSeries(scores, period, history), [history, period, scores]);
  const regressing = series.filter((item) => item.status === "regressing");
  const improving = series.filter((item) => item.status === "improving");
  const biggestRegression = series.slice().sort((a, b) => a.delta - b.delta)[0];
  const biggestWin = series.slice().sort((a, b) => b.delta - a.delta)[0];

  return (
    <section className="card panel dimension-panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">{mode === "manager" ? "Manager dimension review" : "Coaching dimension review"}</div>
          <h2>{title}</h2>
          <p className="muted dimension-intro">{subtitle}</p>
        </div>
        <span className="status-pill">
          <TrendingUp size={15} />
          {period}
        </span>
      </div>

      <div className="segmented-control" aria-label="Dimension trend period">
        {(["daily", "weekly", "monthly", "quarterly"] as PeriodType[]).map((item) => (
          <button key={item} className={period === item ? "active" : ""} type="button" onClick={() => setPeriod(item)}>
            {item}
          </button>
        ))}
      </div>

      <div className="insight-strip" aria-label="Dimension movement summary">
        <span>
          <strong>{biggestRegression ? titleCaseDimension(biggestRegression.key) : "No regression"}</strong>
          <small>biggest regression</small>
        </span>
        <span>
          <strong>{biggestWin ? titleCaseDimension(biggestWin.key) : "No improvement"}</strong>
          <small>strongest movement</small>
        </span>
        <span>
          <strong>{labels[0]} to {labels[labels.length - 1]}</strong>
          <small>selected window</small>
        </span>
      </div>

      <div className="dimension-summary-row">
        <span className="badge">{improving.length} improving</span>
        <span className={regressing.length ? "badge amber" : "badge"}>{regressing.length} regressing</span>
        <span className="muted">Range: {labels[0]} to {labels[labels.length - 1]}</span>
      </div>

      <div className="dimension-grid">
        {series.map((item) => (
          <article key={item.key} className={`dimension-card ${item.status}`}>
            <div className="action-meta">
              <span className="metric-label">{titleCaseDimension(item.key)}</span>
              <span className={`dimension-status ${item.status}`}>
                <StatusIcon status={item.status} />
                {item.status}
              </span>
            </div>
            <div className="dimension-score-row">
              <strong>{formatScore(item.values[item.values.length - 1])}</strong>
              <span className={item.delta < 0 ? "risk" : item.delta > 0 ? "good" : "muted"}>
                {item.delta > 0 ? "+" : ""}
                {formatScore(item.delta)}
              </span>
            </div>
            <Sparkline values={item.values} status={item.status} />
            <div className="dimension-label-row">
              <span>{labels[0]}</span>
              <span>{labels[labels.length - 1]}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
