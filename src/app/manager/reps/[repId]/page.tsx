import { notFound } from "next/navigation";
import { AppShell, PendingAccess } from "@/components/app-shell";
import { ManagerRepWorkspace } from "@/components/manager-rep-workspace";
import { getDashboardData } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ManagerRepDetailPage({ params }: { params: Promise<{ repId: string }> }) {
  const { repId } = await params;
  const data = await getDashboardData({ roleHint: "manager", repId });
  if (!data) return <PendingAccess />;
  if (!data.reps.length) notFound();
  const rep = data.reps[0];
  return (
    <AppShell
      user={data.currentUser}
      active="/manager"
      title={`${rep.name} coaching prep`}
      subtitle="Prepare the next manager conversation with trend, comparison, compliance risk, assigned focus, and supporting call evidence."
    >
      <ManagerRepWorkspace data={data} />
    </AppShell>
  );
}
