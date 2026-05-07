import { titleCaseDimension, formatScore } from "@/lib/format";
import { rubricKeys, type DashboardData, type RubricKey } from "@/lib/types";

export function ScoreTrend({ data, label = "Coaching score trend" }: { data: DashboardData["scoreTrend"]; label?: string }) {
  const width = 640;
  const height = 192;
  const points = data.map((point, index) => {
    const x = data.length === 1 ? 0 : (index / (data.length - 1)) * width;
    const y = height - (Math.min(10, Math.max(0, point.score)) / 10) * height;
    return `${x},${y}`;
  });

  return (
    <div className="chart">
      <div className="chart-axis">
        <span>10</span>
        <span>7.5</span>
        <span>5</span>
        <span>2.5</span>
        <span>0</span>
      </div>
      <div className="chart-area">
        {[20, 40, 60, 80].map((top) => (
          <span key={top} className="chart-grid-line" style={{ top: `${top}%` }} />
        ))}
        <svg className="trend-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
          <polyline points={points.join(" ")} fill="none" stroke="#1d7f74" strokeWidth="5" strokeLinecap="round" />
          {points.map((point) => {
            const [cx, cy] = point.split(",");
            return <circle key={point} cx={cx} cy={cy} r="5" fill="#1d7f74" />;
          })}
        </svg>
        <div className="chart-labels" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
          {data.map((point) => (
            <span key={point.label}>{point.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CategoryGrid({ scores }: { scores: Record<RubricKey, number> }) {
  return (
    <div className="category-grid">
      {rubricKeys.map((key) => (
        <article key={key} className="category-card">
          <div className="metric-label">{titleCaseDimension(key)}</div>
          <div className="metric-value" style={{ fontSize: 21 }}>
            {formatScore(scores[key])}
          </div>
          <div className="score-bar" role="meter" aria-label={`${titleCaseDimension(key)} score`} aria-valuemin={0} aria-valuemax={10} aria-valuenow={Number(scores[key].toFixed(1))}>
            <span style={{ width: `${Math.max(0, Math.min(100, scores[key] * 10))}%` }} />
          </div>
        </article>
      ))}
    </div>
  );
}
