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

export type AppUser = {
  id: string;
  authUserId: string | null;
  email: string;
  displayName: string;
  role: UserRole;
  closeUserId: string | null;
  active: boolean;
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
};

export type CoachingAction = {
  id: string;
  repId: string;
  dimension: RubricKey;
  actionText: string;
  whyItMatters: string;
  status: "open" | "completed" | "dismissed";
};

export type CallRow = {
  id: string;
  closeCallId: string;
  repId: string;
  repName: string;
  activityAt: string;
  durationMinutes: number;
  overallScore: number;
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
  scoreTrend: { label: string; score: number }[];
  dimensionTrends: Record<PeriodType, DimensionTrendPoint[]>;
  actions: CoachingAction[];
  calls: CallRow[];
  summaries: CoachingSummary[];
  reports: ReportArtifact[];
};
