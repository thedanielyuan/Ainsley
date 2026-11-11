// Eval runs call Ainsley AI's models and cost real money, so none starts on its own: the user
// approves each one. This is the runner's gate; .claude/settings.json also has Claude Code put
// the command to the user before an agent can run it.
import { createInterface } from "node:readline/promises";

const COST = "Eval runs call Ainsley AI's models and cost real money: about $12 for both suites in full, $4–8 for one.";

/**
 * Returns only once the user has approved this run: `--approved` on the command line, or "y" at
 * the prompt when someone is at the terminal. Otherwise (a script, an agent's shell) it exits
 * before anything is spent.
 */
export async function confirmRun(plan, approved) {
  if (approved) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      `Not started: ${plan}\n${COST}\n` +
        "Every run needs the user's approval. Ask them, saying what you'll run and what it will cost; once they say yes to this run, start it again with --approved.",
    );
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => process.exit(130));
  const answer = await rl.question(`${plan}\n${COST}\nRun it? [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.error("Not started.");
    process.exit(1);
  }
}
