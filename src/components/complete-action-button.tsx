"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { completeCoachingActionAction } from "@/app/actions";

export function CompleteActionButton({ actionId }: { actionId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isCompleted, setIsCompleted] = useState(false);

  function completeAction() {
    startTransition(async () => {
      const result = await completeCoachingActionAction(actionId);
      if (result.ok) {
        setIsCompleted(true);
        router.refresh();
      }
    });
  }

  return (
    <button className="button secondary" type="button" onClick={completeAction} disabled={isPending || isCompleted}>
      <CheckCircle2 size={15} />
      {isCompleted ? "Completed" : isPending ? "Saving..." : "Mark complete"}
    </button>
  );
}
