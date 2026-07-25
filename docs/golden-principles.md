# Golden principles — the mechanical code rules

Opinionated rules that keep the codebase legible and consistent for the next agent. They are
**mechanical**: where possible, each becomes a custom linter whose error message injects the fix into
the agent's context. A rule that can't be machine-enforced becomes a verifier item (fresh context) or a
garbage-collection target.

> Why "golden": these are the canonical rules encoded in the repo, against which a recurring scan opens
> fix PRs. They are the starting point — adapt them per project in the reality-extraction step.

## 1. Parse, don't validate (parse at the boundary)

Transform less-structured input into more-structured output **at the boundary**, preserving the proof in
the type system. Validating checks and discards the information (returns `bool`/`void`); parsing keeps it
(returns the refined type).

- **Make illegal states unrepresentable.** `NonEmpty<T>` instead of `T[]` + a runtime check.
- **Parse once, at the boundary** (where external data enters: route, form, env, API response). After
  that, the rest of the code trusts the type — no re-checking.
- **Don't return `void` from a validator.** Make the result mandatory to use.
- Enforce it as an invariant without prescribing the library (the model tends toward Zod; don't force one).
- The anti-pattern this kills: *shotgun parsing* — scattered checks processing half-valid data.

## 2. Strict boundaries, one-directional dependencies

Predictable structure shrinks the space of the agent's wrong actions. Where the domain is dense, adopt
layers with **forward-only** dependencies and a limited set of permitted edges:

    Types → Config → Repo → Service → Runtime → UI

Cross-cutting concerns (auth, telemetry, feature flags) enter through **one** explicit interface
(Providers). Any other edge is disallowed and enforced by a linter/structural test. Where the domain is
simple, do NOT impose this — a layer in the wrong place is debt.

## 3. No `any` without justification

TypeScript strict. `any` only with a justifying comment; never `@ts-ignore`/`@ts-expect-error`. The type
is a correctness collaborator, not bureaucracy. End-to-end contracts (TS + DB schema + boundary
validation) make the shape explicit — the agent doesn't build on a guessed shape.

## 4. Semantic names (the name reveals intent)

A name amplifies what the agent grasps at a glance. `UserId`, not `T`. `findActiveInvites`, not
`handle`. No obscure abbreviations, no generics (`data`/`info`/`manager`/`process`). A function is a
verb, a variable is a noun, at the right level of abstraction. It's the agent's #1 default mistake —
enforce it.

## 5. Complexity and size under metric

ESLint rule (`warn`, see `.eslintrc`): `complexity ≤ 10`, `max-lines-per-function ≤ 120`,
`max-depth ≤ 4`, `max-params ≤ 5`, `max-nested-callbacks ≤ 3`. **New** code is born within. When
refactoring legacy above the limit, **bring it within** (not just "don't make it worse"). The lint
hook's message says HOW to split, not just the number.

## 6. Shared utilities > hand-rolled helpers

Prefer a central utility package over re-rolling a helper everywhere — it keeps the invariant in one
place. Avoids drift where N copies diverge.

## 7. Tests prove behavior (see `docs/testing.md`)

Tests are the behaviour harness. Core rule: a test **fails before the change, passes after** — else it
proves nothing. Test observable behavior, not implementation. Beware the agent's trap of writing a test
that mirrors the code and can't fail. Full coverage (turning "untested" into "just-added") is a strong
lever where the domain is critical, not a universal dogma. Full discipline: `docs/testing.md`.

## 8. Comments justify a DECISION, not describe code

Comment the "why" the code can't explain by itself (the product decision, the trade-off, the reference
to a requirement). Never comment the obvious. Code self-documents through good names; comments cover what
names can't reach.

---

## How these become sensors

- **Computational (CPU, every commit):** rules 3, 4 (partial), 5 → custom linter + structural test.
- **Inferential (LLM, selective):** rules 1, 2, 6, 8 → verifier in a fresh context
  (`.claude/agents/verifier.md`), since they need semantic judgment.
- **Garbage collection (recurring):** all → drift scan + per-module grade in `docs/QUALITY_SCORE.md` +
  fix PR.
