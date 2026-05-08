import { AppShell, PendingAccess } from "@/components/app-shell";
import { DashboardOverview, TargetStrip } from "@/components/dashboard";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ManagerDashboardPage() {
  const data = await getDashboardData({ roleHint: "manager" });
  if (!data) return <PendingAccess />;
  return (
    <AppShell user={data.currentUser} active="/manager" title="Team performance and coaching priorities" subtitle="Scan team health, identify the highest-leverage coaching behavior, and open rep-level review queues.">
      <div className="page-section">
        <DashboardOverview data={data} mode="manager" />
        <TargetStrip reps={data.reps} targets={data.targets} />
      </div>
    </AppShell>
  );
}
