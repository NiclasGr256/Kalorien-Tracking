import { getEntryFormLayoutMode } from './mobile-entry-utils.js';
import { callAi } from './ai.js';
import { MEAL_ORDER, MEAL_LABELS, normalizeMealValue, guessMealByTime } from './meal-utils.js';
import { GOAL_NUTRIENTS, normalizeGoalValues, buildGoalRows, formatGoalPercent, parseNumericInput } from './goals.js';

function upsertCustomFood(data, foodInput, existingId = null) {
  const normalized = {
    ...data,
    customFoods: Array.isArray(data?.customFoods) ? [...data.customFoods] : [],
  };

  const payload = {
    id: existingId || crypto.randomUUID(),
    name: foodInput.name?.trim() || 'Unbenannt',
    weightGrams: Number(foodInput.weightGrams) > 0 ? Number(foodInput.weightGrams) : 100,
    kcal: Number(foodInput.kcal) || 0,
    protein: Number(foodInput.protein) || 0,
    carbs: Number(foodInput.carbs) || 0,
    fat: Number(foodInput.fat) || 0,
    fiber: Number(foodInput.fiber) || 0,
  };

  if (existingId) {
    const index = normalized.customFoods.findIndex((food) => food.id === existingId);
    if (index >= 0) {
      normalized.customFoods[index] = payload;
      return normalized;
    }
  }

  normalized.customFoods.push(payload);
  return normalized;
}



const STORAGE_KEY = 'kalorien-tracker-v1';
const DB_NAME = 'kalorien-tracker';
const DB_VERSION = 1;
const DB_STORE = 'days';
const DB_STORE_CUSTOM_FOODS = 'custom-foods';
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

/** @type {'tracking' | 'history' | 'customFoods' | 'goals'} */
let currentView = 'tracking';
/** @type {Date} */
let selectedDate = startOfDay(new Date());
/** @type {string|null} */
let editingEntryId = null;
let editingCustomFoodId = null;

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
    goals: data?.goals || {},
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
      const [entriesRows, foodsRows, settingsRows] = await Promise.all([
        (async () => {
          try {
            return await supabaseRequest('/entries?select=id,date,meal,name,kcal,protein,carbs,fat,fiber,weight_grams,created_at&order=created_at.asc');
          } catch (error) {
            console.warn('Falling back to entries without fiber column', error);
            return await supabaseRequest('/entries?select=id,date,meal,name,kcal,protein,carbs,fat,weight_grams,created_at&order=created_at.asc');
          }
        })(),
        (async () => {
          try {
            return await supabaseRequest('/custom_foods?select=id,name,weight_grams,kcal,protein,carbs,fat,fiber');
          } catch (error) {
            console.warn('Falling back to custom foods without fiber column', error);
            return await supabaseRequest('/custom_foods?select=id,name,weight_grams,kcal,protein,carbs,fat');
          }
        })(),
        supabaseRequest('/settings?select=id,value'),
      ]);

      // Handle settings (API Key)
      if (Array.isArray(settingsRows)) {
        const keySetting = settingsRows.find(s => s.id === 'openai_api_key');
        if (keySetting && keySetting.value) {
          aiApiKey = keySetting.value;
          localStorage.setItem('openai_api_key', aiApiKey);
        }
      }

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
          fiber: Number(row.fiber) || 0,
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
            fiber: Number(row.fiber) || 0,
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

      return { days, customFoods, goals: localData.goals || {} };
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

    return { days: daysData, customFoods: customFoodsData, goals: localData.goals || {} };
  } catch (error) {
    console.warn('IndexedDB load failed, falling back to localStorage', error);
    return localData;
  }
}

