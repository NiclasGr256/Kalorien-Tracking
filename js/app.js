const STORAGE_KEY = 'kalorien-tracker-v1';
const DB_NAME = 'kalorien-tracker';
const DB_VERSION = 1;
const DB_STORE = 'days';
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

async function openDb() {
  if (!window.indexedDB) return null;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onblocked = () => {
      console.warn('IndexedDB open blocked');
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'date' });
      }
    };
  });
}

function loadFromLocalStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { days: {} };
  } catch {
    return { days: {} };
  }
}

function saveToLocalStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn('LocalStorage save failed', error);
  }
}

async function loadData() {
  const localData = loadFromLocalStorage();

  try {
    const db = await openDb();
    if (!db) return localData;

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const days = {};
        for (const record of request.result) {
          days[record.date] = record.entries;
        }
        resolve({ days: Object.keys(days).length ? days : localData.days });
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('IndexedDB load failed, falling back to localStorage', error);
    return localData;
  }
}

async function saveData(data) {
  saveToLocalStorage(data);

  try {
    const db = await openDb();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);

      store.clear();
      for (const [date, entries] of Object.entries(data.days)) {
        if (entries.length > 0) {
          store.put({ date, entries });
        }
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    console.warn('IndexedDB save failed', error);
  }
}

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
const foodProtein = document.getElementById('foodProtein');
const foodSearchResults = document.getElementById('foodSearchResults');
const totalProteinEl = document.getElementById('totalProtein');
const cancelEntry = document.getElementById('cancelEntry');
const appEl = document.getElementById('app');
const FOOD_SEARCH_MIN = 3;
const SEARCH_DEBOUNCE = 300;
let searchTimeout = null;
let searchAbortController = null;

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

function getDayEntries(data, key) {
  return data.days[key] || [];
}

async function searchFood(query) {
  if (!query || query.length < FOOD_SEARCH_MIN) return [];

  if (searchAbortController) {
    searchAbortController.abort();
  }

  searchAbortController = new AbortController();
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=8`;

  try {
    const response = await fetch(url, { signal: searchAbortController.signal });
    if (!response.ok) return [];

    const data = await response.json();
    return (data.products || [])
      .map((product) => {
        const nutriments = product.nutriments || {};
        const kcal = nutriments['energy-kcal_serving'] ?? nutriments['energy-kcal_100g'] ?? nutriments['energy_100g'] ?? nutriments['energy-kcal'];
        const protein = nutriments['proteins_serving'] ?? nutriments['proteins_100g'] ?? nutriments['proteins'];
        const portionLabel = nutriments['energy-kcal_serving'] ? product.serving_size || 'Portion' : '100 g';

        return {
          name: product.product_name || product.generic_name || product.brands || 'Unbekanntes Produkt',
          brand: product.brands || '',
          kcal: kcal != null ? Number(kcal) : null,
          protein: protein != null ? Number(protein) : null,
          portionLabel,
        };
      })
      .filter((item) => item.name);
  } catch (error) {
    if (error.name === 'AbortError') return [];
    console.warn('Food search failed', error);
    return [];
  }
}

function renderSearchResults(results) {
  foodSearchResults.innerHTML = '';

  if (!results.length) {
    foodSearchResults.classList.add('hidden');
    foodName.setAttribute('aria-expanded', 'false');
    return;
  }

  foodSearchResults.classList.remove('hidden');
  foodName.setAttribute('aria-expanded', 'true');

  for (const result of results) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="search-result-title">${escapeHtml(result.name)}</div>
      <div class="search-result-meta">${result.brand ? `${escapeHtml(result.brand)} · ` : ''}${result.kcal != null ? `${Math.round(result.kcal)} kcal` : 'Keine kcal'}${result.protein != null ? ` · ${result.protein.toFixed(1)} g Eiweiß` : ''}${result.portionLabel ? ` · ${escapeHtml(result.portionLabel)}` : ''}</div>
    `;
    item.addEventListener('click', () => {
      fillFoodFromSuggestion(result);
    });
    foodSearchResults.appendChild(item);
  }
}

function clearSearchResults() {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }

  if (searchAbortController) {
    searchAbortController.abort();
    searchAbortController = null;
  }

  foodSearchResults.innerHTML = '';
  foodSearchResults.classList.add('hidden');
  foodName.setAttribute('aria-expanded', 'false');
}

function fillFoodFromSuggestion(result) {
  foodName.value = result.name;
  if (result.kcal != null) foodKcal.value = String(Math.round(result.kcal));
  if (result.protein != null) foodProtein.value = String(result.protein.toFixed(1));
  clearSearchResults();
}

function handleFoodNameInput() {
  const query = foodName.value.trim();
  if (query.length < FOOD_SEARCH_MIN) {
    clearSearchResults();
    return;
  }

  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(async () => {
    const results = await searchFood(query);
    renderSearchResults(results);
  }, SEARCH_DEBOUNCE);
}

