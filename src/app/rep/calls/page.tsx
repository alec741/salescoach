import { AppShell, PendingAccess } from "@/components/app-shell";
import { CallsBrowser } from "@/components/calls-browser";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function RepCallsPage() {
  const data = await getDashboardData({ roleHint: "rep" });
  if (!data) return <PendingAccess />;
  return (
    <AppShell
      user={data.currentUser}
      active="/rep/calls"
      title="Call review workspace"
      subtitle="Review scored calls, isolate risk, and turn evidence into the next behavior to practice."
    >
      <CallsBrowser calls={data.calls} />
    </AppShell>
  );
}
