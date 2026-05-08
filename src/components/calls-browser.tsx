"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarDays, CheckCircle2, Copy, Filter, Search, SlidersHorizontal, Target, X } from "lucide-react";
import { markCallReviewedAction } from "@/app/actions";
import { FeedbackPanel } from "./feedback-panel";
import { formatCurrency, formatDate, formatScore, outcomeLabel, titleCaseDimension } from "@/lib/format";
import { rubricKeys, type CallRow, type RubricKey, type UserRole } from "@/lib/types";

type ScoreFilter = "all" | "below6" | "sixToSeven" | "above7";
type ReviewState = "all" | "reviewed" | "open";

function shortId(id: string) {
  if (id.length <= 16) return id;
  return `${id.slice(0, 10)}...${id.slice(-6)}`;
}

function scoreMatches(score: number, filter: ScoreFilter) {
  if (filter === "below6") return score < 6;
  if (filter === "sixToSeven") return score >= 6 && score < 7;
  if (filter === "above7") return score >= 7;
  return true;
}

function readableValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(Boolean).map(readableValue).join(" ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => Boolean(entryValue))
      .map(([key, entryValue]) => `${key.replace(/_/g, " ")}: ${readableValue(entryValue)}`)
      .join(" ");
  }
  return String(value);
}

