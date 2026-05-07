"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, Eye, FileText, RefreshCw, Send } from "lucide-react";
import { recordReportEventAction } from "@/app/actions";
import { formatDate } from "@/lib/format";
import type { DashboardData, PeriodType } from "@/lib/types";

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

  return (
    <section className="reports-workspace">
      <div className="card report-hero">
        <div>
          <div className="eyebrow">Artifact management</div>
          <h2>Open, export, regenerate, or send coaching reports</h2>
          <p className="muted">Reports are operational artifacts with audience, status, export history, and change context.</p>
        </div>
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
        <p className="status-note" role="status">{actionMessage}</p>
        {!reports.length ? (
          <div className="card wide-panel state-panel">
            <div className="eyebrow">No reports</div>
            <h2>No report artifacts match these filters</h2>
            <p className="muted" style={{ marginTop: 8 }}>Broaden the period, owner, or status filters to restore the artifact history.</p>
          </div>
        ) : null}
      </div>
      <section className="card panel">
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
                <small>{report.storagePath ? "PDF generated and ready to send" : "Markdown generated, PDF pending"}</small>
              </span>
              <span className={report.storagePath ? "badge" : "badge amber"}>{report.periodType}</span>
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
          <article key={report.id} className="card report-card">
            <div className="action-meta">
              <span className="badge">{report.periodType}</span>
              <span className={report.storagePath ? "badge" : "badge amber"}>{report.storagePath ? "PDF ready" : "Markdown only"}</span>
            </div>
            <FileText size={22} color="#1d7f74" />
            <h3>{report.title}</h3>
            <p className="muted">
              {report.owner} - {formatDate(report.periodStart)} to {formatDate(report.periodEnd)}
            </p>
            <div className="artifact-preview">
              <strong>What changed</strong>
              <p className="muted">Quantification remains the primary coaching theme; compliance language is queued for manager review before send.</p>
            </div>
            <div className="artifact-meta">
              <span><strong>Audience</strong><small>{report.owner === "Team" ? "Managers" : "Rep + manager"}</small></span>
              <span><strong>Last export</strong><small>{report.storagePath ? "Today, 8:30 AM" : "Pending PDF"}</small></span>
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