async function saveData(data) {
  const normalizedData = normalizeData(data);
  saveToLocalStorage(normalizedData);
  console.debug('saveData: saved to localStorage', { customFoodsCount: (normalizedData.customFoods||[]).length });

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
          fiber: Number(entry.fiber) || 0,
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
        fiber: Number(food.fiber) || 0,
      }));

      if (customFoodsPayload.length) {
        for (const food of customFoodsPayload) {
          console.debug('saveData: upserting custom food', food.id, food);
          try {
            const res = await supabaseRequest('/custom_foods?on_conflict=id', { method: 'POST', body: [food] });
            console.debug('saveData: custom food POST result', food.id, res);
          } catch (err) {
            console.warn('saveData: POST failed, trying PATCH for custom food', food.id, err);
            try {
              const pres = await supabaseRequest(`/custom_foods?id=eq.${encodeURIComponent(food.id)}`, { method: 'PATCH', body: food });
              console.debug('saveData: custom food PATCH result', food.id, pres);
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
const viewGoals = document.getElementById('viewGoals');
const viewCustomFoods = document.getElementById('viewCustomFoods');
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
const mealPicker = document.getElementById('mealPicker');
const pageTitle = document.getElementById('pageTitle');
const goalsForm = document.getElementById('goalsForm');
const goalsOverview = document.getElementById('goalsOverview');
const customFoodForm = document.getElementById('customFoodForm');
const customFoodName = document.getElementById('customFoodName');
const customFoodWeight = document.getElementById('customFoodWeight');
const customFoodKcal = document.getElementById('customFoodKcal');
const customFoodProtein = document.getElementById('customFoodProtein');
const customFoodCarbs = document.getElementById('customFoodCarbs');
const customFoodFat = document.getElementById('customFoodFat');
const customFoodFiber = document.getElementById('customFoodFiber');
const customFoodList = document.getElementById('customFoodList');
const foodName = document.getElementById('foodName');
const foodWeight = document.getElementById('foodWeight');
const foodKcal = document.getElementById('foodKcal');
const foodProtein = document.getElementById('foodProtein');
const foodCarbs = document.getElementById('foodCarbs');
const foodFat = document.getElementById('foodFat');
const foodFiber = document.getElementById('foodFiber');
const foodSearchResults = document.getElementById('foodSearchResults');
const totalProteinEl = document.getElementById('totalProtein');
const totalMacrosEl = document.getElementById('totalMacros');
const cancelEntry = document.getElementById('cancelEntry');
const resetDataBtn = document.getElementById('resetDataBtn');
const aiMessages = document.getElementById('aiMessages');
const aiInput = document.getElementById('aiInput');
const aiSendBtn = document.getElementById('aiSendBtn');
const aiAttachBtn = document.getElementById('aiAttachBtn');
const aiImageInput = document.getElementById('aiImageInput');
const aiImagePreview = document.getElementById('aiImagePreview');
const aiRemoveImageBtn = document.getElementById('aiRemoveImageBtn');
const viewAiChat = document.getElementById('viewAiChat');
const appEl = document.getElementById('app');
const FOOD_SEARCH_MIN = 3;
const SEARCH_DEBOUNCE = 300;
const SEARCH_PAGE_SIZE = 20;
let searchTimeout = null;
let searchAbortController = null;
let selectedFoodBaseNutrition = null;
let aiApiKey = localStorage.getItem('openai_api_key') || '';
let pendingImageBase64 = null;
let chatHistory = [
  {
    role: 'system',
    content: `Du bist ein hilfreicher Assistent für einen Kalorien-Tracker.
Deine Aufgabe ist es, dem Nutzer zu helfen, seine Mahlzeiten und Ziele zu verwalten.
Aktuelles Datum: ${new Date().toLocaleDateString('de-DE')}.
Nutze die bereitgestellten Tools, um Einträge hinzuzufügen, Ziele zu setzen oder Einträge zu löschen.
Wenn der Nutzer etwas isst, frage ggf. nach der Menge, wenn sie nicht genannt wurde, oder schätze sie realistisch.
Du kannst auch Bilder von Essen analysieren. Schätze die Portionen und Nährwerte so genau wie möglich basierend auf dem Bild.
Antworte immer freundlich und präzise auf Deutsch.`
  }
];

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

  const normalizedQuery = query.toLowerCase();
  const customFoodsData = await loadData();
  const customMatches = (customFoodsData.customFoods || [])
    .filter((food) => food.name && food.name.toLowerCase().includes(normalizedQuery))
    .map((food) => ({
      name: food.name,
      brand: 'Eigenes Gericht',
      kcal: Number(food.kcal) || 0,
      protein: Number(food.protein) || 0,
      carbs: Number(food.carbs) || 0,
      fat: Number(food.fat) || 0,
      fiber: Number(food.fiber) || 0,
      portionLabel: `${food.weightGrams || 100} g`,
      isCustomFood: true,
    }));

  return customMatches.slice(0, SEARCH_PAGE_SIZE);
}

function applySuggestionSelection(result) {
  fillFoodFromSuggestion(result);
  foodName.focus();
}

function positionSearchResults() {
  if (!foodSearchResults || foodSearchResults.classList.contains('hidden')) return;

  const rect = foodName.getBoundingClientRect();
  const maxWidth = Math.min(360, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left, window.innerWidth - maxWidth - 12));
  const top = Math.min(rect.bottom + 8, window.innerHeight - 220 - 12);

  foodSearchResults.style.left = `${left}px`;
  foodSearchResults.style.top = `${top}px`;
  foodSearchResults.style.width = `${maxWidth}px`;
}

function renderSearchResults(results) {
  foodSearchResults.innerHTML = '';

  if (!results.length) {
    const emptyItem = document.createElement('div');
    emptyItem.className = 'search-result-item search-result-empty';
    emptyItem.textContent = 'Noch keine eigenen Gerichte gefunden. Lege zuerst ein Gericht unter „Gerichte“ an.';
    foodSearchResults.appendChild(emptyItem);
    setSearchResultsVisible(true);
    return;
  }

  setSearchResultsVisible(true);

  for (const result of results) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="search-result-title">${escapeHtml(result.name)}</div>
      <div class="search-result-meta">${result.brand ? `${escapeHtml(result.brand)} · ` : ''}${result.kcal != null ? `${Math.round(result.kcal)} kcal` : 'Keine kcal'}${result.protein != null ? ` · ${result.protein.toFixed(1)} g Eiweiß` : ''}${result.carbs != null ? ` · ${result.carbs.toFixed(1)} g K` : ''}${result.fat != null ? ` · ${result.fat.toFixed(1)} g F` : ''}${result.fiber != null ? ` · ${result.fiber.toFixed(1)} g Ballaststoffe` : ''}${result.portionLabel ? ` · ${escapeHtml(result.portionLabel)}` : ''}</div>
    `;
    item.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      applySuggestionSelection(result);
    });
    item.addEventListener('click', (event) => {
      event.preventDefault();
      applySuggestionSelection(result);
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
  foodSearchResults.style.left = '';
  foodSearchResults.style.top = '';
  foodSearchResults.style.width = '';
  foodSearchResults.classList.add('hidden');
  foodName.setAttribute('aria-expanded', 'false');
}

function setSearchResultsVisible(visible) {
  foodSearchResults.classList.toggle('hidden', !visible);
  foodName.setAttribute('aria-expanded', String(visible));
  if (visible) {
    requestAnimationFrame(positionSearchResults);
  }
}

function parseNumericValue(value) {
  if (value == null) return 0;

  const text = String(value).trim().replace(/,/, '.');
  const parsed = Number.parseFloat(text);
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
  foodFiber.value = selectedFoodBaseNutrition.fiber != null ? String((selectedFoodBaseNutrition.fiber * factor).toFixed(1)) : '';
}

function fillFoodFromSuggestion(result) {
  foodName.value = result.name;
  selectedFoodBaseNutrition = {
    kcal: result.kcal != null ? result.kcal : 0,
    protein: result.protein != null ? result.protein : 0,
    carbs: result.carbs != null ? result.carbs : 0,
    fat: result.fat != null ? result.fat : 0,
    fiber: result.fiber != null ? result.fiber : 0,
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
    if (foodName.value.trim() !== query) return;
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
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
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

function sumFiber(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.fiber) || 0), 0);
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

function getEntryFiber(entry) {
  return Number(entry.fiber) || 0;
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
  const isGoals = view === 'goals';
  const isAiChat = view === 'aiChat';

  viewTracking.classList.toggle('hidden', !isTracking);
  viewHistory.classList.toggle('hidden', !isHistory);
  viewCustomFoods.classList.toggle('hidden', !isCustomFoods);
  viewGoals.classList.toggle('hidden', !isGoals);
  viewAiChat.classList.toggle('hidden', !isAiChat);
  headerTracking.classList.toggle('hidden', !isTracking);
  headerHistory.classList.toggle('hidden', !isHistory && !isCustomFoods && !isGoals && !isAiChat);
  addBtn.classList.toggle('hidden', !isTracking);
  appEl.classList.toggle('app--no-fab', !isTracking);

  pageTitle.textContent = isHistory ? 'Übersicht' : isCustomFoods ? 'Gerichte' : isGoals ? 'Ziele' : isAiChat ? 'KI Chat' : 'Übersicht';

  navDrawer.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  location.hash = view === 'history' ? '#/history' : view === 'customFoods' ? '#/gerichte' : view === 'goals' ? '#/ziele' : view === 'aiChat' ? '#/ki-chat' : '#/';

  if (isTracking) await renderTracking();
  else if (isCustomFoods) await renderCustomFoods();
  else if (isGoals) await renderGoals();
  else if (isAiChat) await renderAiChat();
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

async function renderGoals() {
  const data = await loadData();
  const key = dateKey(selectedDate);
  const entries = getDayEntries(data, key);
  const actuals = {
    kcal: sumKcal(entries),
    protein: sumProtein(entries),
    carbs: sumCarbs(entries),
    fat: sumFat(entries),
    fiber: sumFiber(entries),
  };
  const goals = normalizeGoalValues(data.goals || {});
  const rows = buildGoalRows(actuals, goals);

  goalsOverview.innerHTML = '';
  goalsForm.querySelectorAll('.goal-input').forEach((input) => {
    const key = input.dataset.goalKey;
    const value = goals[key];
    input.value = value > 0 ? String(value) : '';
  });

  for (const row of rows) {
    const card = document.createElement('div');
    card.className = 'goal-card';
    card.innerHTML = `
      <div class="goal-card-header">
        <div>
          <h3>${escapeHtml(row.label)}</h3>
          <p>${row.actual.toLocaleString('de-DE')} ${row.unit} / ${row.goal > 0 ? `${row.goal.toLocaleString('de-DE')} ${row.unit}` : 'kein Ziel'}</p>
        </div>
        <span class="goal-pill" style="background:${row.color}; color:#111827;">${row.percent == null ? '—' : formatGoalPercent(row.percent)}</span>
      </div>
      <div class="goal-progress" aria-hidden="true">
        <div class="goal-progress-bar" style="width:${Math.min(100, Math.max(0, row.progressWidth))}%; background:${row.color};"></div>
      </div>
      <div class="goal-meta">
        <span>Ist: ${row.actual.toLocaleString('de-DE')} ${row.unit}</span>
        <span>Ziel: ${row.goal > 0 ? `${row.goal.toLocaleString('de-DE')} ${row.unit}` : 'kein Ziel'}</span>
      </div>
    `;
    goalsOverview.appendChild(card);
  }
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
        <p>P ${Number(food.protein) || 0} g · F ${Number(food.fat) || 0} g · K ${Number(food.carbs) || 0} g · B ${Number(food.fiber) || 0} g</p>
      </div>
      <div class="custom-food-actions">
        <button type="button" data-edit="${food.id}" aria-label="Bearbeiten">✎</button>
        <button type="button" data-delete="${food.id}" aria-label="Löschen">✕</button>
      </div>
    `;

    card.querySelector('[data-edit]').addEventListener('click', () => openEditCustomFoodModal(food));
    card.querySelector('[data-delete]').addEventListener('click', () => deleteCustomFood(food.id));
    customFoodList.appendChild(card);
  }
}

async function renderHistory() {
  const data = await loadData();
  const goals = normalizeGoalValues(data.goals || {});
  const rows = Object.entries(data.days)
    .filter(([, entries]) => entries.length > 0)
    .map(([key, entries]) => ({
      key,
      total: sumKcal(entries),
      protein: sumProtein(entries),
      carbs: sumCarbs(entries),
      fat: sumFat(entries),
      fiber: sumFiber(entries),
      count: entries.length,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  historyBody.innerHTML = '';

  for (const row of rows) {
    const goalRows = buildGoalRows(
      {
        kcal: row.total,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        fiber: row.fiber,
      },
      goals,
    );

    const tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.innerHTML = `
      <td>${escapeHtml(formatTableDate(row.key))}</td>
      <td class="num" style="color:${goalRows[0].color}">${row.total.toLocaleString('de-DE')}</td>
      <td class="num" style="color:${goalRows[1].color}">${row.protein.toLocaleString('de-DE')}</td>
      <td class="num" style="color:${goalRows[2].color}">${row.carbs.toLocaleString('de-DE')}</td>
      <td class="num" style="color:${goalRows[3].color}">${row.fat.toLocaleString('de-DE')}</td>
      <td class="num" style="color:${goalRows[4].color}">${row.fiber.toLocaleString('de-DE')}</td>
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
        <div class="entry-subtext">${entry.kcal} kcal · P ${getEntryProtein(entry)} g · F ${getEntryFat(entry)} g · K ${getEntryCarbs(entry)} g · B ${getEntryFiber(entry)} g</div>
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

function renderMealPicker(selectedValue = guessMealByTime()) {
  mealPicker.innerHTML = '';
  const normalizedValue = normalizeMealValue(selectedValue);
  for (const meal of MEAL_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = MEAL_LABELS[meal];
    button.dataset.meal = meal;
    button.classList.toggle('active', meal === normalizedValue);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      mealSelect.value = meal;
      renderMealPicker(meal);
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      mealSelect.value = meal;
      renderMealPicker(meal);
    });
    mealPicker.appendChild(button);
  }
  mealSelect.value = normalizedValue;
}

function applyEntryModalLayout() {
  const width = window.innerWidth || 0;
  const isTouch = window.matchMedia('(hover: none) and (pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const layout = getEntryFormLayoutMode(width, isTouch);
  entryModal.classList.toggle('mobile-sheet', layout === 'sheet');
  entryModal.classList.toggle('desktop-dialog', layout === 'dialog');
}

function openAddModal() {
  editingEntryId = null;
  document.getElementById('modalTitle').textContent = 'Eintrag hinzufügen';
  renderMealPicker(guessMealByTime());
  foodName.value = '';
  foodWeight.value = '';
  foodKcal.value = '';
  foodProtein.value = '';
  foodCarbs.value = '';
  foodFat.value = '';
  foodFiber.value = '';
  selectedFoodBaseNutrition = null;
  clearSearchResults();
  applyEntryModalLayout();
  document.body.classList.add('modal-open');
  entryModal.showModal();
  requestAnimationFrame(() => {
    foodName.focus();
    foodName.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

function openEditModal(entry) {
  editingEntryId = entry.id;
  document.getElementById('modalTitle').textContent = 'Eintrag bearbeiten';
  renderMealPicker(entry.meal);
  foodName.value = entry.name;
  foodWeight.value = String(entry.weightGrams ?? '');
  foodKcal.value = String(entry.kcal);
  foodProtein.value = String(entry.protein ?? 0);
  foodCarbs.value = String(entry.carbs ?? 0);
  foodFat.value = String(entry.fat ?? 0);
  foodFiber.value = String(entry.fiber ?? 0);
  selectedFoodBaseNutrition = null;
  clearSearchResults();
  applyEntryModalLayout();
  document.body.classList.add('modal-open');
  entryModal.showModal();
  requestAnimationFrame(() => {
    foodName.focus();
    foodName.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}

async function saveEntry(e) {
  e.preventDefault();
  const name = foodName.value.trim();
  const kcal = parseNumericValue(foodKcal.value);
  const protein = parseNumericValue(foodProtein.value);
  const carbs = parseNumericValue(foodCarbs.value);
  const fat = parseNumericValue(foodFat.value);
  const fiber = parseNumericValue(foodFiber.value);
  const weightGrams = Math.max(parseNumericValue(foodWeight.value), 0);
  const selectedMeal = normalizeMealValue(mealSelect.value);
  if (!name || !kcal || kcal < 1 || protein < 0 || carbs < 0 || fat < 0 || fiber < 0) return;

  const data = await loadData();
  const key = dateKey(selectedDate);
  if (!data.days[key]) data.days[key] = [];

  if (editingEntryId) {
    const idx = data.days[key].findIndex((x) => x.id === editingEntryId);
    if (idx !== -1) {
      data.days[key][idx] = { ...data.days[key][idx], name, kcal, protein, carbs, fat, fiber, weightGrams, meal: selectedMeal };
    }
  } else {
    data.days[key].push({
      id: crypto.randomUUID(),
      name,
      kcal,
      protein,
      carbs,
      fat,
      fiber,
      weightGrams,
      meal: selectedMeal,
      createdAt: Date.now(),
    });
  }

  await saveData(data);
  entryModal.close();
  await renderTracking();
}

async function deleteEntry(id) {
  const confirmed = window.confirm('Eintrag wirklich löschen?');
  if (!confirmed) return;

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

async function saveGoals(event) {
  event.preventDefault();
  const data = await loadData();
  const goals = {};

  goalsForm.querySelectorAll('.goal-input').forEach((input) => {
    const key = input.dataset.goalKey;
    const value = parseNumericValue(input.value);
    goals[key] = Number.isFinite(value) ? value : 0;
  });

  data.goals = normalizeGoalValues(goals);
  await saveData(data);
  await renderGoals();
}

async function saveCustomFood(event) {
  event.preventDefault();
  const name = customFoodName.value.trim();
  const weightGrams = Math.max(parseNumericValue(customFoodWeight.value), 0) || 100;
  const kcal = parseNumericValue(customFoodKcal.value);
  const protein = parseNumericValue(customFoodProtein.value);
  const carbs = parseNumericValue(customFoodCarbs.value);
  const fat = parseNumericValue(customFoodFat.value);
  const fiber = parseNumericValue(customFoodFiber.value);

  if (!name || kcal < 0 || protein < 0 || carbs < 0 || fat < 0 || fiber < 0) return;

  const data = await loadData();
  const updatedData = upsertCustomFood(
    data,
    { name, weightGrams, kcal, protein, carbs, fat, fiber },
    editingCustomFoodId,
  );

  await saveData(updatedData);

  customFoodForm.reset();
  editingCustomFoodId = null;
  const submitButton = customFoodForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'Gericht speichern';
  await renderCustomFoods();
}

async function deleteCustomFood(id) {
  const confirmed = window.confirm('Gericht wirklich löschen?');
  if (!confirmed) return;

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

function resetCustomFoodForm() {
  customFoodForm.reset();
  editingCustomFoodId = null;
  const submitButton = customFoodForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'Gericht speichern';
  customFoodName.focus();
}

function openEditCustomFoodModal(food) {
  editingCustomFoodId = food.id;
  customFoodName.value = food.name || '';
  customFoodWeight.value = String(food.weightGrams || 100);
  customFoodKcal.value = String(food.kcal || 0);
  customFoodProtein.value = String(food.protein || 0);
  customFoodCarbs.value = String(food.carbs || 0);
  customFoodFat.value = String(food.fat || 0);
  customFoodFiber.value = String(food.fiber || 0);

  const submitButton = customFoodForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'Änderungen speichern';
  customFoodName.focus();
}

async function renderAiChat() {
  // Chat view doesn't need specific data loading here as it's handled by messages
  aiInput.focus();
}

function appendMessage(role, content) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;
  msgEl.innerHTML = `<p>${escapeHtml(content).replace(/\n/g, '<br>')}</p>`;
  aiMessages.appendChild(msgEl);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

async function handleAiMessage() {
  const text = aiInput.value.trim();
  if (!text && !pendingImageBase64) return;

  if (!aiApiKey) {
    if (text.startsWith('sk-')) {
      aiApiKey = text;
      localStorage.setItem('openai_api_key', aiApiKey);
      
      // Save to Supabase for cross-device sync
      if (isSupabaseConfigured()) {
        try {
          await supabaseRequest('/settings?on_conflict=id', {
            method: 'POST',
            body: [{ id: 'openai_api_key', value: aiApiKey }]
          });
          appendMessage('system', 'API-Key sicher in der Cloud gespeichert und auf allen Geräten verfügbar!');
        } catch (e) {
          console.warn('Failed to save key to Supabase', e);
          appendMessage('system', 'API-Key lokal gespeichert (Cloud-Sync fehlgeschlagen).');
        }
      } else {
        appendMessage('system', 'API-Key lokal gespeichert!');
      }

      aiInput.value = '';
      return;
    } else {
      appendMessage('user', text || 'Bild gesendet');
      appendMessage('assistant', 'Bitte gib zuerst deinen OpenAI API-Key ein (beginnend mit sk-).');
      aiInput.value = '';
      return;
    }
  }

  const userMessageContent = [];
  if (text) userMessageContent.push({ type: 'text', text: text });
  if (pendingImageBase64) {
    userMessageContent.push({
      type: 'image_url',
      image_url: { url: pendingImageBase64 }
    });
  }

  appendMessage('user', text || 'Bild wird analysiert...');
  aiInput.value = '';
  const currentPendingImage = pendingImageBase64;
  clearPendingImage();

  chatHistory.push({ role: 'user', content: userMessageContent });

  try {
    const data = await callAi(chatHistory, aiApiKey);
    const choice = data.choices[0];
    const message = choice.message;

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const result = await executeTool(toolCall);
        chatHistory.push(message);
        chatHistory.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: toolCall.function.name,
          content: JSON.stringify(result)
        });
      }
      // Call AI again with tool results
      const secondData = await callAi(chatHistory, aiApiKey);
      const secondMessage = secondData.choices[0].message;
      appendMessage('assistant', secondMessage.content);
      chatHistory.push(secondMessage);
    } else {
      appendMessage('assistant', message.content);
      chatHistory.push(message);
    }
  } catch (error) {
    appendMessage('system', `Fehler: ${error.message}`);
  }
}

function clearPendingImage() {
  pendingImageBase64 = null;
  aiImagePreview.classList.add('hidden');
  aiImagePreview.querySelector('img').src = '';
  aiImageInput.value = '';
}

async function handleImageSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    pendingImageBase64 = event.target.result;
    aiImagePreview.querySelector('img').src = pendingImageBase64;
    aiImagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function executeTool(toolCall) {
  const name = toolCall.function.name;
  const args = JSON.parse(toolCall.function.arguments);

  if (name === 'add_entry') {
    const data = await loadData();
    const entry = {
      id: crypto.randomUUID(),
      name: args.name,
      kcal: args.kcal,
      protein: args.protein || 0,
      carbs: args.carbs || 0,
      fat: args.fat || 0,
      fiber: args.fiber || 0,
      weightGrams: args.weightGrams || 100,
      meal: args.meal || 'snack',
      createdAt: Date.now()
    };
    const key = args.date;
    if (!data.days[key]) data.days[key] = [];
    data.days[key].push(entry);
    await saveData(data);
    return { success: true, entryId: entry.id };
  }

  if (name === 'set_goals') {
    const data = await loadData();
    data.goals = { ...data.goals, ...args };
    await saveData(data);
    return { success: true };
  }

    if (name === 'delete_entry') {
    const data = await loadData();
    const key = args.date;
    if (data.days[key]) {
      data.days[key] = data.days[key].filter(e => e.id !== args.id);
      await saveData(data);
      return { success: true };
    }
    return { success: false, error: 'Tag nicht gefunden' };
  }

  if (name === 'get_data') {
    const data = await loadData();
    return data;
  }

  if (name === 'add_custom_food') {
    const data = await loadData();
    const updated = upsertCustomFood(data, args);
    await saveData(updated);
    return { success: true };
  }

  return { error: 'Tool nicht gefunden' };
}

function initFromHash() {
  const hash = location.hash;
  if (hash === '#/history') setView('history');
  else if (hash === '#/gerichte') setView('customFoods');
  else if (hash === '#/ziele') setView('goals');
  else if (hash === '#/ki-chat') setView('aiChat');
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
    void setView(/** @type {'tracking' | 'history' | 'customFoods' | 'goals' | 'aiChat'} */ (btn.dataset.view));
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
goalsForm.addEventListener('submit', saveGoals);
customFoodForm.addEventListener('submit', saveCustomFood);
customFoodForm.addEventListener('reset', () => {
  editingCustomFoodId = null;
  const submitButton = customFoodForm.querySelector('button[type="submit"]');
  if (submitButton) submitButton.textContent = 'Gericht speichern';
});
cancelEntry.addEventListener('click', () => entryModal.close());

window.addEventListener('resize', () => {
  if (entryModal.open) {
    applyEntryModalLayout();
  }
  if (!foodSearchResults.classList.contains('hidden')) {
    positionSearchResults();
  }
});

foodName.addEventListener('input', handleFoodNameInput);
foodName.addEventListener('keydown', handleFoodNameKeyDown);
foodWeight.addEventListener('input', handleWeightInput);

document.addEventListener('click', (event) => {
  if (!foodSearchResults.contains(event.target) && event.target !== foodName) {
    clearSearchResults();
  }
});

foodName.addEventListener('focus', () => {
  const query = foodName.value.trim();
  if (query.length >= FOOD_SEARCH_MIN) {
    handleFoodNameInput();
  }
});

entryModal.addEventListener('click', (e) => {
  if (e.target === entryModal) entryModal.close();
});

entryModal.addEventListener('close', () => {
  clearSearchResults();
  document.body.classList.remove('modal-open');
});

aiSendBtn.addEventListener('click', handleAiMessage);
aiAttachBtn.addEventListener('click', () => aiImageInput.click());
aiImageInput.addEventListener('change', handleImageSelect);
aiRemoveImageBtn.addEventListener('click', clearPendingImage);
aiInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleAiMessage();
});

window.addEventListener('hashchange', initFromHash);

renderMealPicker(guessMealByTime());
applyEntryModalLayout();
initFromHash();
