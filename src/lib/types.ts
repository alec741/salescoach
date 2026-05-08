export const rubricKeys = [
  "opening",
  "qualification",
  "discovery",
  "quantification",
  "solution_to_pain",
  "feature_dump_control",
  "close_or_next_step",
  "compliance"
] as const;

export type RubricKey = (typeof rubricKeys)[number];
export type UserRole = "rep" | "manager" | "admin";
export type PeriodType = "daily" | "weekly" | "monthly" | "quarterly";
export type FeedbackEntityType = "scorecard" | "summary";
export type ManagerSessionStatus = "draft" | "prepared" | "assigned" | "completed";
export type ManagerFocusDecision = "accepted" | "edited";
export type CrmOutcomeBucket = "won" | "lost" | "open" | "unknown";

export type AppUser = {
  id: string;
  authUserId: string | null;
  email: string;
  displayName: string;
  role: UserRole;
  closeUserId: string | null;
  active: boolean;
};

export type CoachingFeedback = {
  id: string;
  entityType: FeedbackEntityType;
  entityId: string;
  actorUserId: string | null;
  actorName: string;
  actorRole: UserRole;
  usefulnessRating: number;
  feedbackText: string;
  createdAt: string;
};

export type ManagerSession = {
  id: string;
  repId: string;
  status: ManagerSessionStatus;
  focusDimension?: RubricKey;
  actionText?: string;
  whyItMatters?: string;
  managerNote?: string;
  suggestedFocusDimension?: RubricKey;
  suggestedActionText?: string;
  focusDecision?: ManagerFocusDecision;
  preparedAt?: string | null;
  assignedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
};

export type OutcomeSummary = {
  won: number;
  lost: number;
  open: number;
  noDecision: number;
  unknown: number;
  total: number;
  closed: number;
  winRate: number;
};

export type CallCrmOutcome = {
  closeLeadId: string | null;
  closeOpportunityId: string | null;
  pipelineName: string | null;
  statusLabel: string | null;
  statusType: string | null;
  value: number | null;
  valuePeriod: string | null;
  won: boolean;
  lost: boolean;
  closeDate: string | null;
  bucket: CrmOutcomeBucket;
  noDecision: boolean;
};

export type RepPerformance = {
  id: string;
  name: string;
  email: string;
  closeUserId: string | null;
  active: boolean;
  calls: number;
  averageScore: number;
  improvement: number;
  complianceFlags: number;
  primaryFocusDimension: RubricKey;
  primaryFocusDimensions: RubricKey[];
  primaryFocus: string;
  nextCallFocus: string;
  focusRationale: string;
  weakestScoreDimension: RubricKey;
  weakestDimension: RubricKey;
  strongestDimension: RubricKey;
  scores: Record<RubricKey, number>;
  outcomes: OutcomeSummary;
  managerSession?: ManagerSession;
};

export type CoachingAction = {
  id: string;
  repId: string;
  dimension: RubricKey;
  actionText: string;
  whyItMatters: string;
  status: "open" | "completed" | "dismissed";
  completedAt?: string | null;
};

export type CallRow = {
  id: string;
  scorecardId: string;
  closeCallId: string;
  repId: string;
  repName: string;
  activityAt: string;
  durationMinutes: number;
  overallScore: number;
  callType?: string | null;
  outcomeType?: string | null;
  outcomeRationale?: string | null;
  leadSegment?: string | null;
  primaryFocusDimension: RubricKey;
  primaryFocus: string;
  focusRationale: string;
  weakestScoreDimension: RubricKey;
  weakestDimension: RubricKey;
  topStrength: string;
  nextCallFocus: string;
  complianceFlags: string[];
  reviewed: boolean;
  reviewedAt: string | null;
  summary: string;
  coachableMoment?: Record<string, unknown> | null;
  managerAction?: Record<string, unknown> | null;
  successPattern?: Record<string, unknown> | null;
  repPracticeDrill?: string | null;
  crmOutcome?: CallCrmOutcome | null;
  feedback: CoachingFeedback[];
};

export type CoachingSummary = {
  id: string;
  repId: string;
  repName: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  callsGraded: number;
  averageScore: number;
  dimensionAverages?: Record<RubricKey, number>;
  weakestScoreDimension?: RubricKey;
  primaryFocus: string;
  primaryFocusDimension?: RubricKey;
  focusRationale?: string;
  nextCallFocus: string;
  feedback: CoachingFeedback[];
};

export type ReportArtifact = {
  id: string;
  title: string;
  reportType: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  owner: string;
  storagePath: string | null;
};

export type PipelineIncidentSource = "pipeline_job" | "ingestion_run" | "delivery_event" | "coverage_gap";
export type PipelineIncidentSeverity = "critical" | "warning" | "info";

export type PipelineIncident = {
  id: string;
  source: PipelineIncidentSource;
  severity: PipelineIncidentSeverity;
  title: string;
  detail: string;
  status: string;
  occurredAt: string;
  meta: string[];
};

export type LatestGradeRun = {
  status: string;
  occurredAt: string;
  provider: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  pulledCalls: number;
  salesFilteredCalls: number;
  substantiveConnectedCalls: number;
  newlyGradedCalls: number;
  skippedAlreadyGraded: number;
  preGradeSkippedCalls: number;
};

export type PipelineMonitoring = {
  openIncidents: number;
  failedJobs: number;
  failedSlackSends: number;
  failedIngestionRuns: number;
  modelApiErrors: number;
  latestGradeRun: LatestGradeRun | null;
  incidents: PipelineIncident[];
};

export type DimensionTrendPoint = {
  label: string;
  periodType: PeriodType;
  periodStart: string;
  periodEnd: string;
  scores: Record<RubricKey, number>;
};

export type DashboardData = {
  currentUser: AppUser;
  reps: RepPerformance[];
  teamAverage: number;
  totalCalls: number;
  complianceFlags: number;
  teamOpportunity: string;
  teamFocusDimensions: RubricKey[];
  teamFocusRationale: string;
  categoryAverages: Record<RubricKey, number>;
  teamOutcomes: OutcomeSummary;
  scoreTrend: { label: string; score: number }[];
  dimensionTrends: Record<PeriodType, DimensionTrendPoint[]>;
  actions: CoachingAction[];
  calls: CallRow[];
  summaries: CoachingSummary[];
  reports: ReportArtifact[];
  monitoring: PipelineMonitoring;
  feedbackStorageReady: boolean;
  feedbackStorageMessage?: string;
};
