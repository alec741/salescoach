import { AppShell, PendingAccess } from "@/components/app-shell";
import { ReportsWorkspace } from "@/components/reports-workspace";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ManagerReportsPage() {
  const data = await getDashboardData({ roleHint: "manager" });
  if (!data) return <PendingAccess />;
  return (
    <AppShell
      user={data.currentUser}
      active="/manager/reports"
      title="Report artifact library and ops monitor"
      subtitle="Open, export, regenerate, send, and monitor manager or rep coaching reports from one place."
    >
      <ReportsWorkspace data={data} />
    </AppShell>
  );
}
