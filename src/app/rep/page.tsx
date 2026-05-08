import { AppShell, PendingAccess } from "@/components/app-shell";
import { DashboardOverview, TargetStrip } from "@/components/dashboard";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RepDashboardPage() {
  const data = await getDashboardData({ roleHint: "rep" });
  if (!data) return <PendingAccess />;
  return (
    <AppShell user={data.currentUser} active="/rep" title="Your next-call coaching plan" subtitle="Track your score, focus area, target, and the behavior to apply on the next sales call.">
      <div className="page-section">
        <DashboardOverview data={data} mode="rep" />
        <TargetStrip reps={data.reps} targets={data.targets} />
      </div>
    </AppShell>
  );
}
