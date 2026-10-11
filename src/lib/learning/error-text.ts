export function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}
