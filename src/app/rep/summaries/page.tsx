import { AppShell, PendingAccess } from "@/components/app-shell";
import { TargetStrip } from "@/components/dashboard";
import { SummariesWorkspace } from "@/components/summaries-workspace";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RepSummariesPage() {
  const data = await getDashboardData({ roleHint: "rep" });
  if (!data) return <PendingAccess />;
  return (
    <AppShell
      user={data.currentUser}
      active="/rep/summaries"
      title="Progress history and coaching summaries"
      subtitle="Compare daily, weekly, monthly, and quarterly progress so every focus area has a visible trend."
    >
      <div className="page-section">
        <SummariesWorkspace
          summaries={data.summaries}
          reps={data.reps}
          currentUserId={data.currentUser.id}
          currentUserName={data.currentUser.displayName}
          currentUserRole={data.currentUser.role}
          feedbackStorageReady={data.feedbackStorageReady}
          feedbackStorageMessage={data.feedbackStorageMessage}
          targets={data.targets}
        />
        <TargetStrip reps={data.reps} targets={data.targets} />
      </div>
    </AppShell>
  );
}
