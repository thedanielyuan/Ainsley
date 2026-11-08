## Commands

- Install: `npm ci`. Configure: `cp .env.example .env.local`, then set `ANTHROPIC_API_KEY`.
- Run: `npm run dev` (http://localhost:3000).
- Before finishing: `npm run lint` and `npx tsc --noEmit`. CI's required check, **Lint and build**, runs `npm ci`, `npm run lint` and `npm run build`.
- Evals: with the app running, `npm run eval` measures Ainsley against its guiding principles (solver and checker accuracy on known problems, and tutoring behavior with simulated students) and prints a summary table. Run it before and after changing the system prompt, tools, solver, checker or tutoring policy, add `--compare evals/results/<earlier run>` for the before/after column, and put both tables in the PR; `--suite math` or `--suite tutoring` runs half. It calls Claude (a full run costs about $12 and takes about 10 minutes), so it stays out of CI. Flags and how to read it: `evals/README.md`.
- Offline tests: `node --test tests/tutoring.test.mjs tests/simulation.test.mjs tests/knowledge.test.mjs "evals/**/*.test.mjs"` (seconds, no key). `node --test tests/slide-preview.test.mjs` checks slide conversion against a running dev server (`AINSLEY_TEST_URL` for another host) and needs LibreOffice.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
