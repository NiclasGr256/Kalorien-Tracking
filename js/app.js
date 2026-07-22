const STORAGE_KEY = 'kalorien-tracker-v1';
const MEAL_ORDER = ['frühstück', 'mittag', 'abend', 'snack'];
const MEAL_LABELS = {
  frühstück: 'Frühstück',
  mittag: 'Mittag',
  abend: 'Abend',
  snack: 'Snack',
};

/** @type {'tracking' | 'history'} */
let currentView = 'tracking';
/** @type {Date} */
let selectedDate = startOfDay(new Date());
/** @type {string|null} */
let editingEntryId = null;

// DOM
const menuBtn = document.getElementById('menuBtn');
const navBackdrop = document.getElementById('navBackdrop');
const navDrawer = document.getElementById('navDrawer');
const headerTracking = document.getElementById('headerTracking');
const headerHistory = document.getElementById('headerHistory');
const viewTracking = document.getElementById('viewTracking');
const viewHistory = document.getElementById('viewHistory');
const dateLabel = document.getElementById('dateLabel');
const dateSub = document.getElementById('dateSub');
const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');
const totalKcalEl = document.getElementById('totalKcal');
const entryCountEl = document.getElementById('entryCount');
const mealsList = document.getElementById('mealsList');
const emptyState = document.getElementById('emptyState');
const historyBody = document.getElementById('historyBody');
const historyEmpty = document.getElementById('historyEmpty');
const addBtn = document.getElementById('addBtn');
const entryModal = document.getElementById('entryModal');
const entryForm = document.getElementById('entryForm');
const mealSelect = document.getElementById('mealSelect');
const foodName = document.getElementById('foodName');
const foodKcal = document.getElementById('foodKcal');
const cancelEntry = document.getElementById('cancelEntry');
const appEl = document.getElementById('app');

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return startOfDay(new Date(y, m - 1, d));
}

function isToday(d) {
  return dateKey(d) === dateKey(new Date());
}

function isFuture(d) {
  return d > startOfDay(new Date());
}

function loadData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { days: {} };
  } catch {
    return { days: {} };
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getDayEntries(data, key) {
  return data.days[key] || [];
}

function formatDateLabel(d) {
  if (isToday(d)) return 'Heute';
  const yesterday = startOfDay(new Date());
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(d) === dateKey(yesterday)) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long' });
}

