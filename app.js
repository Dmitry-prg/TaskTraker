/* ============================================================
   app.js — общий код: тема, IndexedDB, утилиты
   Глобальный namespace: window.TT
   ============================================================ */
(() => {
  'use strict';

  /* ---------- Тема ---------- */
  const THEME_KEY = 'tt-theme';
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.dataset.theme = savedTheme;
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.documentElement.dataset.theme = 'light';
  }
  function applyMetaTheme() {
    const isDark = document.documentElement.dataset.theme === 'dark';
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isDark ? '#080b16' : '#eef1f9');
  }
  applyMetaTheme();

  function setupThemeButton(btn) {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme;
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem(THEME_KEY, next);
      applyMetaTheme();
      btn.animate(
        [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }],
        { duration: 500, easing: 'cubic-bezier(.16,1,.3,1)' }
      );
    });
  }

  /* ---------- IndexedDB ---------- */
  const DB_NAME = 'task-tracker';
  const DB_VERSION = 2;
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const oldV = e.oldVersion;

        if (!db.objectStoreNames.contains('projects')) {
          const s = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
          s.createIndex('created_at', 'created_at');
        }
        if (!db.objectStoreNames.contains('tasks')) {
          const s = db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
          s.createIndex('project_id', 'project_id');
          s.createIndex('status', 'status');
          s.createIndex('order', 'order');
        }
        if (oldV > 0 && oldV < 2) {
          const tx = e.target.transaction;
          const tasks = tx.objectStore('tasks');
          const cur = tasks.openCursor();
          let i = 0;
          cur.onsuccess = (ev) => {
            const c = ev.target.result;
            if (c) {
              const t = c.value;
              if (typeof t.order !== 'number') {
                t.order = i++;
                c.update(t);
              }
              c.continue();
            }
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function reqP(request) {
    return new Promise((res, rej) => {
      request.onsuccess = () => res(request.result);
      request.onerror = () => rej(request.error);
    });
  }
  function txDone(t) {
    return new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  const Store = {
    async allProjects() {
      const db = await openDB();
      const t = db.transaction('projects', 'readonly');
      const all = await reqP(t.objectStore('projects').getAll());
      return all.sort((a, b) => b.id - a.id);
    },

    async getProject(id) {
      const db = await openDB();
      return reqP(db.transaction('projects', 'readonly').objectStore('projects').get(id));
    },

    async addProject({ name, description = '', start_date = null, end_date = null }) {
      const db = await openDB();
      return reqP(
        db.transaction('projects', 'readwrite').objectStore('projects').add({
          name, description, start_date, end_date,
          created_at: new Date().toISOString(),
        })
      );
    },

    async updateProject(id, patch) {
      const db = await openDB();
      const read = db.transaction('projects', 'readonly');
      const cur = await reqP(read.objectStore('projects').get(id));
      if (!cur) return;
      const merged = { ...cur, ...patch };
      const t = db.transaction('projects', 'readwrite');
      t.objectStore('projects').put(merged);
      await txDone(t);
    },

    async deleteProject(id) {
      const db = await openDB();
      const t = db.transaction(['projects', 'tasks'], 'readwrite');
      t.objectStore('projects').delete(id);
      const idx = t.objectStore('tasks').index('project_id');
      const cur = idx.openCursor(IDBKeyRange.only(id));
      cur.onsuccess = (e) => {
        const c = e.target.result;
        if (c) { c.delete(); c.continue(); }
      };
      await txDone(t);
    },

    async tasksOfProject(projectId) {
      const db = await openDB();
      const t = db.transaction('tasks', 'readonly');
      const idx = t.objectStore('tasks').index('project_id');
      const all = await reqP(idx.getAll(IDBKeyRange.only(projectId)));
      return all.sort((a, b) => (a.order ?? a.id) - (b.order ?? b.id));
    },

    async addTask({ project_id, title, start_date = null, end_date = null }) {
      const db = await openDB();
      const read = db.transaction('tasks', 'readonly');
      const idx = read.objectStore('tasks').index('project_id');
      const all = await reqP(idx.getAll(IDBKeyRange.only(project_id)));
      const todos = all.filter(x => x.status === 'todo');
      const maxOrder = todos.reduce((m, x) => Math.max(m, x.order ?? 0), 0);

      const t = db.transaction('tasks', 'readwrite');
      return reqP(t.objectStore('tasks').add({
        project_id, title, start_date, end_date,
        status: 'todo',
        order: maxOrder + 1,
        subtasks: [],
        created_at: new Date().toISOString(),
      }));
    },

    async updateTask(id, patch) {
      const db = await openDB();
      const read = db.transaction('tasks', 'readonly');
      const cur = await reqP(read.objectStore('tasks').get(id));
      if (!cur) return;
      const merged = { ...cur, ...patch };
      const t = db.transaction('tasks', 'readwrite');
      t.objectStore('tasks').put(merged);
      await txDone(t);
    },

    async deleteTask(id) {
      const db = await openDB();
      return reqP(db.transaction('tasks', 'readwrite').objectStore('tasks').delete(id));
    },

    async allData() {
      const db = await openDB();
      const t = db.transaction(['projects', 'tasks'], 'readonly');
      const projects = await reqP(t.objectStore('projects').getAll());
      const tasks = await reqP(t.objectStore('tasks').getAll());
      return { projects, tasks };
    },

    async wipe() {
      const db = await openDB();
      const t = db.transaction(['projects', 'tasks'], 'readwrite');
      t.objectStore('projects').clear();
      t.objectStore('tasks').clear();
      await txDone(t);
    },

    async importAll({ projects = [], tasks = [] }) {
      const db = await openDB();
      const t = db.transaction(['projects', 'tasks'], 'readwrite');
      const ps = t.objectStore('projects');
      const ts = t.objectStore('tasks');
      ps.clear(); ts.clear();
      for (const p of projects) ps.put(p);
      for (const task of tasks) ts.put(task);
      await txDone(t);
    },
  };

  /* ---------- Утилиты ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  const DAY = 86400000;

  function toDate(s) {
    if (!s) return null;
    const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    return isNaN(d) ? null : d;
  }

  function toISODate(d) {
    if (!d) return null;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDate(s) {
    const d = toDate(s);
    if (!d) return '';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function formatDateShort(s) {
    const d = toDate(s);
    if (!d) return '';
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  function humanRange(start, end) {
    if (!start && !end) return null;
    if (start && !end) return `с ${formatDate(start)}`;
    if (!start && end) return `до ${formatDate(end)}`;
    return `${formatDate(start)} — ${formatDate(end)}`;
  }

  function daysLeftLabel(end) {
    if (!end) return null;
    const d = toDate(end);
    if (!d) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / DAY);
    if (diff > 1) return `осталось ${diff} дн.`;
    if (diff === 1) return 'остался 1 день';
    if (diff === 0) return 'сегодня дедлайн';
    if (diff === -1) return 'просрочен на 1 день';
    return `просрочен на ${Math.abs(diff)} дн.`;
  }

  const STATUS = {
    todo:        { label: 'К выполнению', order: 0 },
    in_progress: { label: 'В работе',     order: 1 },
    done:        { label: 'Готово',       order: 2 },
  };
  const STATUS_CYCLE = ['todo', 'in_progress', 'done'];
  function nextStatus(s) {
    const i = STATUS_CYCLE.indexOf(s);
    return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
  }

  window.TT = {
    Store, setupThemeButton, openDB,
    escapeHtml, toDate, toISODate, formatDate, formatDateShort,
    humanRange, daysLeftLabel,
    STATUS, STATUS_CYCLE, nextStatus, DAY,
  };

  /* ---------- Service Worker (PWA) ---------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .catch((err) => console.warn('[PWA] SW registration failed:', err));
    });
  }
})();