# Evolving the harness — the meta-loop

This harness is not a static snapshot. It's an **organism** that grows as the system is developed. The
root rule (Fowler): *the human's job is to steer the agent by ITERATING on the harness. When a problem
happens multiple times, the feedforward and feedback controls should improve.*

Without this loop the harness stagnates: the same mistakes repeat, context bloats, drift accumulates.
WITH it, every friction in development becomes a new harness piece — and the next task is easier and more
reliable than the last. **The goal is that working here improves the working environment itself,
automatically.**

## The learning law

> When something causes friction two or three times, STOP just solving the case and solve the CLASS:
> promote the fix into a harness piece so the problem never recurs.

"Solving the case" saves you once. "Promoting into the harness" improves every future task.

## Trigger → piece to create

| You felt this during dev | Create this piece | Where |
|---|---|---|
| Repeated the same task/instruction 3x | a **skill** (rule + example, precise trigger) | `.claude/skills/<name>/SKILL.md` |
| An investigation/scan filled your context | a **subagent** that works in an isolated context and returns only the conclusion | `.claude/agents/<name>.md` |
| The agent made the SAME mistake 2x | a **golden principle** + (if mechanical) a linter that injects the fix | `docs/golden-principles.md` + `harness/` |
| A shape/product decision was guessed wrong | a **contract/type** parsed at the boundary (parse-don't-validate) | the code + `ARCHITECTURE.md` (invariant) |
| A bug reached prod / recurred | a **regression test** that fails on the bug, passes on the fix | the test suite (`docs/testing.md`) |
| The domain got dense, dependencies crossing | **layers** (forward-only) + a **structural test** enforcing the edges (dependency-cruiser / ArchUnit / semgrep) | `ARCHITECTURE.md` + `harness/` |
| An important architecture decision was made | an **ExecPlan** or versioned doc (else it "doesn't exist" to the agent) | `docs/exec-plans/` or `docs/design-docs/` |
| You changed structure (moved/renamed a module, added a layer, changed a boundary) | **update the codemap** in the same change | `ARCHITECTURE.md` |
| You noticed debt you won't fix now | **record one line** (not just in the commit message) | `docs/exec-plans/tech-debt-tracker.md` |
| A repeatable multi-step flow got fragile | a **blueprint** (deterministic + agent graph) | `docs/patterns/blueprints.md` |
| Context aligned in chat/head (not in the repo) | **push it into the repo** as markdown (core-belief 2) | `docs/` |
| Docs stale / a truth kept by hand | **generated** docs (from code) or **doc-gardening** (sensor) | `docs/design-docs/doc-as-living-system.md` |
| Drift accumulating across modules | trigger/build **garbage collection** (per-module grade + PR) | `docs/QUALITY_SCORE.md` |

## How to promote (the mechanical step)

1. **Name the friction.** Is it a *guide* problem (the agent didn't know) or a *sensor* problem (the
   agent wasn't caught)? Naming the layer fixes the diagnosis — you stop rewriting prompts when the bug
   is a missing rule.
2. **Pick the piece** from the table. Prefer the cheapest one that solves the class (skill < subagent <
   linter < layer). Don't over-engineer (core-belief 10).
3. **Write the piece** anchored to the real case that motivated it — a concrete example, not theory.
4. **Have the agent write the fix**, not you by hand (that's how it compounds at scale). The agent that
   felt the friction is the one that best encodes the rule.
5. **Verify** the new piece catches the case that motivated it (run the linter on the bad file; invoke
   the skill; test the subagent).

## Signs the harness is healthy

- The same mistake does NOT appear twice without becoming a rule.
- `AGENTS.md` stays lean (detail migrated into scoped skills, not the index).
- Module quality grades hold or rise, not fall.
- New tasks get faster than old ones of the same kind (the harness piece already exists).

## Signs it stagnated

- You fix the same thing by hand every week (didn't promote into the harness).
- `AGENTS.md`/global rules bloated to where the agent ignores them (move to a scoped skill).
- Drift became a painful refactor sprint (missing continuous garbage collection).
