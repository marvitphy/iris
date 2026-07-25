# Core beliefs — agent-first principles

The operating principles of this repository, distilled from how the state of the art (OpenAI/Codex,
Stripe/minions, Martin Fowler, Anthropic) describes harness engineering. They are opinionated on
purpose: they guide every scaffolding decision. If a choice contradicts one of these, it needs explicit
justification in an ExecPlan's Decision Log.

## 1. Agent = Model + Harness

The model is swappable; the harness stays. You don't get better by switching models — you get better by
building the harness around one. Every durable improvement is a harness improvement (a guide or a
sensor), not a one-off prompt.

## 2. What the agent can't see doesn't exist

Knowledge in Slack, Google Docs, or someone's head is illegible to the agent — same as a new hire who
joined three months late. **Push context into the repo**: code, markdown, schemas, versioned plans. If
an architecture decision was aligned in a chat, it does not exist until it becomes a file.

## 3. A map, not a manual

Context is a scarce resource. A giant instruction file crowds out the task and the relevant code. When
everything is "important", nothing is. `AGENTS.md` is the **table of contents** (~100 lines) pointing to
`docs/`; fine-grained rules are scoped by subdirectory, not global.

## 4. Agent legibility is the goal

Optimize the repo so the agent can reason about the whole domain **straight from the repository**.
Prefer "boring" technologies (composable, stable API, well-represented in training) — the agent models
them better. Sometimes it's cheaper to reimplement a subset than to work around an opaque library.

## 5. Enforce invariants, don't micromanage implementation

You care deeply about **boundaries, correctness, and reproducibility**. Within them, the agent is free
to express the solution however it likes. The code need not match human taste — if it's correct,
maintainable, and legible to the next agent run, it passes.

## 6. Constraints are a prerequisite, not a luxury

The rigid architecture you'd postpone until hundreds of engineers is, with agents, the **first** step.
Constraints are what allow speed without decay. Predictable structure and strict boundaries shrink the
space of the agent's wrong actions.

## 7. If it's good for humans, it's good for the agent

Reuse the dev infra that already exists (tests, lint, ephemeral environments, observability).
Parallelism, predictability, and isolation — desirable for humans — are exactly what the agent needs.
Don't build a separate path "for the AI".

## 8. Shift feedback left

If a check will fail in CI, it should fail earlier — in the IDE, the pre-push, the hook. The fastest
feedback is the cheapest. Run the linter locally before pushing. A custom linter's error message
**injects the fix instruction** into the agent's context ("the good kind of prompt injection").

## 9. Technical debt is compound interest — pay it down continuously

Drift is inevitable in an agent-generated codebase (it replicates existing patterns, including bad
ones). Don't accumulate it for a painful refactor sprint. A recurring process ("garbage collection")
scans for drift, updates the per-module grade, and opens small auto-mergeable fix PRs. Human taste is
captured once, enforced continuously.

## 10. Start simple (the complexity filter applies to agents too)

Don't build multi-agent orchestration where one call solves it. Only add complexity (workflow, fan-out,
blueprint) when the simple path visibly fails. The goal is the minimum that solves it, not more pattern.
