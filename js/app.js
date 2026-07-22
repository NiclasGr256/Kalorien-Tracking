const STORAGE_KEY = 'kalorien-tracker-v1';
const DB_NAME = 'kalorien-tracker';
const DB_VERSION = 1;
const DB_STORE = 'days';
const DB_STORE_CUSTOM_FOODS = 'custom-foods';
const MEAL_ORDER = ['frühstück', 'mittag', 'abend', 'snack'];
const MEAL_LABELS = {
  frühstück: 'Frühstück',
  mittag: 'Mittag',
  abend: 'Abend',
  snack: 'Snack',
};
const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
const SUPABASE_URL = SUPABASE_CONFIG.url || 'https://eipttbdhaqyspkhqoqur.supabase.co';
const SUPABASE_ANON_KEY = SUPABASE_CONFIG.anonKey || '';

function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

async function supabaseRequest(path, options = {}) {
  if (!isSupabaseConfigured()) return null;

  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  // If calling REST upsert with on_conflict, request merge on duplicates
  if ((options.method || 'GET').toUpperCase() === 'POST' && path && path.includes('on_conflict')) {
    headers['Prefer'] = headers['Prefer'] || 'resolution=merge-duplicates';
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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
      if (!db.objectStoreNames.contains(DB_STORE_CUSTOM_FOODS)) {
        db.createObjectStore(DB_STORE_CUSTOM_FOODS, { keyPath: 'id' });
      }
    };
  });
}

function normalizeData(data) {
  return {
    days: data?.days || {},
    customFoods: Array.isArray(data?.customFoods) ? data.customFoods : [],
  };
}

function loadFromLocalStorage() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)) || { days: {} });
  } catch {
    return { days: {}, customFoods: [] };
  }
}

function saveToLocalStorage(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  } catch (error) {
    console.warn('LocalStorage save failed', error);
  }
}

async function loadData() {
  const localData = loadFromLocalStorage();

  if (isSupabaseConfigured()) {
    try {
      const [entriesRows, foodsRows] = await Promise.all([
        supabaseRequest('/entries?select=id,date,meal,name,kcal,protein,carbs,fat,weight_grams,created_at&order=created_at.asc'),
        supabaseRequest('/custom_foods?select=id,name,weight_grams,kcal,protein,carbs,fat'),
      ]);

      const days = {};
      const entryRows = Array.isArray(entriesRows) ? entriesRows : [];
      for (const row of entryRows) {
        const date = row.date;
        if (!days[date]) days[date] = [];
        days[date].push({
          id: row.id,
          name: row.name,
          kcal: Number(row.kcal) || 0,
          protein: Number(row.protein) || 0,
          carbs: Number(row.carbs) || 0,
          fat: Number(row.fat) || 0,
          weightGrams: Number(row.weight_grams) || 0,
          meal: row.meal || 'snack',
          createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
        });
      }

      const customFoods = Array.isArray(foodsRows)
        ? foodsRows.map((row) => ({
            id: row.id,
            name: row.name,
            weightGrams: Number(row.weight_grams) || 100,
            kcal: Number(row.kcal) || 0,
            protein: Number(row.protein) || 0,
            carbs: Number(row.carbs) || 0,
            fat: Number(row.fat) || 0,
          }))
        : [];

      // Merge with localStorage data so recent local-only entries remain visible
      try {
        const local = loadFromLocalStorage();
        // merge days
        for (const [dateKey, localEntries] of Object.entries(local.days || {})) {
          if (!days[dateKey]) days[dateKey] = [];
          const existingIds = new Set((days[dateKey] || []).map((e) => e.id));
          for (const le of localEntries) {
            if (!existingIds.has(le.id)) {
              days[dateKey].push(le);
            }
          }
        }

        // merge custom foods
        const existingFoodIds = new Set((customFoods || []).map((f) => f.id));
        for (const lf of (local.customFoods || [])) {
          if (!existingFoodIds.has(lf.id)) customFoods.push(lf);
        }
      } catch (e) {
        console.warn('Failed merging local data', e);
      }

      return { days, customFoods };
    } catch (error) {
      console.warn('Supabase load failed, falling back to localStorage', error);
      return localData;
    }
  }

  try {
    const db = await openDb();
    if (!db) return localData;

    const daysData = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const days = {};
        for (const record of request.result) {
          days[record.date] = record.entries;
        }
        resolve(Object.keys(days).length ? days : localData.days);
      };

      request.onerror = () => reject(request.error);
    });

    const customFoodsData = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE_CUSTOM_FOODS, 'readonly');
      const store = tx.objectStore(DB_STORE_CUSTOM_FOODS);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result.length ? request.result : localData.customFoods);
      request.onerror = () => reject(request.error);
    });

    return { days: daysData, customFoods: customFoodsData };
  } catch (error) {
    console.warn('IndexedDB load failed, falling back to localStorage', error);
    return localData;
  }
}