export function CallsBrowser({
  calls,
  currentUserId,
  currentUserName,
  currentUserRole,
  feedbackStorageReady,
  feedbackStorageMessage
}: {
  calls: CallRow[];
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  feedbackStorageReady: boolean;
  feedbackStorageMessage?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [riskOnly, setRiskOnly] = useState(false);
  const [category, setCategory] = useState<RubricKey | "all">("all");
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>("all");
  const [reviewState, setReviewState] = useState<ReviewState>("all");
  const [selectedId, setSelectedId] = useState(calls[0]?.id || "");
  const [density, setDensity] = useState<"comfortable" | "compact">("compact");
  const [reviewMessage, setReviewMessage] = useState("Review status is ready.");
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set(calls.filter((call) => call.reviewed).map((call) => call.id)));

  function reviewedFor(call: CallRow) {
    return reviewedIds.has(call.id);
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return calls.filter((call) => {
      const matchesQuery =
        !normalized ||
        call.repName.toLowerCase().includes(normalized) ||
        call.closeCallId.toLowerCase().includes(normalized) ||
        (call.callType || "").toLowerCase().includes(normalized) ||
        (call.outcomeType || "").toLowerCase().includes(normalized) ||
        (call.leadSegment || "").toLowerCase().includes(normalized) ||
        (call.crmOutcome?.statusLabel || "").toLowerCase().includes(normalized) ||
        (call.crmOutcome?.pipelineName || "").toLowerCase().includes(normalized) ||
        call.primaryFocus.toLowerCase().includes(normalized) ||
        call.nextCallFocus.toLowerCase().includes(normalized) ||
        call.primaryFocusDimension.toLowerCase().includes(normalized);
      const matchesRisk = !riskOnly || call.complianceFlags.length > 0 || call.overallScore < 6;
      const matchesCategory = category === "all" || call.primaryFocusDimension === category;
      const matchesScore = scoreMatches(call.overallScore, scoreFilter);
      const isReviewed = reviewedIds.has(call.id);
      const matchesReview = reviewState === "all" || (reviewState === "reviewed" ? isReviewed : !isReviewed);
      return matchesQuery && matchesRisk && matchesCategory && matchesScore && matchesReview;
    });
  }, [calls, category, query, reviewState, reviewedIds, riskOnly, scoreFilter]);

  const selected = filtered.find((call) => call.id === selectedId) || filtered[0] || calls[0];
  const riskCount = calls.filter((call) => call.overallScore < 6 || call.complianceFlags.length > 0).length;
  const averageScore = calls.length ? calls.reduce((sum, call) => sum + call.overallScore, 0) / calls.length : 0;
  const activeFilters = [
    riskOnly ? "Risk only" : null,
    category !== "all" ? titleCaseDimension(category) : null,
    scoreFilter !== "all" ? { below6: "Below 6.0", sixToSeven: "6.0 to 6.9", above7: "7.0+" }[scoreFilter] : null,
    reviewState !== "all" ? (reviewState === "open" ? "Needs review" : "Reviewed") : null
  ].filter(Boolean);

  function callReason(call: CallRow) {
    if (call.crmOutcome?.noDecision) return "No decision pattern";
    if (call.crmOutcome?.bucket === "lost") return "Loss review";
    if (call.crmOutcome?.bucket === "won") return "Closed won";
    if (call.complianceFlags.length >= 2) return "Compliance risk";
    if (call.overallScore < 6) return "Regression evidence";
    if (call.primaryFocusDimension === "quantification") return "Target practice";
    return "Recent win";
  }

  async function copyCallId(call: CallRow) {
    try {
      await navigator.clipboard?.writeText(call.closeCallId);
      setReviewMessage("Call ID copied.");
    } catch {
      setReviewMessage(`Copy blocked by browser permissions. Call ID: ${call.closeCallId}`);
    }
  }

  function markReviewed(call: CallRow) {
    startTransition(async () => {
      const result = await markCallReviewedAction(call.id);
      setReviewMessage(result.message);
      if (result.ok) {
        setReviewedIds((current) => new Set(current).add(call.id));
      }
    });
  }

  return (
    <section className="call-workspace">
      <div className="call-hero card accent-report">
        <div>
          <div className="eyebrow">Evidence review</div>
          <h2>Find the call that explains the coaching focus</h2>
          <p className="muted">
            Use this screen to review scored calls, isolate risk, open the coaching readout, and decide the next behavior to
            practice.
          </p>
        </div>
        <div className="call-kpis">
          <span className="status-pill">
            <CheckCircle2 size={15} />
            {filtered.length} shown
          </span>
          <span className="status-pill">
            <Target size={15} />
            {riskCount} risk
          </span>
          <span className="status-pill">{formatScore(averageScore)} avg</span>
        </div>
      </div>

      <div className="call-toolbar card">
        <label className="search-field">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rep, focus, or call ID"
            aria-label="Search calls"
          />
        </label>
        <select className="input" value={category} onChange={(event) => setCategory(event.target.value as RubricKey | "all")} aria-label="Filter by focus category">
          <option value="all">All categories</option>
          {rubricKeys.map((key) => (
            <option key={key} value={key}>
              {titleCaseDimension(key)}
            </option>
          ))}
        </select>
        <select className="input" value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value as ScoreFilter)} aria-label="Filter by score">
          <option value="all">All scores</option>
          <option value="below6">Below 6.0</option>
          <option value="sixToSeven">6.0 to 6.9</option>
          <option value="above7">7.0+</option>
        </select>
        <select className="input" value={reviewState} onChange={(event) => setReviewState(event.target.value as ReviewState)} aria-label="Filter by review status">
          <option value="all">All review states</option>
          <option value="open">Needs review</option>
          <option value="reviewed">Reviewed</option>
        </select>
        <button className={`button ${riskOnly ? "" : "secondary"}`} type="button" onClick={() => setRiskOnly((value) => !value)}>
          <Filter size={15} />
          {riskOnly ? "Risk on" : "Risk only"}
        </button>
        <button className="button secondary" type="button" onClick={() => setDensity((value) => (value === "comfortable" ? "compact" : "comfortable"))}>
          {density === "comfortable" ? "Compact" : "Comfortable"}
        </button>
        <div className="filter-chip-row" aria-label="Active filters">
          {activeFilters.length ? activeFilters.map((filter) => <span key={filter} className="filter-chip">{filter}</span>) : <span className="filter-chip">All calls</span>}
        </div>
      </div>

      {!filtered.length ? (
        <div className="card wide-panel">
          <div className="eyebrow">No matching calls</div>
          <h2>Adjust filters to broaden the review queue</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Try clearing risk-only, category, score, or review-state filters.
          </p>
        </div>
      ) : (
        <div className="call-review-grid">
          <div className="card call-list-panel accent-risk">
            <div className="panel-header compact-header">
              <div>
                <div className="eyebrow">Review queue</div>
                <h2>{filtered.length} call scorecards</h2>
              </div>
              <SlidersHorizontal size={18} color="#66706a" />
            </div>
            <div className="call-card-list">
              {filtered.map((call) => (
                <button
                  key={call.id}
                  className={`call-card ${density === "compact" ? "compact" : ""} ${selected?.id === call.id ? "selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedId(call.id)}
                >
                  <span className="call-card-top">
                    <span>
                      <strong>{formatScore(call.overallScore)}</strong>
                      <span className={call.overallScore < 6 ? "risk score-state" : "good score-state"}>
                        {call.overallScore < 6 ? "Needs lift" : "On track"}
                      </span>
                    </span>
                    <span className={call.complianceFlags.length ? "badge risk" : "badge good"}>
                      {call.complianceFlags.length ? `${call.complianceFlags.length} flags` : "Clear"}
                    </span>
                  </span>
                  <span className="call-card-focus" title={`Lowest score: ${titleCaseDimension(call.weakestScoreDimension)}`}>
                    {titleCaseDimension(call.primaryFocusDimension)}
                  </span>
                  <span className="reason-line">
                    <span className="badge amber">{outcomeLabel(call.outcomeType || "outcome pending")}</span>
                    {call.crmOutcome?.statusLabel ? (
                      <span className={call.crmOutcome.bucket === "won" ? "badge good" : call.crmOutcome.bucket === "lost" ? "badge risk" : "badge info"}>
                        CRM {call.crmOutcome.statusLabel}
                      </span>
                    ) : null}
                    <span className="muted">{(call.callType || "call type pending").replace(/_/g, " ")}</span>
                  </span>
                  <span className="reason-line">
                    <span className={callReason(call) === "Recent win" ? "badge good" : callReason(call) === "Compliance risk" ? "badge risk" : "badge amber"}>{callReason(call)}</span>
                    <span className="muted">{call.nextCallFocus}</span>
                  </span>
                  <span className="call-card-footer">
                    <span>
                      <CalendarDays size={13} />
                      {formatDate(call.activityAt)}
                    </span>
                    <span>{formatScore(call.durationMinutes)} min</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selected ? (
            <div className="card call-detail-panel sticky-detail accent-focus">
              <div className="panel-header">
                <div>
                  <div className="eyebrow">Selected call</div>
                  <h2>{titleCaseDimension(selected.primaryFocusDimension)} coaching review</h2>
                </div>
                <button className="icon-button" type="button" onClick={() => setSelectedId("")} aria-label="Clear selected call">
                  <X size={16} />
                </button>
              </div>

              <div className="detail-score-row">
                <div>
                  <div className="metric-label">Score</div>
                  <div className={selected.overallScore < 6 ? "metric-value risk" : "metric-value good"}>
                    {formatScore(selected.overallScore)}
                  </div>
                </div>
                <div>
                  <div className="metric-label">Duration</div>
                  <div className="metric-value">{formatScore(selected.durationMinutes)}m</div>
                </div>
                <div>
                  <div className="metric-label">Compliance</div>
                  <div className={selected.complianceFlags.length ? "metric-value risk" : "metric-value good"}>
                    {selected.complianceFlags.length}
                  </div>
                </div>
              </div>

              <div className="detail-section">
                <div className="metric-label">Context</div>
                <div className="check-list">
                  <span className="check-item">Type - {(selected.callType || "unknown").replace(/_/g, " ")}</span>
                  <span className="check-item">Outcome - {outcomeLabel(selected.outcomeType || "unknown")}</span>
                  <span className="check-item">Segment - {selected.leadSegment || "unknown"}</span>
                </div>
                {selected.outcomeRationale ? <p className="muted">{selected.outcomeRationale}</p> : null}
              </div>

              {selected.crmOutcome ? (
                <div className="detail-section">
                  <div className="metric-label">CRM outcome</div>
                  <div className="check-list">
                    <span className="check-item">Pipeline - {selected.crmOutcome.pipelineName || "unknown"}</span>
                    <span className="check-item">Status - {selected.crmOutcome.statusLabel || outcomeLabel(selected.crmOutcome.statusType)}</span>
                    <span className="check-item">Value - {formatCurrency(selected.crmOutcome.value)}</span>
                    <span className="check-item">Close date - {selected.crmOutcome.closeDate ? formatDate(selected.crmOutcome.closeDate) : "Open"}</span>
                  </div>
                  <p className="muted">
                    {selected.crmOutcome.noDecision
                      ? "This call was graded as a no-decision even though the CRM opportunity remains unresolved."
                      : selected.crmOutcome.bucket === "won"
                        ? "Opportunity moved to won in CRM."
                        : selected.crmOutcome.bucket === "lost"
                          ? "Opportunity moved to lost in CRM."
                          : "Opportunity is still open in CRM."}
                  </p>
                </div>
              ) : null}

              <div className="detail-section">
                <div className="metric-label">Next-call behavior</div>
                <h3>{selected.nextCallFocus}</h3>
                <p className="muted">{selected.focusRationale}</p>
                <p className="muted">{selected.summary}</p>
              </div>

              {selected.coachableMoment ? (
                <div className="detail-section">
                  <div className="metric-label">Coachable moment</div>
                  <p>{readableValue(selected.coachableMoment)}</p>
                </div>
              ) : null}

              {selected.managerAction ? (
                <div className="detail-section">
                  <div className="metric-label">Manager action</div>
                  <p>{readableValue(selected.managerAction)}</p>
                </div>
              ) : null}

              {selected.successPattern ? (
                <div className="detail-section">
                  <div className="metric-label">Repeatable strength</div>
                  <p>{readableValue(selected.successPattern)}</p>
                </div>
              ) : null}

              <div className="detail-section">
                <div className="metric-label">Practice prompt</div>
                <p>
                  {selected.repPracticeDrill ||
                    "\"Before I show you the options, how many of your last 10 jobs stalled because the customer needed a better payment path?\""}
                </p>
              </div>

              <div className="detail-section">
                <div className="metric-label">Compliance checklist</div>
                <div className="check-list">
                  {["Marketplace, not lender", "Pre-approval vs final approval", "Hard inquiry expectation", "Funds go to customer"].map((item, index) => (
                    <span key={item} className={selected.complianceFlags[index] ? "check-item warn" : "check-item"}>
                      {selected.complianceFlags[index] ? "Review" : "Clear"} - {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="detail-section">
                <FeedbackPanel
                  entityType="scorecard"
                  entityId={selected.scorecardId}
                  repId={selected.repId}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  currentUserRole={currentUserRole}
                  feedback={selected.feedback}
                  feedbackStorageReady={feedbackStorageReady}
                  feedbackStorageMessage={feedbackStorageMessage}
                  title="Scorecard feedback"
                  subtitle="Rate the usefulness of this scorecard and note what should change in future coaching output."
                />
              </div>

              <div className="detail-actions">
                <button className="button" type="button" onClick={() => markReviewed(selected)} disabled={isPending || reviewedFor(selected)}>
                  {reviewedFor(selected) ? "Reviewed" : isPending ? "Saving..." : "Mark reviewed"}
                </button>
                <button className="button secondary" type="button" onClick={() => copyCallId(selected)}>
                  <Copy size={15} />
                  Copy ID
                </button>
              </div>
              <p className="status-note" role="status">{reviewMessage}</p>
              <p className="muted call-id-line">Call ID: {shortId(selected.closeCallId)}</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
