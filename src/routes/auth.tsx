import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { passwordProblem, safeRedirectTarget, signInErrorMessage } from "@/lib/auth-flow";
import { loadIdentity } from "@/lib/identity";

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

const inputClass = "w-full rounded-md border border-input bg-background px-3 py-2";

function AuthPage() {
  const router = useRouter();
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      return setMsg(signInErrorMessage(error));
    }
    const identity = await loadIdentity(supabase, data.user.id).catch(() => undefined);
    if (!identity?.active) {
      await supabase.auth.signOut();
      setBusy(false);
      return setMsg(
        identity === undefined
          ? "Could not verify your account. Please try again."
          : "Your portal access is disabled. Contact your administrator.",
      );
    }
    setBusy(false);
    router.history.push(safeRedirectTarget(redirect));
  }

  async function forgot() {
    if (!email) return setMsg("Enter your email first.");
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/auth",
    });
    setBusy(false);
    // Same wording for unknown accounts avoids revealing which emails exist.
    setMsg(
      error?.status === 429
        ? "Too many requests. Please wait a few minutes and try again."
        : "If that account exists, a reset link has been sent.",
    );
  }

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password, confirmation);
    if (problem) return setMsg(problem);
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return setMsg("Could not update your password. Request a new reset link and try again.");
    }
    await supabase.auth.signOut();
    setBusy(false);
    setRecovering(false);
    setPassword("");
    setConfirmation("");
    setMsg("Password updated. Sign in with your new password.");
  }

  if (recovering) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form
          onSubmit={setNewPassword}
          className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
        >
          <h1 className="text-2xl font-semibold text-card-foreground">Set a new password</h1>
          <div className="space-y-1">
            <label htmlFor="new-password" className="text-sm text-card-foreground">
              New password
            </label>
            <input
              id="new-password"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="confirm-password" className="text-sm text-card-foreground">
              Confirm password
            </label>
            <input
              id="confirm-password"
              className={inputClass}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              required
            />
          </div>
          {msg && (
            <p role="alert" className="text-sm text-muted-foreground">
              {msg}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Update password
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={signIn}
        className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-6"
      >
        <h1 className="text-2xl font-semibold text-card-foreground">Avanthi CRT Portal</h1>
        <div className="space-y-1">
          <label htmlFor="email" className="text-sm text-card-foreground">
            Email
          </label>
          <input
            id="email"
            className={inputClass}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="password" className="text-sm text-card-foreground">
            Password
          </label>
          <input
            id="password"
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {msg && (
          <p role="alert" className="text-sm text-muted-foreground">
            {msg}
          </p>
        )}
        <button
          disabled={busy}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Sign in
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={forgot}
          className="text-sm text-muted-foreground underline"
        >
          Forgot password?
        </button>
      </form>
    </div>
  );
}