async function saveData(data) {
  const normalizedData = normalizeData(data);
  saveToLocalStorage(normalizedData);

  if (isSupabaseConfigured()) {
    try {
      const flatEntries = Object.entries(normalizedData.days).flatMap(([date, entries]) =>
        (entries || []).map((entry) => ({
          id: entry.id,
          date,
          meal: entry.meal,
          name: entry.name,
          kcal: Number(entry.kcal) || 0,
          protein: Number(entry.protein) || 0,
          carbs: Number(entry.carbs) || 0,
          fat: Number(entry.fat) || 0,
          weight_grams: Number(entry.weightGrams) || 0,
          created_at: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date().toISOString(),
        }))
      );

      if (flatEntries.length) {
        for (const entry of flatEntries) {
          try {
            await supabaseRequest('/entries?on_conflict=id', { method: 'POST', body: [entry] });
          } catch (err) {
            // fallback: try updating the existing row
            try {
              await supabaseRequest(`/entries?id=eq.${encodeURIComponent(entry.id)}`, { method: 'PATCH', body: entry });
            } catch (e2) {
              console.warn('Failed to upsert entry', entry.id, err, e2);
            }
          }
        }
      }

      const customFoodsPayload = (normalizedData.customFoods || []).map((food) => ({
        id: food.id,
        name: food.name,
        weight_grams: Number(food.weightGrams) || 100,
        kcal: Number(food.kcal) || 0,
        protein: Number(food.protein) || 0,
        carbs: Number(food.carbs) || 0,
        fat: Number(food.fat) || 0,
      }));

      if (customFoodsPayload.length) {
        for (const food of customFoodsPayload) {
          try {
            await supabaseRequest('/custom_foods?on_conflict=id', { method: 'POST', body: [food] });
          } catch (err) {
            try {
              await supabaseRequest(`/custom_foods?id=eq.${encodeURIComponent(food.id)}`, { method: 'PATCH', body: food });
            } catch (e2) {
              console.warn('Failed to upsert custom food', food.id, err, e2);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Supabase save failed', error);
    }
    return;
  }

  try {
    const db = await openDb();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction([DB_STORE, DB_STORE_CUSTOM_FOODS], 'readwrite');
      const daysStore = tx.objectStore(DB_STORE);
      const customFoodsStore = tx.objectStore(DB_STORE_CUSTOM_FOODS);

      daysStore.clear();
      for (const [date, entries] of Object.entries(normalizedData.days)) {
        if (entries.length > 0) {
          daysStore.put({ date, entries });
        }
      }

      customFoodsStore.clear();
      for (const food of normalizedData.customFoods) {
        customFoodsStore.put(food);
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
const viewCustomFoods = document.getElementById('viewCustomFoods');
const pageTitle = document.getElementById('pageTitle');
const customFoodForm = document.getElementById('customFoodForm');
const customFoodName = document.getElementById('customFoodName');
const customFoodWeight = document.getElementById('customFoodWeight');
const customFoodKcal = document.getElementById('customFoodKcal');
const customFoodProtein = document.getElementById('customFoodProtein');
const customFoodCarbs = document.getElementById('customFoodCarbs');
const customFoodFat = document.getElementById('customFoodFat');
const customFoodList = document.getElementById('customFoodList');
const foodName = document.getElementById('foodName');
const foodWeight = document.getElementById('foodWeight');
const foodKcal = document.getElementById('foodKcal');
const foodProtein = document.getElementById('foodProtein');
const foodCarbs = document.getElementById('foodCarbs');
const foodFat = document.getElementById('foodFat');
const foodSearchResults = document.getElementById('foodSearchResults');
const totalProteinEl = document.getElementById('totalProtein');
const totalMacrosEl = document.getElementById('totalMacros');
const cancelEntry = document.getElementById('cancelEntry');
const resetDataBtn = document.getElementById('resetDataBtn');
const appEl = document.getElementById('app');
const FOOD_SEARCH_MIN = 3;
const SEARCH_DEBOUNCE = 300;
const SEARCH_PAGE_SIZE = 20;
let searchTimeout = null;
let searchAbortController = null;
let selectedFoodBaseNutrition = null;

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
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${SEARCH_PAGE_SIZE}`;

  try {
    const response = await fetch(url, { signal: searchAbortController.signal });
    if (!response.ok) return [];

    const data = await response.json();
    const customFoodsData = await loadData();
    const customMatches = (customFoodsData.customFoods || [])
      .filter((food) => food.name && food.name.toLowerCase().includes(query.toLowerCase()))
      .map((food) => ({
        name: food.name,
        brand: 'Eigene Rezeptur',
        kcal: Number(food.kcal) || 0,
        protein: Number(food.protein) || 0,
        carbs: Number(food.carbs) || 0,
        fat: Number(food.fat) || 0,
        portionLabel: `${food.weightGrams || 100} g`,
        isCustomFood: true,
      }));

    const apiResults = (data.products || [])
      .map((product) => {
        const nutriments = product.nutriments || {};
        const kcal = nutriments['energy-kcal_serving'] ?? nutriments['energy-kcal_100g'] ?? nutriments['energy_100g'] ?? nutriments['energy-kcal'];
        const protein = nutriments['proteins_serving'] ?? nutriments['proteins_100g'] ?? nutriments['proteins'];
        const carbs = nutriments['carbohydrates_serving'] ?? nutriments['carbohydrates_100g'] ?? nutriments['carbohydrates'];
        const fat = nutriments['fat_serving'] ?? nutriments['fat_100g'] ?? nutriments['fat'];
        const portionLabel = nutriments['energy-kcal_serving'] ? product.serving_size || 'Portion' : '100 g';

        return {
          name: product.product_name || product.generic_name || product.brands || 'Unbekanntes Produkt',
          brand: product.brands || '',
          kcal: kcal != null ? Number(kcal) : null,
          protein: protein != null ? Number(protein) : null,
          carbs: carbs != null ? Number(carbs) : null,
          fat: fat != null ? Number(fat) : null,
          portionLabel,
        };
      })
      .filter((item) => item.name);

    return [...customMatches, ...apiResults].slice(0, SEARCH_PAGE_SIZE);
  } catch (error) {
    if (error.name === 'AbortError') return [];
    console.warn('Food search failed', error);
    return [];
  }
}

function renderSearchResults(results) {
  foodSearchResults.innerHTML = '';

  if (!results.length) {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'search-result-item search-result-empty';
    emptyItem.textContent = 'Keine Vorschläge gefunden';
    foodSearchResults.appendChild(emptyItem);
    foodSearchResults.classList.remove('hidden');
    foodName.setAttribute('aria-expanded', 'true');
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
      <div class="search-result-meta">${result.brand ? `${escapeHtml(result.brand)} · ` : ''}${result.kcal != null ? `${Math.round(result.kcal)} kcal` : 'Keine kcal'}${result.protein != null ? ` · ${result.protein.toFixed(1)} g Eiweiß` : ''}${result.carbs != null ? ` · ${result.carbs.toFixed(1)} g K` : ''}${result.fat != null ? ` · ${result.fat.toFixed(1)} g F` : ''}${result.portionLabel ? ` · ${escapeHtml(result.portionLabel)}` : ''}</div>
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

function parseNumericValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function applySelectedFoodNutrition() {
  if (!selectedFoodBaseNutrition) return;

  const grams = Math.max(parseNumericValue(foodWeight.value) || 100, 1);
  const factor = grams / 100;

  foodKcal.value = String(Math.max(Math.round(selectedFoodBaseNutrition.kcal * factor), 0));
  foodProtein.value = selectedFoodBaseNutrition.protein != null ? String((selectedFoodBaseNutrition.protein * factor).toFixed(1)) : '';
  foodCarbs.value = selectedFoodBaseNutrition.carbs != null ? String((selectedFoodBaseNutrition.carbs * factor).toFixed(1)) : '';
  foodFat.value = selectedFoodBaseNutrition.fat != null ? String((selectedFoodBaseNutrition.fat * factor).toFixed(1)) : '';
}

function fillFoodFromSuggestion(result) {
  foodName.value = result.name;
  selectedFoodBaseNutrition = {
    kcal: result.kcal != null ? result.kcal : 0,
    protein: result.protein != null ? result.protein : 0,
    carbs: result.carbs != null ? result.carbs : 0,
    fat: result.fat != null ? result.fat : 0,
  };
  foodWeight.value = '100';
  applySelectedFoodNutrition();
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

function handleWeightInput() {
  if (selectedFoodBaseNutrition) {
    applySelectedFoodNutrition();
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

function sumCarbs(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.carbs) || 0), 0);
}

function sumFat(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.fat) || 0), 0);
}

function getEntryProtein(entry) {
  return Number(entry.protein) || 0;
}

function getEntryCarbs(entry) {
  return Number(entry.carbs) || 0;
}

function getEntryFat(entry) {
  return Number(entry.fat) || 0;
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

async function resetAllData() {
  const confirmed = window.confirm('Alle gespeicherten Daten wirklich löschen?');
  if (!confirmed) return;

  try {
    localStorage.removeItem(STORAGE_KEY);

    const db = await openDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([DB_STORE, DB_STORE_CUSTOM_FOODS], 'readwrite');
        const daysStore = tx.objectStore(DB_STORE);
        const customFoodsStore = tx.objectStore(DB_STORE_CUSTOM_FOODS);
        daysStore.clear();
        customFoodsStore.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

  } catch (error) {
    console.warn('Data reset failed', error);
  }

  selectedDate = startOfDay(new Date());
  await setView('tracking');
  window.alert('Alle Daten wurden gelöscht.');
}

async function setView(view) {
  currentView = view;
  const isTracking = view === 'tracking';
  const isCustomFoods = view === 'customFoods';
  const isHistory = view === 'history';

  viewTracking.classList.toggle('hidden', !isTracking);
  viewHistory.classList.toggle('hidden', !isHistory);
  viewCustomFoods.classList.toggle('hidden', !isCustomFoods);
  headerTracking.classList.toggle('hidden', !isTracking);
  headerHistory.classList.toggle('hidden', !isHistory && !isCustomFoods);
  addBtn.classList.toggle('hidden', !isTracking);
  appEl.classList.toggle('app--no-fab', !isTracking);

  pageTitle.textContent = isHistory ? 'Übersicht' : isCustomFoods ? 'Gerichte' : 'Übersicht';

  navDrawer.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  location.hash = view === 'history' ? '#/history' : view === 'customFoods' ? '#/gerichte' : '#/';

  if (isTracking) await renderTracking();
  else if (isCustomFoods) await renderCustomFoods();
  else await renderHistory();

  closeNav();
}

async function renderTracking() {
  const data = await loadData();
  const key = dateKey(selectedDate);
  const entries = getDayEntries(data, key);
  const total = sumKcal(entries);
  const totalProtein = sumProtein(entries);
  const totalCarbs = sumCarbs(entries);
  const totalFat = sumFat(entries);

  dateLabel.textContent = formatDateLabel(selectedDate);
  dateSub.textContent = formatDateSub(selectedDate);
  nextDayBtn.disabled = isFuture(startOfDay(new Date(selectedDate.getTime() + 86400000)));

  totalKcalEl.textContent = total.toLocaleString('de-DE');
  totalProteinEl.textContent = totalProtein.toLocaleString('de-DE');
  totalMacrosEl.textContent = `${totalProtein.toLocaleString('de-DE')} g P · ${totalFat.toLocaleString('de-DE')} g F · ${totalCarbs.toLocaleString('de-DE')} g K`;
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

async function renderCustomFoods() {
  const data = await loadData();
  const foods = Array.isArray(data.customFoods) ? data.customFoods : [];
  customFoodList.innerHTML = '';

  if (!foods.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Noch keine eigenen Gerichte gespeichert.';
    customFoodList.appendChild(empty);
    return;
  }

  for (const food of foods) {
    const card = document.createElement('div');
    card.className = 'custom-food-card';
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(food.name)}</h3>
        <p>${food.weightGrams || 100} g · ${Number(food.kcal) || 0} kcal</p>
        <p>P ${Number(food.protein) || 0} g · F ${Number(food.fat) || 0} g · K ${Number(food.carbs) || 0} g</p>
      </div>
      <button type="button" data-delete="${food.id}">Entfernen</button>
    `;

    card.querySelector('[data-delete]').addEventListener('click', () => deleteCustomFood(food.id));
    customFoodList.appendChild(card);
  }
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
        <div class="entry-subtext">${entry.kcal} kcal · P ${getEntryProtein(entry)} g · F ${getEntryFat(entry)} g · K ${getEntryCarbs(entry)} g</div>
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
  foodWeight.value = '';
  foodKcal.value = '';
  foodProtein.value = '';
  foodCarbs.value = '';
  foodFat.value = '';
  selectedFoodBaseNutrition = null;
  clearSearchResults();
  entryModal.showModal();
  setTimeout(() => foodName.focus(), 100);
}

function openEditModal(entry) {
  editingEntryId = entry.id;
  document.getElementById('modalTitle').textContent = 'Eintrag bearbeiten';
  mealSelect.value = entry.meal;
  foodName.value = entry.name;
  foodWeight.value = String(entry.weightGrams ?? '');
  foodKcal.value = String(entry.kcal);
  foodProtein.value = String(entry.protein ?? 0);
  foodCarbs.value = String(entry.carbs ?? 0);
  foodFat.value = String(entry.fat ?? 0);
  selectedFoodBaseNutrition = null;
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
  const carbs = parseFloat(foodCarbs.value) || 0;
  const fat = parseFloat(foodFat.value) || 0;
  const weightGrams = parseInt(foodWeight.value, 10) || 0;
  if (!name || !kcal || kcal < 1 || protein < 0 || carbs < 0 || fat < 0) return;

  const data = await loadData();
  const key = dateKey(selectedDate);
  if (!data.days[key]) data.days[key] = [];

  if (editingEntryId) {
    const idx = data.days[key].findIndex((x) => x.id === editingEntryId);
    if (idx !== -1) {
      data.days[key][idx] = { ...data.days[key][idx], name, kcal, protein, carbs, fat, weightGrams, meal: mealSelect.value };
    }
  } else {
    data.days[key].push({
      id: crypto.randomUUID(),
      name,
      kcal,
      protein,
      carbs,
      fat,
      weightGrams,
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

  if (isSupabaseConfigured()) {
    try {
      await supabaseRequest(`/entries?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Supabase delete entry failed', error);
    }
  }

  await saveData(data);
  await renderTracking();
}

async function saveCustomFood(event) {
  event.preventDefault();
  const name = customFoodName.value.trim();
  const weightGrams = parseInt(customFoodWeight.value, 10) || 100;
  const kcal = parseFloat(customFoodKcal.value) || 0;
  const protein = parseFloat(customFoodProtein.value) || 0;
  const carbs = parseFloat(customFoodCarbs.value) || 0;
  const fat = parseFloat(customFoodFat.value) || 0;

  if (!name || kcal < 0 || protein < 0 || carbs < 0 || fat < 0) return;

  const data = await loadData();
  data.customFoods = data.customFoods || [];
  data.customFoods.push({
    id: crypto.randomUUID(),
    name,
    weightGrams,
    kcal,
    protein,
    carbs,
    fat,
  });

  await saveData(data);
  customFoodForm.reset();
  await renderCustomFoods();
}

async function deleteCustomFood(id) {
  const data = await loadData();
  data.customFoods = (data.customFoods || []).filter((food) => food.id !== id);

  if (isSupabaseConfigured()) {
    try {
      await supabaseRequest(`/custom_foods?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (error) {
      console.warn('Supabase delete custom food failed', error);
    }
  }

  await saveData(data);
  await renderCustomFoods();
}

function initFromHash() {
  const hash = location.hash;
  if (hash === '#/history') setView('history');
  else if (hash === '#/gerichte') setView('customFoods');
  else setView('tracking');
}

// Events
menuBtn.addEventListener('click', () => {
  if (navDrawer.classList.contains('open')) closeNav();
  else openNav();
});

navBackdrop.addEventListener('click', closeNav);
resetDataBtn.addEventListener('click', () => {
  void resetAllData();
});

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
customFoodForm.addEventListener('submit', saveCustomFood);
cancelEntry.addEventListener('click', () => entryModal.close());

foodName.addEventListener('input', handleFoodNameInput);
foodName.addEventListener('keydown', handleFoodNameKeyDown);
foodWeight.addEventListener('input', handleWeightInput);

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
