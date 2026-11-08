import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;
let clientKey: string | undefined;

// `next dev` reloads .env.local without a restart, so rebuild the client when the key changes.
export function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!client || key !== clientKey) {
    client = new Anthropic();
    clientKey = key;
  }
  return client;
}

export function missingKeyMessage() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return "Missing ANTHROPIC_API_KEY. Add it to .env.local and restart the dev server.";
  }
  return null;
}

/** A student-facing explanation of a failed Claude API request. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Ainsley couldn't authenticate with the Claude API. Check ANTHROPIC_API_KEY in .env.local.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This API key doesn't have access to Claude Opus 5.5.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Something this chat refers to wasn't found (a deleted file, or a model this key can't use).";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Too many requests right now. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.OverloadedError) {
    return "Claude is overloaded right now. Please try again shortly.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the Claude API. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Claude API error${err.status ? ` (${err.status})` : ""}. Please try again.`;
  }
  return missingKeyMessage() ?? "Something went wrong while generating a response.";
}
