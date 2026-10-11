export const DEFAULT_LANDING = "/dashboard";
export const MIN_PASSWORD_LENGTH = 8;

// Only same-origin absolute paths are honoured, so a crafted ?redirect cannot leave the portal.
export function safeRedirectTarget(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return DEFAULT_LANDING;
  }
  if (Array.from(value).some((char) => char.charCodeAt(0) < 0x20)) return DEFAULT_LANDING;
  const path = value.split(/[?#]/, 1)[0];
  if (path === "/auth") return DEFAULT_LANDING;
  return value;
}

export function signInErrorMessage(error: {
  code?: string | undefined;
  status?: number | undefined;
}) {
  if (error.code === "invalid_credentials" || error.status === 400) {
    return "Incorrect email or password.";
  }
  if (error.code === "email_not_confirmed") {
    return "Your email is not confirmed. Contact your administrator.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  return "Could not sign you in. Please try again.";
}

export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) return "The two passwords do not match.";
  return null;
}
