import {
  SeededRng,
  clone,
  decodeSave,
  encodeSave,
  exactKeys,
  integer,
  oneOf,
  plainObject,
  uniqueNumbers,
} from "../shared/core.mjs";
import {makeLearningReport} from "../shared/experience.mjs";

export const MATH_PATH_APP_ID = "math-path";
export const MATH_PATH_CONTENT_VERSION = "math-path-core-1";
const ROUTE_LENGTH = 18;
const SKILLS = ["add", "subtract", "multiply", "divide"];
const GRADE_4_SKILLS = [...SKILLS, "mixed"];

export class MathPathSession {
  #state;
  #rng;

  constructor(seed, grade = 3) {
    if (plainObject(seed) && exactKeys(seed, Object.keys(snapshotShape))) {
      validatePayload(seed);
      this.#state = clone(seed);
      this.#rng = SeededRng.fromState(seed.rngState);
      return;
    }
    if (!oneOf(grade, [3, 4])) throw Error("Grade must be 3 or 4.");
    const rng = new SeededRng(seed);
    const skillList = grade === 3 ? SKILLS : GRADE_4_SKILLS;
    const skills = Object.fromEntries(skillList.map(skill => [skill, {answered: 0, correct: 0, difficulty: 1}]));
    const state = {
      version: MATH_PATH_CONTENT_VERSION,
      seed: String(seed),
      rngState: 0,
      grade,
      phase: "present",
      route: Array.from({length: ROUTE_LENGTH}, () => rng.pick(skillList)),
      index: 0,
      current: null,
      related: null,
      skills,
      hintsUsed: 0,
      stars: 0,
      firstTry: 0,
      attempts: 0,
      attemptsForCell: 0,
    };
    state.current = makeProblem(state.route[0], state.grade, state.skills[state.route[0]].difficulty, rng);
    state.rngState = rng.state;
    this.#state = state;
    this.#rng = rng;
  }

  static fromSave(text) {
    return new MathPathSession(decodeSave(text, MATH_PATH_APP_ID, MATH_PATH_CONTENT_VERSION, validatePayload));
  }

  get phase() {
    return this.#state.phase;
  }

  get grade() {
    return this.#state.grade;
  }

  get index() {
    return this.#state.index;
  }

