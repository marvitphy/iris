# Testing — the behaviour harness

Tests are the **behaviour harness**: the sensor that checks the code does what it's *supposed* to, not
just what it *happens* to. Fowler names this the hardest, least-solved layer — precisely because with an
agent, the same actor writes the test AND the code. This document is the discipline that keeps that from
producing tests that lie.

The **philosophy and rules below are Core** — every project follows them, even a small one. The
**scale mechanics** (100% coverage, selective CI, bug-repro videos) are Advanced — OpenAI/Stripe
territory; reach for them only when the volume justifies it (core-belief 10).

## The obligation (universal) vs the how (per-project)

Separate two things:

- **WHAT — non-negotiable, same in every project:** new or changed behavior ships with a test that
  covers it. No test = the change is not done. This is Core; it does not vary.
- **HOW — per-project, discovered by extraction:** the runner (Vitest/Jest/Playwright…), the file
  naming (`.test.ts` vs `.spec.ts`), the location (colocated `Button.test.tsx` next to the file vs a
  `__tests__/` folder), the exact command. This lives in the repo's `<repo>-patterns` skill, extracted
  from what the repo actually does — NOT dictated here.

So there is no separate "testing skill" — the *how* rides in `<repo>-patterns`; this doc carries the
*what*. The verifier enforces the obligation ("where's the test for this behavior?") without judging the
how.

## The one rule that matters most

> A test that has never failed proves nothing. **Write it so it fails BEFORE the change and passes
> AFTER.** If you can't make it fail on the old behavior, it isn't testing the new behavior.

This is the cheapest defense against the agent's #1 failure mode ("confident garbage"): a test written
after the code, shaped to pass, that would still pass if the business rule broke. Falsifiability first.

## Test behavior, not implementation

- Assert on **observable behavior** (inputs → outputs, state the user can see), never on internal
  structure ("this private method was called", "the object has this field").
- A refactor that keeps behavior must keep the tests green **without editing them**. If refactoring
  forces test edits, the tests were coupled to implementation — a false signal.
- Name tests by the behavior: `rejects a transfer when the balance is insufficient`, not `test
  handleTransfer 3`.

## The layers — when each

Pick the **cheapest layer that can catch the failure**. Don't e2e what a unit test proves.

- **Unit** — one function/module, no I/O. Fast, many. For business rules, edge cases, parsing at the
  boundary (parse-don't-validate is prime unit-test territory: feed a bad shape, assert it's rejected).
- **Integration** — a few units + a real seam (DB, an internal service, a queue). Fewer. For "does the
  repo actually persist", "does the route wire to the service".
- **End-to-end (e2e)** — the whole flow through the real interface (HTTP, the browser). Fewest, slowest.
  For the critical user journeys only (checkout works, login works). One broken e2e should mean a broken
  product, not a broken selector.

The shape is a pyramid: many unit, some integration, few e2e. Inverting it (mostly e2e) makes a slow,
flaky suite the agent learns to ignore.

## The agent-specific trap

The agent writes both sides. Guard against:
- **Tautological tests** — the test mirrors the implementation, so it can't fail when the logic is
  wrong. (Ask: would this pass if the business rule were inverted?)
- **Testing the mock** — so much is mocked that the test exercises the mocks, not the code. Prefer real
  seams (an in-memory DB, a real parser) over mocking the thing under test.
- **Deleted/relaxed to pass** — a failing test weakened until green. This is not a fix; it's hiding the
  bug. Never weaken a test to pass; fix the code.

## How this becomes a sensor

- **Computational (every commit):** the test suite runs; a red suite blocks (or triggers a retry — see
  Advanced). The `<repo>-patterns` skill's verification section names the exact test command.
- **Inferential (selective):** the verifier (`.claude/agents/verifier.md`) audits test *quality* — is
  this testing behavior, or is it tautological? Would it fail if the rule broke? A deterministic runner
  can't judge that; a fresh-context reviewer can.

## Advanced (scale mechanics — turn on when volume demands)

- **100% coverage as a binary signal** — full coverage turns "untested" into "just-added", a clean
  signal for garbage collection. A strong lever where the domain is critical; not a universal dogma.
- **Selective CI** — with a large suite, run only the tests relevant to the change (like Stripe's 3M
  tests). Cap the CI rounds (Stripe: at most two) — diminishing returns past that.
- **Bug-repro artifact** — for a UI bug, the agent records the failure, fixes, records the pass. The
  artifact is the proof, not the agent's claim.
