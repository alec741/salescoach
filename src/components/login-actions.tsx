"use client";

import { LogIn } from "lucide-react";
import { authClient } from "@/lib/auth/client";

export function LoginActions() {
  async function signInWithGoogle() {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/rep"
    });
  }

  return (
    <button className="button" type="button" onClick={signInWithGoogle}>
      <LogIn size={16} />
      Continue with Google
    </button>
  );
}