  get current() {
    return clone(this.#state.current);
  }

  get related() {
    return clone(this.#state.related);
  }

  get stars() {
    return this.#state.stars;
  }

  get hintsUsed() {
    return this.#state.hintsUsed;
  }

  get state() {
    return clone(this.#state);
  }

  get report() {
    return makeLearningReport({
      appId: MATH_PATH_APP_ID,
      audience: `grade-${this.#state.grade}`,
      phase: this.#state.phase,
      stars: this.#state.stars,
      score: this.#state.firstTry * 10 + (this.#state.phase === "done" ? this.#state.stars * 100 : 0),
      firstTry: this.#state.firstTry,
      attempts: this.#state.attempts,
      hintsUsed: this.#state.hintsUsed,
      remaining: ROUTE_LENGTH - this.#state.index,
      objectives: this.#state.grade === 3
        ? ["Practice addition, subtraction, multiplication, and division facts."]
        : ["Practice number facts and two-step mixed expressions."],
      details: {skills: clone(this.#state.skills)},
    });
  }

  answer(choice) {
    if (this.#state.phase !== "present") throw Error("No current problem to answer.");
    if (!Number.isSafeInteger(choice)) throw Error("Answer must be an integer.");
    const skill = this.#state.route[this.#state.index];
    const profile = this.#state.skills[skill];
    const firstAttempt = this.#state.attemptsForCell === 0;
    this.#state.attempts++;
    profile.answered++;
    if (choice !== this.#state.current.answer) {
      profile.difficulty = 1;
      this.#state.phase = "miss-model";
      this.#state.attemptsForCell = (this.#state.attemptsForCell || 0) + 1;
      this.#state.related = makeDifferentProblem(this.#state.current, this.#state.grade, profile.difficulty, this.#rng);
      this.#state.rngState = this.#rng.state;
      return {correct: false, model: workedModel(this.#state.current), next: "continue"};
    }

    profile.correct++;
    profile.difficulty = Math.min(3, profile.difficulty + 1);
    if (firstAttempt) this.#state.firstTry++;
    this.#state.index++;
    this.#state.attemptsForCell = 0;
    this.#state.current = null;
    this.#state.related = null;
    if (this.#state.index === this.#state.route.length) {
      this.#state.phase = "done";
      this.#state.stars = starCount(this.#state.firstTry);
    } else {
      const nextSkill = this.#state.route[this.#state.index];
      this.#state.current = makeProblem(nextSkill, this.#state.grade, this.#state.skills[nextSkill].difficulty, this.#rng);
      this.#state.rngState = this.#rng.state;
    }
    return {correct: true, done: this.#state.phase === "done", stars: this.#state.stars};
  }

  hint() {
    if (this.#state.phase !== "present") throw Error("No current problem to hint.");
    if (this.#state.current.choices.length <= 2) throw Error("No hint remains for this problem.");
    const wrong = this.#state.current.choices.filter(value => value !== this.#state.current.answer);
    const removed = this.#rng.pick(wrong);
    this.#state.current.choices = this.#state.current.choices.filter(value => value !== removed);
    this.#state.hintsUsed++;
    this.#state.rngState = this.#rng.state;
    return removed;
  }

  continueAfterMiss() {
    if (this.#state.phase !== "miss-model" || !this.#state.related) throw Error("No missed problem is being explained.");
    this.#state.current = this.#state.related;
    this.#state.related = null;
    this.#state.phase = "present";
  }

  encodeSave() {
    this.#state.rngState = this.#rng.state;
    return encodeSave(MATH_PATH_APP_ID, clone(this.#state), MATH_PATH_CONTENT_VERSION);
  }
}

const snapshotShape = {
  version: "", seed: "", rngState: 0, grade: 3, phase: "", route: [], index: 0,
  current: null, related: null, skills: {}, hintsUsed: 0, stars: 0, firstTry: 0, attempts: 0, attemptsForCell: 0,
};

function makeProblem(skill, grade, difficulty, rng) {
  let left, op, right, answer;
  if (skill === "add") {
    const maximum = grade === 3 ? [20, 50, 100][difficulty - 1] : [50, 100, 200][difficulty - 1];
    left = rng.int(0, maximum);
    right = rng.int(0, Math.max(0, maximum - left));
    op = "+";
    answer = left + right;
  } else if (skill === "subtract") {
    const maximum = grade === 3 ? [20, 50, 100][difficulty - 1] : [50, 100, 200][difficulty - 1];
    left = rng.int(0, maximum);
    right = rng.int(0, left);
    op = "−";
    answer = left - right;
  } else if (skill === "multiply") {
    const maximum = [5, 9, 12][difficulty - 1];
    left = rng.int(0, maximum);
    right = rng.int(0, maximum);
    op = "×";
    answer = left * right;
  } else if (skill === "mixed") {
    const maximum = [5, 9, 12][difficulty - 1];
    left = rng.int(0, maximum);
    right = rng.int(0, maximum);
    const third = rng.int(0, 100);
    if (rng.int(0, 1) === 0) {
      op = "×";
      answer = left * right + third;
      const choices = answerChoices(answer, rng);
      return {skill, left, op, right, answer, choices, second: {op: "+", value: third}};
    }
    op = "+";
    answer = left + right * third;
    const choices = answerChoices(answer, rng);
    return {skill, left, op, right, answer, choices, second: {op: "×", value: third}};
  } else {
    const maximum = [5, 9, 12][difficulty - 1];
    right = rng.int(1, maximum);
    answer = rng.int(0, maximum);
    left = right * answer;
    op = "÷";
  }
  const choices = answerChoices(answer, rng);
  return {skill, left, op, right, answer, choices, second: null};
}

function makeDifferentProblem(previous, grade, difficulty, rng) {
  for (let count = 0; count < 20; count++) {
    const problem = makeProblem(previous.skill, grade, difficulty, rng);
    if (JSON.stringify(problem) !== JSON.stringify(previous)) return problem;
  }
  throw Error("Could not generate a related problem.");
}

function answerChoices(answer, rng) {
  const values = new Set([answer]);
  const candidates = [answer - 1, answer + 1, answer - 2, answer + 2, answer - 10, answer + 10];
  for (const candidate of rng.shuffle(candidates)) {
    if (candidate >= 0) values.add(candidate);
    if (values.size === 4) break;
  }
  for (let candidate = 0; values.size < 4; candidate++) values.add(candidate + answer + values.size * 3);
  return rng.shuffle([...values]);
}

function workedModel(problem) {
  if (problem.skill === "add") return `${problem.left} + ${problem.right} = ${problem.answer}`;
  if (problem.skill === "subtract") return `${problem.left} − ${problem.right} = ${problem.answer}`;
  if (problem.skill === "multiply") return `${problem.left} groups of ${problem.right} make ${problem.answer}`;
  if (problem.skill === "divide") return `${problem.left} split into ${problem.right} equal groups makes ${problem.answer}`;
  return `${problem.left} ${problem.op} ${problem.right}, then ${problem.second.op} ${problem.second.value}, makes ${problem.answer}`;
}

function starCount(firstTry) {
  if (firstTry >= 16) return 3;
  if (firstTry >= 12) return 2;
  return 1;
}

function validProblem(problem, grade) {
  const skills = grade === 3 ? SKILLS : GRADE_4_SKILLS;
  if (!exactKeys(problem, ["skill", "left", "op", "right", "answer", "choices", "second"])) return false;
  if (!oneOf(problem.skill, skills) || !integer(problem.left, 0, 999) || !integer(problem.right, 0, 999) ||
      !integer(problem.answer, 0, 99999) || !uniqueNumbers(problem.choices, 0, 99999) ||
      problem.choices.length < 2 || problem.choices.length > 4 ||
      problem.choices.filter(value => value === problem.answer).length !== 1) return false;
  if (problem.skill === "add") return problem.second === null && problem.op === "+" && problem.left + problem.right === problem.answer;
  if (problem.skill === "subtract") return problem.second === null && problem.op === "−" && problem.left - problem.right === problem.answer;
  if (problem.skill === "multiply") return problem.second === null && problem.op === "×" && problem.left * problem.right === problem.answer;
  if (problem.skill === "divide") return problem.second === null && problem.op === "÷" && problem.right > 0 && problem.left === problem.right * problem.answer;
  if (problem.skill !== "mixed") return false;
  if (!exactKeys(problem.second, ["op", "value"]) || !oneOf(problem.second.op, ["+", "×"]) ||
      !integer(problem.second.value, 0, 100)) return false;
  if (problem.op === "×" && problem.second.op === "+") return problem.left * problem.right + problem.second.value === problem.answer;
  if (problem.op === "+" && problem.second.op === "×") return problem.left + problem.right * problem.second.value === problem.answer;
  return false;
}

function validatePayload(state) {
  if (!exactKeys(state, Object.keys(snapshotShape))) throw Error("Invalid Math Path snapshot.");
  const skills = state.grade === 3 ? SKILLS : GRADE_4_SKILLS;
  if (state.version !== MATH_PATH_CONTENT_VERSION || typeof state.seed !== "string" ||
      !integer(state.rngState, 0, 0xffffffff) || !oneOf(state.grade, [3, 4]) ||
      !oneOf(state.phase, ["present", "miss-model", "done"]) ||
      !Array.isArray(state.route) || state.route.length !== ROUTE_LENGTH || !state.route.every(skill => oneOf(skill, skills)) ||
      !integer(state.index, 0, ROUTE_LENGTH) || !integer(state.stars, 0, 3) ||
      !integer(state.hintsUsed, 0, 10000) ||
      !integer(state.firstTry, 0, ROUTE_LENGTH) || !integer(state.attempts, 0, 10000) ||
      !integer(state.attemptsForCell, 0, 1000) || !plainObject(state.skills)) {
    throw Error("Invalid Math Path snapshot.");
  }
  if (!exactKeys(state.skills, skills)) throw Error("Invalid Math Path skill profile.");
  for (const profile of Object.values(state.skills)) {
    if (!exactKeys(profile, ["answered", "correct", "difficulty"]) ||
        !integer(profile.answered, 0, 10000) || !integer(profile.correct, 0, profile.answered) ||
        !integer(profile.difficulty, 1, 3)) throw Error("Invalid Math Path skill profile.");
  }
  if (state.phase === "done") {
    if (state.index !== ROUTE_LENGTH || state.current !== null || state.related !== null) throw Error("Invalid completed Math Path state.");
  } else if (state.phase === "present") {
    if (state.index >= ROUTE_LENGTH || !validProblem(state.current, state.grade) || state.related !== null) {
      throw Error("Invalid active Math Path problem.");
    }
  } else if (state.index >= ROUTE_LENGTH || !validProblem(state.current, state.grade) ||
      !validProblem(state.related, state.grade) || state.related.skill !== state.current.skill) {
    throw Error("Invalid related Math Path problem.");
  }
}
