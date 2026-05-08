"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Star } from "lucide-react";
import { saveCoachingFeedbackAction } from "@/app/actions";
import { formatDate } from "@/lib/format";
import type { CoachingFeedback, FeedbackEntityType, UserRole } from "@/lib/types";

type FeedbackPanelProps = {
  entityType: FeedbackEntityType;
  entityId: string;
  repId?: string | null;
  currentUserId: string;
  currentUserName: string;
  currentUserRole: UserRole;
  feedback: CoachingFeedback[];
  feedbackStorageReady: boolean;
  feedbackStorageMessage?: string;
  title?: string;
  subtitle?: string;
};

export function FeedbackPanel({
  entityType,
  entityId,
  repId,
  currentUserId,
  currentUserName,
  currentUserRole,
  feedback,
  feedbackStorageReady,
  feedbackStorageMessage,
  title = "Feedback loop",
  subtitle = "Capture whether this coaching output was useful and what should change next time."
}: FeedbackPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const existingFeedback = useMemo(
    () =>
      feedback.find(
        (entry) =>
          (entry.actorUserId && entry.actorUserId === currentUserId) ||
          (!entry.actorUserId && entry.actorRole === currentUserRole && entry.actorName === currentUserName)
      ),
    [currentUserId, currentUserName, currentUserRole, feedback]
  );
  const [usefulnessRating, setUsefulnessRating] = useState(existingFeedback?.usefulnessRating || 4);
  const [feedbackText, setFeedbackText] = useState(existingFeedback?.feedbackText || "");
  const [statusMessage, setStatusMessage] = useState(
    feedbackStorageReady ? "Usefulness rating and notes are ready." : feedbackStorageMessage || "Feedback storage is not ready yet."
  );

  function saveFeedback() {
    startTransition(async () => {
      const result = await saveCoachingFeedbackAction({
        entityType,
        entityId,
        repId,
        usefulnessRating,
        feedbackText
      });
      setStatusMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <section className="feedback-panel">
      <div className="feedback-panel-header">
        <div>
          <div className="eyebrow">{title}</div>
          <h3>{subtitle}</h3>
        </div>
        <MessageSquareText size={18} color="#1d7f74" />
      </div>

      <div className="rating-row" aria-label="Usefulness rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            className={`rating-chip ${usefulnessRating === value ? "active" : ""}`}
            type="button"
            onClick={() => setUsefulnessRating(value)}
            disabled={!feedbackStorageReady || isPending}
            aria-pressed={usefulnessRating === value}
          >
            <Star size={14} />
            {value}
          </button>
        ))}
      </div>

      <label className="feedback-label">
        <span>What should stay the same or change?</span>
        <textarea
          className="feedback-textarea"
          value={feedbackText}
          onChange={(event) => setFeedbackText(event.target.value)}
          rows={4}
          placeholder={currentUserRole === "manager" ? "Example: tighten the focus recommendation and reduce generic copy." : "Example: this summary was useful, but I need a clearer practice drill."}
          disabled={!feedbackStorageReady || isPending}
        />
      </label>

      <div className="detail-actions">
        <button className="button" type="button" onClick={saveFeedback} disabled={!feedbackStorageReady || isPending}>
          {isPending ? "Saving..." : existingFeedback ? "Update feedback" : "Save feedback"}
        </button>
      </div>
      <p className="status-note" role="status">
        {statusMessage}
      </p>

      {feedback.length ? (
        <div className="feedback-list">
          {feedback.slice(0, 4).map((entry) => (
            <article key={entry.id} className="feedback-entry">
              <div className="action-meta">
                <span className="badge">{entry.actorRole}</span>
                <span>{entry.actorName}</span>
                <span className="muted">{formatDate(entry.createdAt)}</span>
              </div>
              <strong>{entry.usefulnessRating}/5 useful</strong>
              <p className="muted">{entry.feedbackText || "No additional notes."}</p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
