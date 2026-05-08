"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Bot, Download, Eye, FileText, RefreshCw, Send, Workflow } from "lucide-react";
import { recordReportEventAction } from "@/app/actions";
import { MetricCard } from "./app-shell";
import { formatDate, formatDateTime } from "@/lib/format";
import type { DashboardData, PeriodType, PipelineIncident, PipelineIncidentSeverity } from "@/lib/types";

export function ReportsWorkspace({ data }: { data: DashboardData }) {
  const [isPending, startTransition] = useTransition();
  const [period, setPeriod] = useState<PeriodType | "all">("all");
  const [owner, setOwner] = useState("all");
  const [status, setStatus] = useState<"all" | "pdf" | "markdown">("all");
  const [actionMessage, setActionMessage] = useState("Reports are current.");
  const reports = useMemo(
    () =>
      data.reports.filter((report) => {
        const periodMatch = period === "all" || report.periodType === period;
        const ownerMatch = owner === "all" || report.owner === owner;
        const statusMatch = status === "all" || (status === "pdf" ? Boolean(report.storagePath) : !report.storagePath);
        return periodMatch && ownerMatch && statusMatch;
      }),
    [data.reports, owner, period, status]
  );
  const owners = Array.from(new Set(data.reports.map((report) => report.owner)));

  function reportPdfHref(report: DashboardData["reports"][number]) {
    if (!report.storagePath) return null;
    return `/api/reports/pdf?id=${encodeURIComponent(report.id)}&path=${encodeURIComponent(report.storagePath)}`;
  }

  function recordEvent(reportId: string | undefined, eventType: "regenerate_requested" | "send_requested", message: string) {
    startTransition(async () => {
      const result = await recordReportEventAction({ reportId, eventType, message });
      setActionMessage(result.message);
    });
  }

  const latestGradeRun = data.monitoring.latestGradeRun;

  return (
    <section className="reports-workspace">
      <div className="card report-hero accent-report">
        <div>
          <div className="eyebrow">Artifact management</div>
          <h2>Open, export, regenerate, or send coaching reports</h2>
          <p className="muted">Reports are operational artifacts with audience, status, export history, and change context.</p>
        </div>
        <div className="report-hero-aside">
          <div className="report-actions">
            <button
              className="button"
              type="button"
              disabled={isPending}
              onClick={() => recordEvent(undefined, "regenerate_requested", "Regenerate latest coaching report packet.")}
            >
              <RefreshCw size={15} />
              {isPending ? "Saving..." : "Regenerate latest"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={isPending}
              onClick={() => recordEvent(undefined, "send_requested", "Send latest coaching report packet when delivery is configured.")}
            >
              <Send size={15} />
              Send packet
            </button>
          </div>
          <div className="report-status-row">
            <span className={data.monitoring.openIncidents > 0 ? "badge risk" : "badge good"}>
              <AlertTriangle size={13} />
              {data.monitoring.openIncidents} open incidents
            </span>
            <span className="badge info">
              <Workflow size={13} />
              {data.monitoring.failedJobs} failed jobs / 7d
            </span>
          </div>
          <p className="status-note" role="status">{actionMessage}</p>
        </div>
      </div>
      {!reports.length ? (
        <div className="card wide-panel state-panel">
          <div className="eyebrow">No reports</div>
          <h2>No report artifacts match these filters</h2>
          <p className="muted" style={{ marginTop: 8 }}>Broaden the period, owner, or status filters to restore the artifact history.</p>
        </div>
      ) : null}

      <section className="card panel accent-risk">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Operations</div>
            <h2>Pipeline and delivery visibility</h2>
          </div>
          <span className="metric-pill">Existing tables only</span>
        </div>
        <div className="metric-grid ops-metric-grid">
          <MetricCard label="Open incidents" value={String(data.monitoring.openIncidents)} note="Recent failures plus latest grading coverage gap" tone="risk" />
          <MetricCard label="Failed jobs" value={String(data.monitoring.failedJobs)} note="`pipeline_jobs` failures in the last 7 days" tone="risk" />
          <MetricCard label="Slack failures" value={String(data.monitoring.failedSlackSends)} note="`delivery_events` Slack sends marked failed" tone="report" />
          <MetricCard label="API/model errors" value={String(data.monitoring.modelApiErrors)} note="Recent errors mentioning provider, API, or model failures" tone="admin" />
        </div>
      </section>

      <div className="ops-grid">
        <section className="card panel accent-report">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Latest grading pass</div>
              <h2>{latestGradeRun ? "Coverage and skip signals" : "No grading job recorded yet"}</h2>
            </div>
            <Bot size={20} color="#245a8d" />
          </div>
          {latestGradeRun ? (
            <>
              <div className="action-item state-progress">
                <div className="action-meta">
                  <span className={statusBadgeClass(latestGradeRun.status)}>{latestGradeRun.status}</span>
                  <span className="muted">{formatDateTime(latestGradeRun.occurredAt)}</span>
                </div>
                <strong>{latestGradeRun.provider || "Unknown provider"}</strong>
                <p className="muted">
                  {latestGradeRun.windowStart && latestGradeRun.windowEnd
                    ? `${latestGradeRun.windowStart} to ${latestGradeRun.windowEnd}`
                    : "Latest grade_calls job did not store a window."}
                </p>
              </div>
              <div className="artifact-meta ops-coverage-grid">
                <span>
                  <strong>Pulled</strong>
                  <small>{latestGradeRun.pulledCalls} calls fetched from source</small>
                </span>
                <span>
                  <strong>Sales-filtered</strong>
                  <small>{latestGradeRun.salesFilteredCalls} passed sales filtering</small>
                </span>
                <span>
                  <strong>Graded</strong>
                  <small>{latestGradeRun.newlyGradedCalls} newly scored in this pass</small>
                </span>
                <span>
                  <strong>Pre-grade skipped</strong>
                  <small>{latestGradeRun.preGradeSkippedCalls} missing transcript or non-substantive signals</small>
                </span>
                <span>
                  <strong>Already graded</strong>
                  <small>{latestGradeRun.skippedAlreadyGraded} substantive calls deduped</small>
                </span>
                <span>
                  <strong>Substantive</strong>
                  <small>{latestGradeRun.substantiveConnectedCalls} met grading threshold</small>
                </span>
              </div>
              <p className="status-note">
                Pre-grade skipped is inferred from `sales_filtered_calls - substantive_connected_calls`, so it captures missing transcripts,
                short calls, disconnected calls, and similar non-substantive states without separating them further.
              </p>
            </>
          ) : (
            <p className="muted">Run the grading pipeline once with DB logging enabled to populate `pipeline_jobs` visibility here.</p>
          )}
        </section>

        <section className="card panel accent-risk">
          <div className="panel-header">
            <div>
              <div className="eyebrow">Incident feed</div>
              <h2>Recent failures and coverage gaps</h2>
            </div>
            <AlertTriangle size={20} color="#c68122" />
          </div>
          <div className="summary-list">
            {data.monitoring.incidents.length ? (
              data.monitoring.incidents.map((incident) => <IncidentCard key={incident.id} incident={incident} />)
            ) : (
              <div className="action-item state-progress">
                <strong>No recent failures recorded.</strong>
                <p className="muted" style={{ marginTop: 6 }}>This view will populate as `pipeline_jobs`, `ingestion_runs`, and `delivery_events` record failures.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="card panel accent-report">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Report history</div>
            <h2>Generation and send timeline</h2>
          </div>
          <span className="metric-pill">Operational continuity</span>
        </div>
        <div className="timeline-list">
          {data.reports.slice(0, 4).map((report) => (
            <div key={`${report.id}-timeline`} className="timeline-item static">
              <span className="timeline-marker" />
              <span>
                <strong>{report.title}</strong>
                <small>{report.storagePath ? "PDF generated and ready to send" : "Markdown generated, PDF pending"} - {formatDateTime(report.createdAt)}</small>
              </span>
              <span className={report.storagePath ? "badge info" : "badge amber"}>{report.periodType}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="call-toolbar card">
        <select className="input" value={period} onChange={(event) => setPeriod(event.target.value as PeriodType | "all")} aria-label="Filter reports by period">
          <option value="all">All periods</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
        </select>
        <select className="input" value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Filter reports by owner">
          <option value="all">All owners</option>
          {owners.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value as "all" | "pdf" | "markdown")} aria-label="Filter reports by status">
          <option value="all">All statuses</option>
          <option value="pdf">PDF ready</option>
          <option value="markdown">Markdown only</option>
        </select>
        <span className="metric-pill">{reports.length} reports</span>
      </div>

      <div className="report-grid">
        {reports.map((report) => {
          const pdfHref = reportPdfHref(report);
          return (
          <article key={report.id} className="card report-card accent-report">
            <div className="action-meta">
              <span className="badge info">{report.periodType}</span>
              <span className={report.storagePath ? "badge good" : "badge amber"}>{report.storagePath ? "PDF ready" : "Markdown only"}</span>
            </div>
            <FileText size={22} color="#1d7f74" />
            <h3>{report.title}</h3>
            <p className="muted">
              {report.owner} - {formatDate(report.periodStart)} to {formatDate(report.periodEnd)}
            </p>
            <div className="artifact-preview">
              <strong>What changed</strong>
              <p className="muted">{report.contentPreview || "No report preview is stored for this artifact yet."}</p>
            </div>
            <div className="artifact-meta">
              <span><strong>Audience</strong><small>{report.owner === "Team" ? "Managers" : "Rep + manager"}</small></span>
              <span><strong>Generated</strong><small>{formatDateTime(report.createdAt)}</small></span>
              <span><strong>Status</strong><small>{report.storagePath ? "Generated" : "Needs export"}</small></span>
            </div>
            <div className="detail-actions">
              {pdfHref ? (
                <a className="button secondary" href={pdfHref} target="_blank" rel="noreferrer">
                  <Eye size={15} />
                  Open
                </a>
              ) : (
                <button className="button secondary" type="button" disabled>
                  <Eye size={15} />
                  Open
                </button>
              )}
              {pdfHref ? (
                <a className="button secondary" href={`${pdfHref}&download=1`}>
                  <Download size={15} />
                  PDF
                </a>
              ) : (
                <button className="button secondary" type="button" disabled>
                  <Download size={15} />
                  PDF
                </button>
              )}
              <button
                className="button secondary"
                type="button"
                disabled={isPending}
                onClick={() => recordEvent(report.id, "regenerate_requested", `Regenerate ${report.title}.`)}
              >
                <RefreshCw size={15} />
                Regenerate
              </button>
            </div>
          </article>
        );})}
      </div>
    </section>
  );
}

function IncidentCard({ incident }: { incident: PipelineIncident }) {
  return (
    <article className={`action-item ${incidentStateClass(incident.severity)}`}>
      <div className="action-meta">
        <span className={severityBadgeClass(incident.severity)}>{incident.source.replace(/_/g, " ")}</span>
        <span className={statusBadgeClass(incident.status)}>{incident.status}</span>
      </div>
      <h3>{incident.title}</h3>
      <p className="muted" style={{ marginTop: 6 }}>{incident.detail}</p>
      <div className="ops-meta-list">
        <span>{formatDateTime(incident.occurredAt)}</span>
        {incident.meta.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </article>
  );
}

function severityBadgeClass(severity: PipelineIncidentSeverity) {
  if (severity === "critical") return "badge risk";
  if (severity === "warning") return "badge amber";
  return "badge info";
}

function incidentStateClass(severity: PipelineIncidentSeverity) {
  if (severity === "critical") return "state-risk";
  if (severity === "warning") return "state-warning";
  return "state-progress";
}

function statusBadgeClass(status: string) {
  if (status === "failed") return "badge risk";
  if (status === "sent" || status === "succeeded") return "badge good";
  if (status === "observed" || status === "running") return "badge info";
  return "badge amber";
}