function formatDateSub(d) {
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTableDate(key) {
  const d = parseDateKey(key);
  if (isToday(d)) return 'Heute';
  const yesterday = startOfDay(new Date());
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey(d) === dateKey(yesterday)) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sumKcal(entries) {
  return entries.reduce((sum, e) => sum + e.kcal, 0);
}

function formatEntryCount(count) {
  return count === 1 ? '1 Eintrag' : `${count} Einträge`;
}

function openNav() {
  navDrawer.classList.add('open');
  navBackdrop.classList.remove('hidden');
  menuBtn.setAttribute('aria-expanded', 'true');
}

function closeNav() {
  navDrawer.classList.remove('open');
  navBackdrop.classList.add('hidden');
  menuBtn.setAttribute('aria-expanded', 'false');
}

function setView(view) {
  currentView = view;
  const isTracking = view === 'tracking';

  viewTracking.classList.toggle('hidden', !isTracking);
  viewHistory.classList.toggle('hidden', isTracking);
  headerTracking.classList.toggle('hidden', !isTracking);
  headerHistory.classList.toggle('hidden', isTracking);
  addBtn.classList.toggle('hidden', !isTracking);
  appEl.classList.toggle('app--no-fab', !isTracking);

  navDrawer.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  location.hash = view === 'history' ? '#/history' : '#/';

  if (isTracking) renderTracking();
  else renderHistory();

  closeNav();
}

function renderTracking() {
  const data = loadData();
  const key = dateKey(selectedDate);
  const entries = getDayEntries(data, key);
  const total = sumKcal(entries);

  dateLabel.textContent = formatDateLabel(selectedDate);
  dateSub.textContent = formatDateSub(selectedDate);
  nextDayBtn.disabled = isFuture(startOfDay(new Date(selectedDate.getTime() + 86400000)));

  totalKcalEl.textContent = total.toLocaleString('de-DE');
  entryCountEl.textContent = formatEntryCount(entries.length);

  mealsList.innerHTML = '';
  const grouped = groupByMeal(entries);

  for (const meal of MEAL_ORDER) {
    const items = grouped[meal];
    if (!items?.length) continue;

    const group = document.createElement('div');
    group.className = 'meal-group';

    const header = document.createElement('div');
    header.className = 'meal-header';
    header.innerHTML = `<h3>${MEAL_LABELS[meal]}</h3><span class="meal-total">${sumKcal(items)} kcal</span>`;
    group.appendChild(header);

    for (const entry of items) {
      group.appendChild(createEntryEl(entry));
    }

    mealsList.appendChild(group);
  }

  emptyState.classList.toggle('hidden', entries.length > 0);
}

function renderHistory() {
  const data = loadData();
  const rows = Object.entries(data.days)
    .filter(([, entries]) => entries.length > 0)
    .map(([key, entries]) => ({
      key,
      total: sumKcal(entries),
      count: entries.length,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  historyBody.innerHTML = '';

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td>${escapeHtml(formatTableDate(row.key))}</td>
      <td class="num">${row.total.toLocaleString('de-DE')}</td>
      <td class="num">${row.count}</td>
    `;
    tr.addEventListener('click', () => goToDay(row.key));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        goToDay(row.key);
      }
    });
    historyBody.appendChild(tr);
  }

  historyEmpty.classList.toggle('hidden', rows.length > 0);
}

function goToDay(key) {
  selectedDate = parseDateKey(key);
  setView('tracking');
}

function groupByMeal(entries) {
  /** @type {Record<string, typeof entries>} */
  const map = {};
  for (const e of entries) {
    (map[e.meal] ||= []).push(e);
  }
  return map;
}

function createEntryEl(entry) {
  const el = document.createElement('div');
  el.className = 'entry';
  el.innerHTML = `
    <div class="entry-info">
      <div class="entry-name">${escapeHtml(entry.name)}</div>
    </div>
    <span class="entry-kcal">${entry.kcal}</span>
    <div class="entry-actions">
      <button type="button" data-edit="${entry.id}" aria-label="Bearbeiten">✎</button>
      <button type="button" class="delete-btn" data-delete="${entry.id}" aria-label="Löschen">✕</button>
    </div>
  `;

  el.querySelector('[data-edit]').addEventListener('click', () => openEditModal(entry));
  el.querySelector('[data-delete]').addEventListener('click', () => deleteEntry(entry.id));

  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openAddModal() {
  editingEntryId = null;
  document.getElementById('modalTitle').textContent = 'Eintrag hinzufügen';
  mealSelect.value = guessMealByTime();
  foodName.value = '';
  foodKcal.value = '';
  entryModal.showModal();
  setTimeout(() => foodName.focus(), 100);
}

function openEditModal(entry) {
  editingEntryId = entry.id;
  document.getElementById('modalTitle').textContent = 'Eintrag bearbeiten';
  mealSelect.value = entry.meal;
  foodName.value = entry.name;
  foodKcal.value = String(entry.kcal);
  entryModal.showModal();
  setTimeout(() => foodName.focus(), 100);
}

function guessMealByTime() {
  const h = new Date().getHours();
  if (h < 10) return 'frühstück';
  if (h < 14) return 'mittag';
  if (h < 18) return 'abend';
  return 'snack';
}

function saveEntry(e) {
  e.preventDefault();
  const name = foodName.value.trim();
  const kcal = parseInt(foodKcal.value, 10);
  if (!name || !kcal || kcal < 1) return;

  const data = loadData();
  const key = dateKey(selectedDate);
  if (!data.days[key]) data.days[key] = [];

  if (editingEntryId) {
    const idx = data.days[key].findIndex((x) => x.id === editingEntryId);
    if (idx !== -1) {
      data.days[key][idx] = { ...data.days[key][idx], name, kcal, meal: mealSelect.value };
    }
  } else {
    data.days[key].push({
      id: crypto.randomUUID(),
      name,
      kcal,
      meal: mealSelect.value,
      createdAt: Date.now(),
    });
  }

  saveData(data);
  entryModal.close();
  renderTracking();
}

function deleteEntry(id) {
  const data = loadData();
  const key = dateKey(selectedDate);
  data.days[key] = (data.days[key] || []).filter((e) => e.id !== id);
  saveData(data);
  renderTracking();
}

function initFromHash() {
  setView(location.hash === '#/history' ? 'history' : 'tracking');
}

// Events
menuBtn.addEventListener('click', () => {
  if (navDrawer.classList.contains('open')) closeNav();
  else openNav();
});

navBackdrop.addEventListener('click', closeNav);

navDrawer.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => setView(/** @type {'tracking' | 'history'} */ (btn.dataset.view)));
});

prevDayBtn.addEventListener('click', () => {
  selectedDate.setDate(selectedDate.getDate() - 1);
  renderTracking();
});

nextDayBtn.addEventListener('click', () => {
  if (nextDayBtn.disabled) return;
  selectedDate.setDate(selectedDate.getDate() + 1);
  renderTracking();
});

addBtn.addEventListener('click', openAddModal);
entryForm.addEventListener('submit', saveEntry);
cancelEntry.addEventListener('click', () => entryModal.close());

entryModal.addEventListener('click', (e) => {
  if (e.target === entryModal) entryModal.close();
});

window.addEventListener('hashchange', initFromHash);

initFromHash();
