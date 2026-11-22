import {connectGameFiles} from '@webos/learning-game-core/workspace';
import {MathPathSession} from './model.mjs';
import {computeLayout} from './layout.mjs';

function formatProblem(p) {
  if (!p) return '';
  if (p.second) {
    return `${p.left} ${p.op} ${p.right} ${p.second.op} ${p.second.value} = ?`;
  }
  return `${p.left} ${p.op} ${p.right} = ?`;
}

function createElement(host, tag, className, text) {
  if (host?.ui?.make) {
    return host.ui.make(tag, className, text);
  }
  if (typeof document !== 'undefined') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }
  return {
    tagName: tag.toUpperCase(),
    className: className || '',
    dataset: {},
    children: [],
    style: {},
    append(...kids) { this.children.push(...kids); },
    replaceChildren(...kids) { this.children = kids ? [...kids] : []; },
    setAttribute() {},
    removeAttribute() {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
    removeEventListener() {}
  };
}

export function mount(host, options = {}) {
  const root = createElement(host, 'div', 'window-content math-path-app');

  let grade = options.grade || 3;
  let session = new MathPathSession(`path-${Date.now()}`, grade);
  let disposed = false;
  let resizeObserver = null;

  // Header
  const header = createElement(host, 'header', 'path-header');
  const titleGroup = createElement(host, 'div', 'path-title-group');
  const title = createElement(host, 'h1', 'path-title', '🐾 Math Path');
  titleGroup.append(title);

  const stats = createElement(host, 'div', 'path-stats');

  const gradeSelect = createElement(host, 'select', 'path-grade-select');
  gradeSelect.setAttribute?.('aria-label', 'Grade');
  if (typeof document !== 'undefined' && gradeSelect instanceof HTMLElement) {
    gradeSelect.innerHTML = '<option value="3">Grade 3</option><option value="4">Grade 4</option>';
    gradeSelect.value = String(grade);
    gradeSelect.onchange = () => {
      grade = Number(gradeSelect.value);
      session = new MathPathSession(`path-${Date.now()}`, grade);
      render();
    };
  }

  const progressBadge = createElement(host, 'span', 'path-badge path-progress');
  const starsBadge = createElement(host, 'span', 'path-badge path-stars');

  stats.append(gradeSelect, progressBadge, starsBadge);
  header.append(titleGroup, stats);

  // Main
  const main = createElement(host, 'main', 'path-main');

  // Left: 18 Stepping Stones Route
  const routeSection = createElement(host, 'section', 'path-route-section');
  routeSection.setAttribute?.('aria-label', 'Stepping Stones Route');
  const stoneGrid = createElement(host, 'div', 'path-stone-grid');
  routeSection.append(stoneGrid);

  // Right: Math Challenge Workbench
  const workbench = createElement(host, 'section', 'path-workbench');
  workbench.setAttribute?.('aria-label', 'Challenge Workbench');

  // Footer Controls
  const controls = createElement(host, 'footer', 'path-controls');

  const hintBtn = createElement(host, 'button', 'path-btn path-btn-secondary', '💡 Hint');
  hintBtn.onclick = () => {
    if (session.phase === 'present') {
      try {
        const removed = session.hint();
        if (removed !== undefined) render();
      } catch {}
    }
  };

  const newPathBtn = createElement(host, 'button', 'path-btn path-btn-outline', '🗺️ New Path');
  newPathBtn.onclick = () => {
    session = new MathPathSession(`path-${Date.now()}`, grade);
    render();
  };

  controls.append(hintBtn, newPathBtn);

  main.append(routeSection, workbench);
  root.append(header, main, controls);

  function renderRoute() {
    stoneGrid.replaceChildren();
    const route = session.state.route;
    route.forEach((skill, idx) => {
      const stone = createElement(host, 'div', 'path-stone');
      if (idx === session.index) stone.classList?.add('active');
      if (idx < session.index) stone.classList?.add('cleared');

      const stoneNum = createElement(host, 'div', 'stone-num', String(idx + 1));
      const stoneSkill = createElement(host, 'div', 'stone-skill', skill);
      const stoneIcon = createElement(host, 'div', 'stone-icon', idx < session.index ? '⭐' : idx === session.index ? '🐾' : '⚪');

      stone.append(stoneNum, stoneSkill, stoneIcon);
      stoneGrid.append(stone);
    });
  }

  function renderWorkbench() {
    workbench.replaceChildren();
    progressBadge.textContent = `Stone ${Math.min(session.index + 1, 18)} / 18`;
    starsBadge.textContent = `⭐ ${session.stars} stars`;

    if (session.phase === 'done') {
      const doneBox = createElement(host, 'div', 'path-card path-done');
      const heading = createElement(host, 'h2', '', '🎉 Trail Conquered!');
      const summary = createElement(host, 'p', '', `Fantastic expedition! You stepped across all 18 math stones with ${session.stars} stars. Hints used: ${session.hintsUsed}.`);

      const restartBtn = createElement(host, 'button', 'path-btn path-btn-primary', 'Traverse Another Route');
      restartBtn.onclick = () => {
        session = new MathPathSession(`path-${Date.now()}`, grade);
        render();
      };

      doneBox.append(heading, summary, restartBtn);
      workbench.append(doneBox);
      return;
    }

    if (session.phase === 'miss-model') {
      const explainCard = createElement(host, 'div', 'path-card path-explain');
      const heading = createElement(host, 'h2', '', '🔍 Worked Step-by-Step Model');
      const prompt = createElement(host, 'p', '', 'Examine this solution step to balance your trail pace:');

      const continueBtn = createElement(host, 'button', 'path-btn path-btn-primary', 'Continue Expedition ▶');
      continueBtn.onclick = () => {
        session.continueAfterMiss();
        render();
      };

      explainCard.append(heading, prompt, continueBtn);
      workbench.append(explainCard);
      return;
    }

    const current = session.current;
    if (!current) return;

    const problemCard = createElement(host, 'div', 'path-card problem-card');
    const skillBadge = createElement(host, 'div', 'problem-skill', `SKILL: ${current.skill.toUpperCase()}`);
    const equationText = createElement(host, 'div', 'problem-equation', formatProblem(current));

    problemCard.append(skillBadge, equationText);

    // 4 choices
    const choicesGroup = createElement(host, 'div', 'problem-choices');
    current.choices.forEach(choice => {
      const btn = createElement(host, 'button', 'path-choice-btn', String(choice));
      btn.onclick = () => {
        session.answer(choice);
        render();
      };
      choicesGroup.append(btn);
    });

    problemCard.append(choicesGroup);
    workbench.append(problemCard);
  }

  function render() {
    if (disposed) return;
    renderRoute();
    renderWorkbench();
  }

  const files = connectGameFiles(host, {
    header,
    id: 'math-path',
    title: 'Math Path',
    serialize: () => session.encodeSave(),
    restore(snapshot) {
      session = MathPathSession.fromSave(snapshot);
      grade = session.grade;
      gradeSelect.value = String(grade);
      render();
    },
  });

  render();

  if (typeof ResizeObserver !== 'undefined' && root.getBoundingClientRect) {
    resizeObserver = new ResizeObserver(([entry]) => {
      const {width, height} = entry.contentRect;
      const layout = computeLayout(width, height);
      if (root.dataset) root.dataset.tier = layout.tier;
    });
    resizeObserver.observe(root);
  }

  return {
    element: root,
    get session() { return session; },
    ready: files.ready,
    requestClose: files.requestClose,
    dispose() {
      files.dispose?.();
      disposed = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      root.replaceChildren?.();
    }
  };
}
