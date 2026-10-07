(() => {
  'use strict';
  const { Store, setupThemeButton, escapeHtml, humanRange, daysLeftLabel } = TT;

  const projectsEl = document.getElementById('projects');
  const dialog = document.getElementById('projectDialog');
  const form = document.getElementById('projectForm');
  const dialogTitle = document.getElementById('projectDialogTitle');
  const cancelBtn = document.getElementById('cancelProject');

  const fName  = document.getElementById('pName');
  const fDesc  = document.getElementById('pDesc');
  const fStart = document.getElementById('pStart');
  const fEnd   = document.getElementById('pEnd');

  let editingId = null;

  setupThemeButton(document.getElementById('themeBtn'));

  function openDialog(project) {
    editingId = project?.id ?? null;
    dialogTitle.textContent = project ? 'Редактировать проект' : 'Новый проект';

    fName.value  = project?.name        ?? '';
    fDesc.value  = project?.description ?? '';
    fStart.value = project?.start_date  ?? '';
    fEnd.value   = project?.end_date    ?? '';

    if (!dialog.open) dialog.showModal();
    setTimeout(() => fName.focus(), 60);
  }

  document.getElementById('newProjectBtn').addEventListener('click', () => openDialog(null));
  cancelBtn.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      name:        fName.value.trim(),
      description: fDesc.value.trim(),
      start_date:  fStart.value || null,
      end_date:    fEnd.value   || null,
    };
    if (!data.name) { fName.focus(); return; }
    if (data.start_date && data.end_date && data.start_date > data.end_date) {
      alert('Дата начала не может быть позже даты окончания');
      return;
    }
    try {
      if (editingId) await Store.updateProject(editingId, data);
      else           await Store.addProject(data);
      dialog.close();
      await load();
    } catch (err) {
      console.error(err);
      alert('Не удалось сохранить проект: ' + err.message);
    }
  });

  async function load() {
    const projects = await Store.allProjects();
    if (!projects.length) {
      projectsEl.innerHTML = `
        <div class="empty">
          <span class="empty-icon">✨</span>
          <p>Пока нет проектов</p>
          <p class="hint">Создайте первый — задайте название и сроки реализации</p>
        </div>`;
      return;
    }
    projectsEl.innerHTML = '';
    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      const tasks = await Store.tasksOfProject(p.id);
      projectsEl.appendChild(buildCard(p, tasks, i));
    }
  }

  function buildCard(project, tasks, index) {
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const dates = humanRange(project.start_date, project.end_date);
    const left = daysLeftLabel(project.end_date);
    const overdue = left && left.includes('просроч');
    const allDone = total > 0 && done === total;

    const card = document.createElement('article');
    card.className = 'project';
    card.style.setProperty('--i', index);

    const link = document.createElement('a');
    link.className = 'project-link';
    link.href = `project.html?id=${project.id}`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.innerHTML = `
      <div class="project-titles">
        <h2>${escapeHtml(project.name)}</h2>
        ${project.description ? `<p class="desc">${escapeHtml(project.description)}</p>` : ''}
      </div>
      ${(dates || left) ? `
        <div class="project-meta">
          ${dates ? `<span class="badge">📅 ${dates}</span>` : ''}
          ${left ? `<span class="badge ${overdue ? 'badge-danger' : (allDone ? 'badge-success' : '')}">${left}</span>` : ''}
        </div>` : ''}
      <div class="progress">
        <div class="progress-bar">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
        <span class="progress-text${allDone ? ' is-done' : ''}">
          ${done}/${total}${total ? ` · ${percent}%` : ''}
        </span>
      </div>
    `;
    card.appendChild(link);

    const actions = document.createElement('div');
    actions.className = 'project-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-icon';
    editBtn.title = 'Редактировать проект';
    editBtn.setAttribute('aria-label', 'Редактировать');
    editBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
      </svg>`;
    editBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      openDialog(project);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-icon danger';
    delBtn.title = 'Удалить проект';
    delBtn.setAttribute('aria-label', 'Удалить');
    delBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/>
      </svg>`;
    delBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!confirm(`Удалить проект «${project.name}» со всеми задачами?`)) return;
      card.classList.add('removing');
      await new Promise(r => setTimeout(r, 260));
      await Store.deleteProject(project.id);
      await load();
    });

    actions.append(editBtn, delBtn);
    card.appendChild(actions);

    return card;
  }

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const data = await Store.allData();
    const blob = new Blob(
      [JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), ...data }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `task-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) {
        throw new Error('Неверный формат файла');
      }
      if (!confirm('Импорт заменит все текущие данные. Продолжить?')) return;
      await Store.importAll(data);
      await load();
    } catch (err) {
      alert('Ошибка импорта: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('wipeBtn').addEventListener('click', async () => {
    if (!confirm('Удалить ВСЕ проекты и задачи на этом устройстве?')) return;
    await Store.wipe();
    await load();
  });

  load();
})();