function handleFoodNameKeyDown(event) {
  if (event.key === 'Escape') {
    clearSearchResults();
  }
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

function sumProtein(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.protein) || 0), 0);
}

function getEntryProtein(entry) {
  return Number(entry.protein) || 0;
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

async function setView(view) {
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

  if (isTracking) await renderTracking();
  else await renderHistory();

  closeNav();
}

async function renderTracking() {
  const data = await loadData();
  const key = dateKey(selectedDate);
  const entries = getDayEntries(data, key);
  const total = sumKcal(entries);
  const totalProtein = sumProtein(entries);

  dateLabel.textContent = formatDateLabel(selectedDate);
  dateSub.textContent = formatDateSub(selectedDate);
  nextDayBtn.disabled = isFuture(startOfDay(new Date(selectedDate.getTime() + 86400000)));

  totalKcalEl.textContent = total.toLocaleString('de-DE');
  totalProteinEl.textContent = totalProtein.toLocaleString('de-DE');
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
    header.innerHTML = `<h3>${MEAL_LABELS[meal]}</h3><span class="meal-total">${sumKcal(items)} kcal · ${sumProtein(items)} g</span>`;
    group.appendChild(header);

    for (const entry of items) {
      group.appendChild(createEntryEl(entry));
    }

    mealsList.appendChild(group);
  }

  emptyState.classList.toggle('hidden', entries.length > 0);
}

async function renderHistory() {
  const data = await loadData();
  const rows = Object.entries(data.days)
    .filter(([, entries]) => entries.length > 0)
    .map(([key, entries]) => ({
      key,
      total: sumKcal(entries),
      protein: sumProtein(entries),
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
      <td class="num">${row.protein.toLocaleString('de-DE')}</td>
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
  void setView('tracking');
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
      <div class="entry-main">
        <div class="entry-name">${escapeHtml(entry.name)}</div>
        <div class="entry-subtext">${entry.kcal} kcal · ${getEntryProtein(entry)} g Eiweiß</div>
      </div>
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
  foodProtein.value = '';
  clearSearchResults();
  entryModal.showModal();
  setTimeout(() => foodName.focus(), 100);
}

function openEditModal(entry) {
  editingEntryId = entry.id;
  document.getElementById('modalTitle').textContent = 'Eintrag bearbeiten';
  mealSelect.value = entry.meal;
  foodName.value = entry.name;
  foodKcal.value = String(entry.kcal);
  foodProtein.value = String(entry.protein ?? 0);
  clearSearchResults();
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

async function saveEntry(e) {
  e.preventDefault();
  const name = foodName.value.trim();
  const kcal = parseInt(foodKcal.value, 10);
  const protein = parseFloat(foodProtein.value) || 0;
  if (!name || !kcal || kcal < 1 || protein < 0) return;

  const data = await loadData();
  const key = dateKey(selectedDate);
  if (!data.days[key]) data.days[key] = [];

  if (editingEntryId) {
    const idx = data.days[key].findIndex((x) => x.id === editingEntryId);
    if (idx !== -1) {
      data.days[key][idx] = { ...data.days[key][idx], name, kcal, protein, meal: mealSelect.value };
    }
  } else {
    data.days[key].push({
      id: crypto.randomUUID(),
      name,
      kcal,
      protein,
      meal: mealSelect.value,
      createdAt: Date.now(),
    });
  }

  await saveData(data);
  entryModal.close();
  await renderTracking();
}

async function deleteEntry(id) {
  const data = await loadData();
  const key = dateKey(selectedDate);
  data.days[key] = (data.days[key] || []).filter((e) => e.id !== id);
  await saveData(data);
  await renderTracking();
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
  btn.addEventListener('click', () => {
    void setView(/** @type {'tracking' | 'history'} */ (btn.dataset.view));
  });
});

prevDayBtn.addEventListener('click', async () => {
  selectedDate.setDate(selectedDate.getDate() - 1);
  await renderTracking();
});

nextDayBtn.addEventListener('click', async () => {
  if (nextDayBtn.disabled) return;
  selectedDate.setDate(selectedDate.getDate() + 1);
  await renderTracking();
});

addBtn.addEventListener('click', openAddModal);
entryForm.addEventListener('submit', saveEntry);
cancelEntry.addEventListener('click', () => entryModal.close());

foodName.addEventListener('input', handleFoodNameInput);
foodName.addEventListener('keydown', handleFoodNameKeyDown);

document.addEventListener('click', (event) => {
  if (!foodSearchResults.contains(event.target) && event.target !== foodName) {
    clearSearchResults();
  }
});

entryModal.addEventListener('click', (e) => {
  if (e.target === entryModal) entryModal.close();
});

entryModal.addEventListener('close', clearSearchResults);

window.addEventListener('hashchange', initFromHash);

initFromHash();
