import { AppShell, PendingAccess } from "@/components/app-shell";
import { UsersWorkspace } from "@/components/users-workspace";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function UserSettingsPage() {
  const data = await getDashboardData({ roleHint: "admin" });
  if (!data) return <PendingAccess />;
  return (
    <AppShell
      user={data.currentUser}
      active="/settings/users"
      title="User access and role mapping"
      subtitle="Map OAuth users to app roles, Close rep IDs, active state, and manager visibility."
    >
      <UsersWorkspace data={data} />
    </AppShell>
  );
}
