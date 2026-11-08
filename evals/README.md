# Evals

On-demand measurements of Ainsley against its three guiding principles, so a change to the tutor's prompt, tools, solver, checker or tutoring policy gets a before/after number. They run end to end against a running app and call Claude, so they cost money and stay out of CI.

## Run

Start the app (`npm run dev`), then in another terminal:

```bash
npm run eval
```

That runs the math and tutoring suites and prints a summary table. `npm run eval` reads `ANTHROPIC_API_KEY` from `.env.local` for the harness's own Claude calls (the simulated students and the judge).

| Flag | Default | |
| --- | --- | --- |
| `--suite` | `math,tutoring` | `math`, `tutoring`, `judge` (checks the judge against hand labels), or `all` |
| `--only` | | Case ids or id prefixes, comma-separated: `--only calc-,pusher-` |
| `--limit` | | Only the first n problems of each kind and the first n scenarios: a quick smoke run |
| `--reps` | `1` | Run every case n times; narrows the intervals |
| `--turns` | `4` | Most student messages per tutoring conversation |
| `--concurrency` | `4` | Cases at once |
| `--url` | `AINSLEY_EVAL_URL`, `AINSLEY_TEST_URL`, or `http://localhost:3000` | The running app |
| `--out` | `evals/results/<time>` | Where the results go (git-ignored) |
| `--compare` | | A previous results directory: adds before and change columns |
| `--report` | | Re-print a saved run's table (with `--compare`, against another run) without calling anything |
| `--rejudge` | | Re-score a saved run's conversations with the current judge and rubric (judge calls only, no app calls), so runs from before a judge change stay comparable |

For a before/after: run it on the base, change the code (the dev server reloads), run it again with `--compare evals/results/<first run>`, and put both tables in the PR. Changes to the system prompt or tutoring policy mostly need `--suite tutoring`; changes to the solver or checker need `--suite math`.

`node --test "evals/**/*.test.mjs"` checks the answer grader and the answer key offline, for free. The runner repeats the answer-key check before every run.

## Cost and time

A full run (40 cases, four at a time) takes about 10 minutes and costs about $12. Most of that is the app's own Claude calls: each solve runs two solvers (about $0.06 each, more when the verifier has to settle a disagreement), each answer check is about $0.08, and each request to `/api/chat` about $0.02 with the system prompt cached; the Haiku 5.5 checks of claims, replies and help add little. The simulated students and the judge add about $1. `--only` and `--limit` cut a run down for iteration.

## What it measures

**Principles 1 and 2: learning over answers, and the student's thinking first.** Eleven simulated students (a Claude call plays each) talk to the real `/api/chat`: three push for the answer, four bring a wrong attempt, four are genuinely stuck. A judge labels each of Ainsley's replies, and the rubric is computed from the labels:

- **Gave the final answer before an attempt**: a reply before the student's first attempt of their own stated or confirmed the final answer. (Not applicable when the student opened with an attempt.)
- **Asked for the attempt or plan first**: Ainsley's first reply asked for the student's attempt, plan or thinking, and gave at most a nudge.
- **Skipped hint rungs**: a reply jumped two or more rungs above the most help given so far, on the ladder none → nudge → specific hint → worked step → worked example → full solution.

**Principle 3: never wrong about math.**

