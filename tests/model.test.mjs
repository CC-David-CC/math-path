import assert from "node:assert/strict";
import test from "node:test";
import {MathPathSession} from "../model.mjs";

function solve(session, intentionallyMissAt = -1) {
  let missed = false;
  while (session.phase !== "done") {
    if (session.phase === "miss-model") {
      session.continueAfterMiss();
      continue;
    }
    const problem = session.current;
    if (!missed && session.index === intentionallyMissAt) {
      missed = true;
      session.answer(problem.answer + 1);
      assert.equal(session.phase, "miss-model");
      assert.notDeepEqual(session.related, problem);
      continue;
    }
    session.answer(problem.answer);
  }
}

test("generation stays bounded and every problem has one distinct answer", () => {
  for (const grade of [3, 4]) {
    for (let seed = 0; seed < 50; seed++) {
      const session = new MathPathSession(`grade-${grade}-${seed}`, grade);
      for (let index = 0; index < session.state.route.length; index++) {
        const problem = session.current;
        assert.equal(problem.choices.length, 4);
        assert.equal(new Set(problem.choices).size, 4);
        assert.equal(problem.choices.filter(value => value === problem.answer).length, 1);
        if (problem.skill === "divide") assert.ok(problem.right > 0 && problem.left === problem.answer * problem.right);
        session.answer(problem.answer);
      }
    }
  }
});

test("grade-four mixed problems use two operations and produce a unique answer", () => {
  let found = 0;
  for (let seed = 0; seed < 60 && found < 12; seed++) {
    const session = new MathPathSession(`mixed-${seed}`, 4);
    while (session.phase !== "done" && found < 12) {
      const problem = session.current;
      if (problem.skill === "mixed") {
        found++;
        assert.ok(["×", "+"].includes(problem.op));
        assert.ok(["×", "+"].includes(problem.second.op));
        if (problem.op === "×" && problem.second.op === "+") {
          assert.equal(problem.answer, problem.left * problem.right + problem.second.value);
        } else {
          assert.equal(problem.op, "+");
          assert.equal(problem.second.op, "×");
          assert.equal(problem.answer, problem.left + problem.right * problem.second.value);
        }
        assert.equal(new Set(problem.choices).size, 4);
      }
      session.answer(problem.answer);
    }
  }
  assert.ok(found >= 12);
});

test("wrong answers explain, re-ask the same skill, and never advance", () => {
  const session = new MathPathSession("miss", 3);
  const index = session.index;
  const first = session.current;
  assert.equal(session.answer(first.answer + 1).correct, false);
  assert.equal(session.index, index);
  assert.equal(session.related.skill, first.skill);
  session.continueAfterMiss();
  assert.equal(session.phase, "present");
  assert.notDeepEqual(session.current, first);
  session.answer(session.current.answer);
  assert.equal(session.index, index + 1);
});

test("a full route completes once and produces stars", () => {
  const session = new MathPathSession("complete", 4);
  solve(session);
  assert.equal(session.phase, "done");
  assert.equal(session.index, 18);
  assert.equal(session.stars, 3);
  assert.throws(() => session.answer(0));
});

test("seeded action history is reproducible", () => {
  const one = new MathPathSession("repeatable", 4);
  const two = new MathPathSession("repeatable", 4);
  assert.deepEqual(one.state.route, two.state.route);
  solve(one, 5);
  solve(two, 5);
  assert.deepEqual(one.state, two.state);
});

test("snapshot round-trip resumes at the exact problem", () => {
  const session = new MathPathSession("snapshot", 4);
  session.answer(session.current.answer);
  const restored = MathPathSession.fromSave(session.encodeSave());
  assert.deepEqual(restored.state, session.state);
  restored.answer(restored.current.answer);
  session.answer(session.current.answer);
  assert.deepEqual(restored.state, session.state);
});

test("malformed and overlapping snapshots are rejected", () => {
  const session = new MathPathSession("bad", 3);
  const valid = JSON.parse(session.encodeSave());
  for (const mutate of [
    value => { value.payload.grade = 5; },
    value => { value.payload.current.choices = [value.payload.current.answer, value.payload.current.answer, 2, 3]; },
    value => { value.payload.skills.add.correct = value.payload.skills.add.answered + 1; },
    value => { value.payload.index = 18; },
  ]) {
    const broken = structuredClone(valid);
    mutate(broken);
    assert.throws(() => MathPathSession.fromSave(JSON.stringify(broken)));
  }
});
