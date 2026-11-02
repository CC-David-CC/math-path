# Math Path — core rules

Audience: grades 3–4. Learning target: number facts and arithmetic fluency
without a required global timer.

## Canonical state

```
session = {
  version, seed, rngState, phase: "present" | "miss-model" | "done",
  route: cell[], index, skills: {skill: {correct, asked, difficulty}},
  current: problem | related, stars, attempts
}
problem = {skill, left, op, right, answer, choices[4]}
```

The route has 18 cells. `phase` and the current problem are computed state; a
save stores the generator position and counters, not animation or timer data.

## Operations

- `newSession(seed, grade)` builds a seeded route.
- `answer(choice)` is legal only in `present`:
  - correct: award the cell, increment `skills[skill].correct`, move `index`;
  - wrong: switch to `miss-model`, store the original problem as `related`.
- `continue()` in `miss-model` asks one nearby problem from the same skill,
  then returns to `present`.
- `finish()` is legal at the final cell and yields `done`.

## Rules and invariants

- Grade 3: add/subtract with operands 0–100 and results 0–100; multiply/divide
  tables 0–12. Grade 4 adds two-operand mixed facts.
- Four answer choices are generated with three distinct distractors.
- A wrong answer never advances the route. Re-asking cannot reuse the exact
  missed expression on that cell.
- Difficulty raises or lowers the fact range per skill from recorded accuracy;
  a session never changes grade bands.
- There is no elapsed-time input to the model; an optional timer may exist only
  in a later presentation layer.

## Win and loss

Reaching the final cell ends the session with stars based on first-try
correctness. There is no fail state; a player can always re-ask and proceed.

## Seeded behavior

One RNG stream selects route skills and problem operands. The same seed,
answers, and action order reproduce the identical session.

## Snapshot

Serialize version, seed, RNG state, route, index, skills, current/related
problem, stars, attempts, and phase. Validation rejects unknown skills, invalid
operand ranges, out-of-bounds index, and choices whose value duplicates the
answer or another distractor.

## Pure tests before a view

- Fact generation stays in the grade's declared ranges.
- Choices always contain exactly one answer and three distinct distractors.
- Correct/wrong transitions, miss-model re-ask, and single advancement.
- No advancement on any repeated wrong answer.
- Difficulty changes never cross the grade's content ceiling.
- Exact snapshot round-trip and malformed-snapshot rejection.
- Same seed reproduces route, problems, and outcomes.