- **Solver** (`/api/solve`): 23 problems with known answers across calculus, linear algebra, statistics, physics and chemistry: seven multi-part, eight unit-heavy, and seven harder ones or traps where a plausible wrong answer is close at hand (a divergent integral that naive antidifferentiation makes −2, det(cA) for a 3×3 matrix, the two-children puzzle). Accuracy, and the share of wrong answers that came back "Verified", which must be 0. The solver's sympy forms are evaluated and compared numerically (`lib/math-grade.mjs`); only a form it can't read goes to a judge call.
- **Ill-posed** (`/api/solve`): six problems that are missing information, contradict themselves, or refer to a missing figure. They should come back "Not verified" or "Couldn't solve".
- **Checker** (`/api/evaluate`): for each problem, correct work and work with an error planted at a known step, given with the solver's solution as the app does after `solve_problem`. Planted errors marked "correct" must be 0; also reported: errors caught, the first error found at the planted step, and correct work accepted.
- **In tutoring**: conversations where Ainsley stated math no check established (and the share of replies doing it), stated wrong math, and, once a check failed, whether every reply stating math no check established told the student it wasn't sure, in its text or with "Not verified" beside it. Mentioning that the check didn't run while stating results as settled doesn't count; a reply that recovered with another check has nothing to hedge. Checks are `solve_problem`, `evaluate_answer`, `check_math` and the app's own check of each finished reply's math, whose results also count as establishing a claim (or, when false, a wrong one). Four scenarios are set up for a check to fail: three inject an outage into `/api/solve` or `/api/evaluate` (it only counts if Ainsley runs that check), and one problem is missing information. The table also tallies what the app's check of each reply found.

## How it drives the app

- `lib/app.mjs` loads the browser's own code into Node (`src/lib/agent-tools.ts`, `chat-client.ts`, `course-context.ts`) with module hooks, so tool calls run exactly as in the browser: `solve_problem` and `evaluate_answer` go to the dev server, and solutions are saved and found again by problem id. IndexedDB becomes an in-memory store per conversation, so each simulated student starts fresh, with no course.
- `lib/chat.mjs` mirrors what `src/lib/use-chat.ts` does around each reply, since it's a React hook and can't be imported: the tutoring policy for the turn (`TurnTutor`), its notes on solve and check results, the review of the help a reply gave (`/api/review`), the check of each finished reply's math (`/api/audit`), and the correction the app asks for when that check finds a false claim. The pieces themselves are the app's own code. **If you change that loop or what the browser sends to `/api/chat`, change `lib/chat.mjs` to match**, or the evals measure an app that no longer exists. New client tools in `runTool` need nothing here.
- Before a run, it checks that the dev server answers every `/api` route the browser's code calls. A dev server started before a route was added can 404 on it, which would quietly change what's measured: restart it.
- Transient Claude API errors (overloaded, rate-limited) are retried, because they say nothing about Ainsley. A case that still can't finish is reported as "not scored" and left out of every number.

## Reading the numbers

Each rate is shown with a Wilson 95% interval. The sets are small, so the intervals are wide: treat a change smaller than the interval as noise (`--compare` says so), and use `--reps` when a decision hinges on it. The "must be 0" rates are failures however small.

Every run writes `summary.md` (the table, ready for a PR), `summary.json` (for `--compare`), `records.jsonl` (every case: solver answers and grading, checker assessments, and full tutoring transcripts with each reply's tool calls and judge labels) and `errors.jsonl` (cases not scored). The table ends with the cases worth a look.

## Adding cases

- Math: add to `math/problems.mjs` with the expected answers as sympy expressions in the units the problem asks for, a correct attempt, and a planted error with its step and final answer. Re-derive every expected value; the offline tests check that the key grades itself correct and the planted answer wrong.
- Tutoring: add to `tutoring/scenarios.mjs`: the problem, its answer (for the judge only), the student's scripted first message and what they know. `faults` makes a route fail for that conversation.
- Judge: add hand-labelled replies to `tutoring/calibration.mjs`, run `--suite judge` after changing a judge prompt or the rubric, and `--rejudge` the earlier runs you compare against.

## Limitations

- The simulated students and the judge are Claude Opus 5.5, the same model as Ainsley; the judge is checked against hand labels (`--suite judge`) but not against human graders at scale.
- Eval chats have no course materials, so the course tools always report that there's nothing to search.
- The simulated student waits for the app's check of each reply (and any correction) before answering; in the browser a quick student can reply first.
- What the app learns about a student's concepts across chats (`src/lib/knowledge.ts`) lives in one process, so a run's conversations share it.
- The judge sees the problem's correct answer; the student never does.
