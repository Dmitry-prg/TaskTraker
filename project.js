(() => {
  'use strict';
  const {
    Store, setupThemeButton,
    formatDate, formatDateShort, humanRange, daysLeftLabel,
    toDate, STATUS_CYCLE, DAY,
  } = TT;

  const params = new URLSearchParams(location.search);
  const projectId = Number(params.get('id'));
  if (!projectId) {
    document.querySelector('.container').innerHTML = `
      <div class="empty">
        <span class="empty-icon">🔍</span>
        <p>Проект не найден</p>
        <p class="hint"><a href="index.html">← Вернуться к списку</a></p>
      </div>`;
    return;
  }

  const els = {
    name:          document.getElementById('projectName'),
    meta:          document.getElementById('projectMeta'),
    progress:      document.getElementById('projectProgress'),
    addTaskBtn:    document.getElementById('addTaskBtn'),
    editBtn:       document.getElementById('editProjectBtn'),
    delBtn:        document.getElementById('deleteProjectBtn'),
    taskDialog:    document.getElementById('taskDialog'),
    taskForm:      document.getElementById('taskForm'),
    taskTitle:     document.getElementById('taskDialogTitle'),
    cancelTask:    document.getElementById('cancelTask'),
    projectDialog: document.getElementById('projectDialog'),
    projectForm:   document.getElementById('projectForm'),
    cancelProject: document.getElementById('cancelProject'),
    gantt:         document.getElementById('gantt'),
    subtasksList:  document.getElementById('subtasksList'),
    subtasksCounter: document.getElementById('subtasksCounter'),
    subtaskInput:  document.getElementById('subtaskInput'),
    subtaskAddBtn: document.getElementById('subtaskAddBtn'),
  };

  const tTitle  = document.getElementById('tTitle');
  const tStart  = document.getElementById('tStart');
  const tEnd    = document.getElementById('tEnd');
  const tStatus = document.getElementById('tStatus');

  const pName  = document.getElementById('pName');
  const pDesc  = document.getElementById('pDesc');
  const pStart = document.getElementById('pStart');
  const pEnd   = document.getElementById('pEnd');

  setupThemeButton(document.getElementById('themeBtn'));

  let project = null;
  let tasks = [];
  let editingTaskId = null;
  let draggedTaskId = null;
  let dialogSubtasks = [];

  /* Состояние Gantt:
     ganttDataRange — полный диапазон данных (проект + все задачи), в мс
     ganttView      — текущий видимый диапазон (зум + панорамирование), в мс */
  let ganttDataRange = null;
  let ganttView = null;

  function uid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* Прогресс задачи:
     • есть подзадачи  → done/total (если статус done — 100%)
     • нет подзадач: todo → 0, in_progress → 50, done → 100 */
  function taskProgress(task) {
    const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
    if (subs.length) {
      if (task.status === 'done') return 100;
      const done = subs.filter(s => s.done).length;
      return Math.round((done / subs.length) * 100);
    }
    if (task.status === 'done') return 100;
    if (task.status === 'in_progress') return 50;
    return 0;
  }

  /* ============================================================
     Загрузка
     ============================================================ */
  async function load() {
    project = await Store.getProject(projectId);
    if (!project) {
      document.querySelector('.container').innerHTML = `
        <div class="empty">
          <span class="empty-icon">🔍</span>
          <p>Проект не найден</p>
          <p class="hint"><a href="index.html">← Вернуться к списку</a></p>
        </div>`;
      return;
    }
    tasks = await Store.tasksOfProject(projectId);
    document.title = `${project.name} — Task Tracker`;
    renderHeader();
    renderKanban();
    renderGantt();
  }

  function renderHeader() {
    els.name.textContent = project.name;
    const bits = [];
    const range = humanRange(project.start_date, project.end_date);
    if (range) bits.push(range);
    const left = daysLeftLabel(project.end_date);
    if (left) bits.push(left);
    els.meta.textContent = bits.join(' · ') || 'Сроки не заданы';
    els.meta.classList.toggle('is-overdue', !!left && left.includes('просроч'));

    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    els.progress.innerHTML = `
      <div class="progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
        <span class="progress-text${total && done === total ? ' is-done' : ''}">
          ${done}/${total}${total ? ` · ${percent}%` : ''}
        </span>
      </div>`;
  }

  /* ============================================================
     Канбан
     ============================================================ */
  function renderKanban() {
    for (const status of STATUS_CYCLE) {
      const list = document.querySelector(`.kanban-list[data-status="${status}"]`);
      const countEl = document.querySelector(`.kanban-col[data-status="${status}"] .count`);
      const listTasks = tasks.filter(t => t.status === status);
      countEl.textContent = listTasks.length;
      list.innerHTML = '';
      for (const task of listTasks) list.appendChild(buildKanbanCard(task));
    }
  }

  function buildKanbanCard(task) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.dataset.taskId = task.id;
    card.dataset.order = task.order ?? task.id;
    card.dataset.status = task.status;
    card.draggable = true;

    const titleEl = document.createElement('div');
    titleEl.className = 'task-title';
    titleEl.textContent = task.title;
    card.appendChild(titleEl);

    const subs = Array.isArray(task.subtasks) ? task.subtasks : [];
    const metaBits = [];
    if (task.start_date || task.end_date) {
      const dstr = [
        task.start_date && formatDateShort(task.start_date),
        task.end_date && formatDateShort(task.end_date),
      ].filter(Boolean).join(' — ');
      metaBits.push('📅 ' + dstr);
    }
    if (subs.length) {
      const dc = subs.filter(s => s.done).length;
      metaBits.push(`✓ ${dc}/${subs.length}`);
    } else {
      metaBits.push(`📊 ${taskProgress(task)}%`);
    }
    if (metaBits.length) {
      const meta = document.createElement('div');
      meta.className = 'task-meta';
      meta.textContent = metaBits.join('  ·  ');
      card.appendChild(meta);
    }

    const pct = taskProgress(task);
    const bar = document.createElement('div');
    bar.className = 'task-sub-progress';
    const fill = document.createElement('span');
    fill.style.width = pct + '%';
    if (task.status === 'in_progress' && !subs.length) {
      fill.style.background = 'linear-gradient(90deg, #d97706, #f59e0b)';
    } else if (task.status === 'done' && !subs.length) {
      fill.style.background = 'linear-gradient(90deg, #16a34a, #22c55e)';
    }
    bar.appendChild(fill);
    card.appendChild(bar);

    const actions = document.createElement('div');
    actions.className = 'task-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-icon small';
    editBtn.title = 'Изменить';
    editBtn.setAttribute('aria-label', 'Изменить');
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>`;
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskDialog(task);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-icon small danger';
    delBtn.title = 'Удалить';
    delBtn.setAttribute('aria-label', 'Удалить');
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
           stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>`;
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Удалить задачу «${task.title}»?`)) return;
      card.classList.add('removing');
      await new Promise(r => setTimeout(r, 180));
      await Store.deleteTask(task.id);
      await load();
    });

    actions.append(editBtn, delBtn);
    card.appendChild(actions);

    card.addEventListener('dragstart', (e) => {
      draggedTaskId = task.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(task.id));
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      draggedTaskId = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.kanban-list').forEach(l => l.classList.remove('drop-target'));
      document.querySelectorAll('.kanban-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (Number(card.dataset.taskId) === draggedTaskId) return;
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));

    return card;
  }

  document.querySelectorAll('.kanban-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      list.classList.add('drop-target');
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove('drop-target');
    });
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drop-target');
      const id = Number(e.dataTransfer.getData('text/plain')) || draggedTaskId;
      if (!id) return;
      const newStatus = list.dataset.status;

      const afterEl = getDragAfterElement(list, e.clientY);
      const cards = [...list.querySelectorAll('.kanban-card')]
        .filter(c => Number(c.dataset.taskId) !== id);

      let order;
      if (!afterEl) {
        const last = cards[cards.length - 1];
        order = last ? Number(last.dataset.order) + 1 : Date.now() / 1000;
      } else {
        const idx = cards.indexOf(afterEl);
        const before = cards[idx - 1];
        const oAfter = Number(afterEl.dataset.order);
        order = before ? (Number(before.dataset.order) + oAfter) / 2 : oAfter - 1;
      }

      await Store.updateTask(id, { status: newStatus, order });
      await load();
    });
  });

  function getDragAfterElement(container, y) {
    const els = [...container.querySelectorAll('.kanban-card:not(.dragging)')];
    return els.reduce((closest, el) => {
      const box = el.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: el };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  /* ============================================================
     Gantt: диапазон данных и отрисовка
     ============================================================ */

  /* Полный диапазон (проект + задачи) в мс с небольшим отступом.
     Возвращает null, если ни у проекта, ни у задач нет дат. */
  function computeGanttDataRange() {
    let minD = toDate(project.start_date);
    let maxD = toDate(project.end_date);
    for (const t of tasks) {
      const s = toDate(t.start_date), e = toDate(t.end_date);
      if (s && (!minD || s < minD)) minD = s;
      if (e && (!maxD || e > maxD)) maxD = e;
    }
    if (!minD && !maxD) return null;
    if (!minD) minD = new Date(maxD.getTime() - 30 * DAY);
    if (!maxD) maxD = new Date(minD.getTime() + 30 * DAY);
    if (maxD <= minD) maxD = new Date(minD.getTime() + 7 * DAY);

    const min = minD.getTime();
    const max = maxD.getTime() + DAY; // включаем последний день целиком
    const pad = (max - min) * 0.02;   // 2% «воздуха» по краям
    return { min: min - pad, max: max + pad };
  }

  /* Первичная отрисовка: считаем данные и сбрасываем вид */
  function renderGantt() {
    ganttDataRange = computeGanttDataRange();
    if (!ganttDataRange) {
      ganttView = null;
      els.gantt.innerHTML = `
        <div class="empty small">
          <span class="empty-icon">📊</span>
          <p>Задайте сроки проекта или задач — появится график</p>
        </div>`;
      return;
    }
    ganttView = { ...ganttDataRange };
    drawGantt();
  }

  /* Отрисовка по текущему ganttView (вызывается при зум/пане) */
  function drawGantt() {
    if (!ganttView || !ganttDataRange) return;
    const container = els.gantt;
    container.innerHTML = '';

    const minT = ganttView.min;
    const maxT = ganttView.max;
    const span = maxT - minT || DAY;
    const pct = (t) => ((t - minT) / span) * 100;

    /* Границы проекта */
    const projStartD = toDate(project.start_date);
    const projEndD   = toDate(project.end_date);
    const projStartPct = projStartD ? pct(projStartD.getTime()) : null;
    const projEndPct   = projEndD   ? pct(projEndD.getTime() + DAY) : null;

    /* Тики — шаг подбираем по видимому диапазону */
    const totalDays = Math.ceil((maxT - minT) / DAY);
    let stepDays;
    if (totalDays <= 10) stepDays = 1;
    else if (totalDays <= 30) stepDays = 3;
    else if (totalDays <= 90) stepDays = 7;
    else if (totalDays <= 365) stepDays = 30;
    else stepDays = 90;

    const ticks = [];
    // округляем начало к ближайшему целому дню назад, чтобы сетка была стабильной
    const startDay = Math.floor(minT / DAY) * DAY;
    for (let t = startDay; t <= maxT + DAY; t += stepDays * DAY) {
      const centerT = t + DAY / 2;
      const centerPct = pct(centerT);
      if (centerPct < -0.5 || centerPct > 100.5) continue;
      const d = new Date(t);
      ticks.push({
        left: centerPct,
        label: stepDays >= 7
          ? d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
          : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      });
    }

    /* Сегодня */
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMid = new Date();
    todayMid.setHours(12, 0, 0, 0);

    const todayColLeft  = pct(todayStart.getTime());
    const todayColRight = pct(todayStart.getTime() + DAY);
    const todayPct      = pct(todayMid.getTime());
    const showToday     = todayColRight >= 0 && todayColLeft <= 100;

    /* Слои */
    function addTodayColumn(track) {
      if (!showToday) return;
      const left = Math.max(todayColLeft, 0);
      const right = Math.min(todayColRight, 100);
      const col = document.createElement('div');
      col.className = 'gantt-today-col';
      col.style.left = left + '%';
      col.style.width = (right - left) + '%';
      col.title = 'Текущий день';
      track.appendChild(col);
    }

    function addMasks(track) {
      if (projStartPct !== null && projStartPct > 0.05) {
        const m = document.createElement('div');
        m.className = 'gantt-mask gantt-mask-left';
        m.style.left = '0%';
        m.style.width = Math.min(projStartPct, 100) + '%';
        m.title = 'Область до старта проекта';
        track.appendChild(m);
      }
      if (projEndPct !== null && projEndPct < 99.95) {
        const left = Math.max(projEndPct, 0);
        const m = document.createElement('div');
        m.className = 'gantt-mask gantt-mask-right';
        m.style.left = left + '%';
        m.style.width = (100 - left) + '%';
        m.title = 'Область после срока проекта';
        track.appendChild(m);
      }
    }

    function addBounds(track) {
      if (projStartPct !== null && projStartPct >= -2 && projStartPct <= 102) {
        const l = document.createElement('div');
        l.className = 'gantt-bound gantt-bound-start';
        l.style.left = projStartPct + '%';
        l.title = 'Старт проекта' +
          (project.start_date ? ': ' + formatDate(project.start_date) : '');
        track.appendChild(l);
      }
      if (projEndPct !== null && projEndPct >= -2 && projEndPct <= 102) {
        const l = document.createElement('div');
        l.className = 'gantt-bound gantt-bound-end';
        l.style.left = projEndPct + '%';
        l.title = 'Срок проекта' +
          (project.end_date ? ': ' + formatDate(project.end_date) : '');
        track.appendChild(l);
      }
    }

    function addTodayLine(track) {
      if (!showToday) return;
      const line = document.createElement('div');
      line.className = 'gantt-today';
      line.style.left = todayPct + '%';
      track.appendChild(line);
    }

    /* Ось */
    const head = document.createElement('div');
    head.className = 'gantt-row gantt-head';
    head.innerHTML = `<div class="gantt-label"></div><div class="gantt-track gantt-axis"></div>`;
    const axis = head.querySelector('.gantt-axis');

    addTodayColumn(axis);
    for (const tick of ticks) {
      const el = document.createElement('div');
      el.className = 'gantt-tick';
      el.style.left = tick.left + '%';
      el.textContent = tick.label;
      axis.appendChild(el);
    }
    addBounds(axis);
    addTodayLine(axis);
    container.appendChild(head);

    if (!tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty small';
      empty.innerHTML = `<p class="hint">Пока нет задач</p>`;
      container.appendChild(empty);
      return;
    }

    /* Строки задач */
    for (const task of tasks) {
      const s = toDate(task.start_date);
      const e = toDate(task.end_date);

      const row = document.createElement('div');
      row.className = 'gantt-row';

      const pctVal = taskProgress(task);
      const labelWrap = document.createElement('div');
      labelWrap.className = 'gantt-label-wrap';

      const label = document.createElement('div');
      label.className = 'gantt-label';
      label.textContent = task.title;
      label.title = task.title;

      const pctBadge = document.createElement('span');
      pctBadge.className = 'gantt-pct' +
        (pctVal === 100 ? ' is-full' : pctVal === 0 ? ' is-zero' : '');
      pctBadge.textContent = pctVal + '%';

      labelWrap.append(label, pctBadge);

      const track = document.createElement('div');
      track.className = 'gantt-track';

      addTodayColumn(track);

      let rightEdgePct = null;
      let outOfBounds = false;

      if (s || e) {
        const ss = s ? s.getTime() : e.getTime();
        const ee = e ? e.getTime() : s.getTime();
        const left = pct(ss);
        const right = pct(ee + DAY);
        const width = Math.max(right - left, 0.8);
        rightEdgePct = left + width;

        outOfBounds =
          (projStartD && s && s < projStartD) ||
          (projEndD   && e && e > projEndD);

        const bar = document.createElement('div');
        const cls = task.status === 'done' ? 'done'
                  : task.status === 'in_progress' ? 'in_progress' : '';
        const emptyCls = (!Array.isArray(task.subtasks) || !task.subtasks.length) &&
                         task.status === 'todo' ? ' is-empty' : '';
        bar.className = 'gantt-bar ' + cls + emptyCls +
                        (outOfBounds ? ' out-of-bounds' : '');
        bar.style.left = left + '%';
        bar.style.width = width + '%';
        bar.title =
          `${task.title}\n` +
          `Прогресс: ${pctVal}%\n` +
          `${formatDate(task.start_date) || '—'} → ${formatDate(task.end_date) || '—'}` +
          (outOfBounds ? '\n⚠ Задача выходит за рамки проекта' : '');

        const fill = document.createElement('div');
        fill.className = 'gantt-bar-fill';
        fill.style.width = pctVal + '%';
        bar.appendChild(fill);

        track.appendChild(bar);
      } else {
        const hint = document.createElement('div');
        hint.className = 'gantt-hint';
        hint.textContent = 'даты не заданы';
        track.appendChild(hint);
      }

      addMasks(track);

      if (outOfBounds && rightEdgePct !== null) {
        const warn = document.createElement('div');
        warn.className = 'gantt-warn';
        const warnPct = Math.min(Math.max(rightEdgePct - 1.5, 1), 99);
        warn.style.left = warnPct + '%';
        warn.textContent = '!';
        warn.title = 'Задача выходит за рамки проекта';
        track.appendChild(warn);
      }

      addBounds(track);
      addTodayLine(track);

      row.append(labelWrap, track);
      container.appendChild(row);
    }
  }

  /* ============================================================
     Взаимодействия с Gantt:
     • зум колёсиком (вокруг курсора)
     • панорамирование правой кнопкой мыши
     • двойной клик — сброс к полному диапазону
     ============================================================ */

  /* Ограничиваем видимый диапазон рамками данных */
  function clampGanttView(newMin, newMax) {
    const limitMin = ganttDataRange.min;
    const limitMax = ganttDataRange.max;
    const vSpan = newMax - newMin;
    const rangeSpan = limitMax - limitMin;

    // если вид шире данных — фиксируем на полный диапазон
    if (vSpan >= rangeSpan) {
      return { min: limitMin, max: limitMax };
    }
    if (newMin < limitMin) { newMin = limitMin; newMax = newMin + vSpan; }
    if (newMax > limitMax) { newMax = limitMax; newMin = newMax - vSpan; }
    return { min: newMin, max: newMax };
  }

  function initGanttInteractions() {
    const el = els.gantt;
    if (!el) return;

    /* --- Зум колёсиком --- */
    el.addEventListener('wheel', (e) => {
      if (!ganttView || !ganttDataRange) return;
      const axis = el.querySelector('.gantt-axis');
      if (!axis) return;

      e.preventDefault(); // блокируем прокрутку страницы

      const rect = axis.getBoundingClientRect();
      let xPct = (e.clientX - rect.left) / rect.width;
      xPct = Math.max(0, Math.min(1, xPct));

      const span = ganttView.max - ganttView.min;
      const cursorTime = ganttView.min + xPct * span;

      // Плавный шаг: чувствительность ~exp(0.2 * deltaY/100).
      // Мышь (deltaY ≈ ±100) → ~±22% за клик; трекпад — мягче.
      const norm = Math.max(-3, Math.min(3, e.deltaY / 100));
      const factor = Math.exp(norm * 0.2);

      let newSpan = span * factor;

      // Минимальный видимый диапазон: не меньше ~1 дня,
      // но не больше 1/10 всего диапазона данных.
      const dataSpan = ganttDataRange.max - ganttDataRange.min;
      const minSpan = Math.min(DAY, dataSpan / 10);
      newSpan = Math.max(minSpan, newSpan);

      // Точка под курсором остаётся на месте
      let newMin = cursorTime - xPct * newSpan;
      let newMax = newMin + newSpan;

      ganttView = clampGanttView(newMin, newMax);
      drawGantt();
    }, { passive: false });

    /* --- Панорамирование правой кнопкой --- */
    let pan = null;

    el.addEventListener('mousedown', (e) => {
      if (e.button !== 2 || !ganttView || !ganttDataRange) return;
      const axis = el.querySelector('.gantt-axis');
      if (!axis) return;
      e.preventDefault();
      const rect = axis.getBoundingClientRect();
      pan = {
        startX: e.clientX,
        width: rect.width,
        view: { ...ganttView },
      };
      el.classList.add('panning');
      document.body.classList.add('is-panning');
    });

    window.addEventListener('mousemove', (e) => {
      if (!pan) return;
      const dx = e.clientX - pan.startX;
      const span = pan.view.max - pan.view.min;
      const dt = -(dx / pan.width) * span; // влево тянем → время вперёд
      let newMin = pan.view.min + dt;
      let newMax = pan.view.max + dt;
      ganttView = clampGanttView(newMin, newMax);
      drawGantt();
    });

    function endPan() {
      if (!pan) return;
      pan = null;
      el.classList.remove('panning');
      document.body.classList.remove('is-panning');
    }

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) endPan();
    });

    // подстраховка: если фокус потерян — сбрасываем режим
    window.addEventListener('blur', endPan);
    window.addEventListener('mouseleave', endPan);

    // отключаем контекстное меню над графиком
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // двойной клик — сброс к полному диапазону
    el.addEventListener('dblclick', () => {
      if (!ganttDataRange) return;
      ganttView = { ...ganttDataRange };
      drawGantt();
    });
  }

  /* ============================================================
     Подзадачи
     ============================================================ */
  function renderSubtasks() {
    const list = els.subtasksList;
    list.innerHTML = '';

    const total = dialogSubtasks.length;
    const done = dialogSubtasks.filter(s => s.done).length;

    els.subtasksCounter.textContent = `${done}/${total}`;
    els.subtasksCounter.classList.toggle('is-done', total > 0 && done === total);

    for (const sub of dialogSubtasks) {
      const row = document.createElement('div');
      row.className = 'subtask' + (sub.done ? ' done' : '');
      row.dataset.subId = sub.id;

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'subtask-check' + (sub.done ? ' done' : '');
      check.setAttribute('aria-pressed', String(!!sub.done));
      check.setAttribute('aria-label',
        sub.done ? 'Отметить как невыполненную' : 'Отметить как выполненную');
      check.addEventListener('click', () => {
        sub.done = !sub.done;
        renderSubtasks();
      });

      const title = document.createElement('span');
      title.className = 'subtask-title';
      title.textContent = sub.title;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'subtask-del';
      del.setAttribute('aria-label', 'Удалить подзадачу');
      del.title = 'Удалить подзадачу';
      del.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none"
             stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>`;
      del.addEventListener('click', () => {
        dialogSubtasks = dialogSubtasks.filter(s => s.id !== sub.id);
        renderSubtasks();
      });

      row.append(check, title, del);
      list.appendChild(row);
    }
  }

  function addSubtaskFromInput() {
    const title = els.subtaskInput.value.trim();
    if (!title) return;
    dialogSubtasks.push({ id: uid(), title, done: false });
    els.subtaskInput.value = '';
    els.subtaskInput.focus();
    renderSubtasks();
  }

  els.subtaskAddBtn.addEventListener('click', addSubtaskFromInput);
  els.subtaskInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubtaskFromInput();
    }
  });

  /* ============================================================
     Диалог задачи
     ============================================================ */
  function openTaskDialog(task) {
    editingTaskId = task?.id ?? null;
    els.taskTitle.textContent = task ? 'Редактировать задачу' : 'Новая задача';

    tTitle.value  = task?.title      ?? '';
    tStart.value  = task?.start_date ?? '';
    tEnd.value    = task?.end_date   ?? '';
    tStatus.value = task?.status     ?? 'todo';

    dialogSubtasks = Array.isArray(task?.subtasks)
      ? task.subtasks.map(s => ({ id: s.id || uid(), title: s.title, done: !!s.done }))
      : [];

    els.subtaskInput.value = '';
    renderSubtasks();

    if (!els.taskDialog.open) els.taskDialog.showModal();
    setTimeout(() => tTitle.focus(), 60);
  }

  els.addTaskBtn.addEventListener('click', () => openTaskDialog(null));
  els.cancelTask.addEventListener('click', () => els.taskDialog.close());
  els.taskDialog.addEventListener('click', (e) => {
    if (e.target === els.taskDialog) els.taskDialog.close();
  });

  els.taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title:      tTitle.value.trim(),
      start_date: tStart.value || null,
      end_date:   tEnd.value   || null,
      status:     tStatus.value,
      subtasks:   dialogSubtasks,
    };
    if (!data.title) { tTitle.focus(); return; }
    if (data.start_date && data.end_date && data.start_date > data.end_date) {
      alert('Дата начала не может быть позже даты окончания');
      return;
    }
    try {
      if (editingTaskId) {
        await Store.updateTask(editingTaskId, data);
      } else {
        const id = await Store.addTask({
          project_id: projectId,
          title: data.title,
          start_date: data.start_date,
          end_date: data.end_date,
        });
        await Store.updateTask(id, {
          status: data.status,
          subtasks: data.subtasks,
        });
      }
      els.taskDialog.close();
      await load();
    } catch (err) {
      console.error(err);
      alert('Не удалось сохранить задачу: ' + err.message);
    }
  });

  /* ============================================================
     Редактирование проекта
     ============================================================ */
  els.editBtn.addEventListener('click', () => {
    pName.value  = project.name || '';
    pDesc.value  = project.description || '';
    pStart.value = project.start_date || '';
    pEnd.value   = project.end_date || '';
    if (!els.projectDialog.open) els.projectDialog.showModal();
  });
  els.cancelProject.addEventListener('click', () => els.projectDialog.close());
  els.projectDialog.addEventListener('click', (e) => {
    if (e.target === els.projectDialog) els.projectDialog.close();
  });

  els.projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      name:        pName.value.trim(),
      description: pDesc.value.trim(),
      start_date:  pStart.value || null,
      end_date:    pEnd.value   || null,
    };
    if (!data.name) { pName.focus(); return; }
    if (data.start_date && data.end_date && data.start_date > data.end_date) {
      alert('Дата начала не может быть позже даты окончания');
      return;
    }
    try {
      await Store.updateProject(projectId, data);
      els.projectDialog.close();
      await load();
    } catch (err) {
      console.error(err);
      alert('Не удалось сохранить: ' + err.message);
    }
  });

  /* ============================================================
     Удаление проекта
     ============================================================ */
  els.delBtn.addEventListener('click', async () => {
    if (!confirm(`Удалить проект «${project.name}» со всеми задачами?`)) return;
    await Store.deleteProject(projectId);
    location.href = 'index.html';
  });

  /* ============================================================
     Старт
     ============================================================ */
  initGanttInteractions();
  load();
})();