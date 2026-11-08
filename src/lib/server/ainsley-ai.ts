import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Ainsley AI: the models Ainsley runs on, the client that calls them, and how a failed call is put
 * to the student. This is the one place that names the models; everything else asks for a tier.
 * Students only ever meet Ainsley, so no model or provider name reaches the browser, a reply, a
 * step name or an error a student sees ("Students only ever meet Ainsley" in AGENTS.md).
 */
export const AINSLEY_AI = {
  /**
   * The tutor, the solvers and the verifier, the answer checker, prerequisite maps, and the second
   * look at any claim the fast tier finds false. Has a server-side fallback for safety declines.
   */
  reasoning: "claude-opus-5-5",
  /**
   * Quick jobs: naming thinking steps, re-ranking search results, transcribing scans, finding and
   * checking claims, and reviewing replies' help. Has no server-side fallback.
   */
  fast: "claude-haiku-5-5",
} as const;

export type AinsleyTier = keyof typeof AINSLEY_AI;

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

/** For whoever runs the app, in words a student may see too. */
export function missingKeyMessage() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return "Ainsley isn't set up yet: add the API key to .env.local (see .env.example) and restart the dev server.";
  }
  return null;
}

/** A student-facing explanation of a failed call to Ainsley AI, with no model or provider names. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Ainsley couldn't connect to Ainsley AI: the API key in .env.local was rejected.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "This API key can't use the models Ainsley AI runs on.";
  }
  if (err instanceof Anthropic.NotFoundError) {
    return "Something this chat refers to wasn't found (a deleted file, or a model this key can't use).";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Too many requests right now. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.OverloadedError) {
    return "Ainsley AI is overloaded right now. Please try again shortly.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `The request was rejected: ${withoutModelNames(err.message)}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach Ainsley AI. Check your internet connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Ainsley AI ran into an error${err.status ? ` (${err.status})` : ""}. Please try again.`;
  }
  return missingKeyMessage() ?? "Something went wrong while generating a response.";
}

/** An API message passed on to a student, with any model or provider name put as Ainsley AI. */
export function withoutModelNames(text: string): string {
  return text
    .replace(/\bclaude-[a-z0-9.-]*[a-z0-9]/gi, "Ainsley AI")
    .replace(/\b(?:Claude(?: (?:Opus|Sonnet|Haiku|Fable)(?: \d+(?:\.\d+)?)?)?|Anthropic)(?:'s)?\b/g, "Ainsley AI");
}
