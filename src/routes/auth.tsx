import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ redirect: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sign in — Avanthi CRT Portal" },
      { name: "description", content: "Sign in to the Avanthi CRT Portal." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    await supabase.from("audit_logs").insert({ actor_id: data.user.id, action: "sign_in" });
    navigate({ to: "/dashboard" });
  }

  async function forgot() {
    if (!email) return setMsg("Enter your email first.");
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/auth" });
    setMsg("If that account exists, a reset link has been sent.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6">
        <h1 className="text-2xl font-semibold text-card-foreground">Avanthi CRT Portal</h1>
        <input className="w-full rounded-md border border-input bg-background px-3 py-2" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded-md border border-input bg-background px-3 py-2" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <button disabled={busy} className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground">Sign in</button>
        <button type="button" onClick={forgot} className="text-sm text-muted-foreground underline">Forgot password?</button>
      </form>
    </div>
  );
}
