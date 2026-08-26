import { getEntryFormLayoutMode } from './mobile-entry-utils.js';
import { callAi } from './ai.js';
import { MEAL_ORDER, MEAL_LABELS, normalizeMealValue, guessMealByTime } from './meal-utils.js';
import { GOAL_NUTRIENTS, normalizeGoalValues, buildGoalRows, formatGoalPercent, parseNumericInput } from './goals.js';
import { createEntryTemplate } from './ui-components.js';

function upsertCustomFood(data, foodInput, existingId = null) {

  const normalized = {
    ...data,
    customFoods: Array.isArray(data?.customFoods) ? [...data.customFoods] : [],
  };

  const payload = {
    id: existingId || crypto.randomUUID(),
    name: foodInput.name?.trim() || 'Unbenannt',
    weightGrams: Number(foodInput.weightGrams) > 0 ? Number(foodInput.weightGrams) : 100,
    unit: foodInput.unit || 'g',
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
const DB_STORE_WEIGHT = 'weight';
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
let selectedWeightDate = startOfDay(new Date());

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
      if (!db.objectStoreNames.contains(DB_STORE_WEIGHT)) {
        db.createObjectStore(DB_STORE_WEIGHT, { keyPath: 'date' });
      }
    };
  });
}

function normalizeData(data) {
  return {
    days: data?.days || {},
    customFoods: Array.isArray(data?.customFoods) ? data.customFoods : [],
    goals: data?.goals || {},
    colors: data?.colors || {},
    thresholds: data?.thresholds || {},
    weight: data?.weight || {},
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
            const [entriesRows, foodsRows, settingsRows, weightRows] = await Promise.all([
        (async () => {
          try {
            return await supabaseRequest('/entries?select=id,date,meal,name,kcal,protein,carbs,fat,fiber,weight_grams,unit,created_at&order=created_at.asc');
          } catch (error) {
            console.warn('Falling back to entries without unit column', error);
            return await supabaseRequest('/entries?select=id,date,meal,name,kcal,protein,carbs,fat,fiber,weight_grams,created_at&order=created_at.asc');
          }
        })(),
        (async () => {
          try {
            return await supabaseRequest('/custom_foods?select=id,name,weight_grams,unit,kcal,protein,carbs,fat,fiber');
          } catch (error) {
            console.warn('Falling back to custom foods without unit column', error);
            return await supabaseRequest('/custom_foods?select=id,name,weight_grams,kcal,protein,carbs,fat,fiber');
          }
        })(),
        supabaseRequest('/settings?select=id,value'),
        supabaseRequest('/weight?select=date,value,period'),
      ]);

            // Handle settings (API Key, Goals, Colors, Thresholds)
      const goals = localData.goals || {};
      const colors = localData.colors || {};
      const thresholds = localData.thresholds || {};
      const weight = {};

      if (Array.isArray(weightRows)) {
        for (const row of weightRows) {
          weight[row.date] = { value: Number(row.value), period: Boolean(row.period) };
        }
      }
      
      if (Array.isArray(settingsRows)) {
        const keySetting = settingsRows.find(s => s.id === 'openai_api_key');
        if (keySetting && keySetting.value) {
          aiApiKey = keySetting.value;
          localStorage.setItem('openai_api_key', aiApiKey);
          console.debug('API Key loaded from Supabase');
        } else {
          // If not in Supabase, check local storage
          aiApiKey = localStorage.getItem('openai_api_key') || '';
        }

        const goalsSetting = settingsRows.find(s => s.id === 'goals');

        if (goalsSetting && goalsSetting.value) {
          try {
            const remoteGoals = JSON.parse(goalsSetting.value);
            Object.assign(goals, remoteGoals);
          } catch (e) {
            console.warn('Failed to parse remote goals', e);
          }
        }

        const colorsSetting = settingsRows.find(s => s.id === 'colors');
        if (colorsSetting && colorsSetting.value) {
          try {
            const remoteColors = JSON.parse(colorsSetting.value);
            Object.assign(colors, remoteColors);
          } catch (e) {
            console.warn('Failed to parse remote colors', e);
          }
        }

        const thresholdsSetting = settingsRows.find(s => s.id === 'thresholds');
        if (thresholdsSetting && thresholdsSetting.value) {
          try {
            const remoteThresholds = JSON.parse(thresholdsSetting.value);
            Object.assign(thresholds, remoteThresholds);
          } catch (e) {
            console.warn('Failed to parse remote thresholds', e);
          }
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
          unit: row.unit || 'g',
          meal: row.meal || 'snack',
          createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
        });
      }

      const customFoods = Array.isArray(foodsRows)
        ? foodsRows.map((row) => ({
            id: row.id,
            name: row.name,
            weightGrams: Number(row.weight_grams) || 100,
            unit: row.unit || 'g',
            kcal: Number(row.kcal) || 0,
            protein: Number(row.protein) || 0,
            carbs: Number(row.carbs) || 0,
            fat: Number(row.fat) || 0,
            fiber: Number(row.fiber) || 0,
          }))
        : [];


                        // When Supabase is active, it's the source of truth.
      // We overwrite local data with remote data to avoid "zombie" entries.
      saveToLocalStorage({ days, customFoods, goals, colors, thresholds, weight });

      return { days, customFoods, goals, colors, thresholds, weight };
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

    const weightData = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE_WEIGHT, 'readonly');
      const store = tx.objectStore(DB_STORE_WEIGHT);
      const request = store.getAll();
      request.onsuccess = () => {
        const weight = {};
        for (const record of request.result) weight[record.date] = { value: record.value, period: record.period };
        resolve(Object.keys(weight).length ? weight : localData.weight);
      };
      request.onerror = () => reject(request.error);
    });

        return { days: daysData, customFoods: customFoodsData, goals: localData.goals || {}, colors: localData.colors || {}, thresholds: localData.thresholds || {}, weight: weightData };
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
          unit: entry.unit || 'g',
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
        unit: food.unit || 'g',
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

      // Save Goals to Supabase
      if (normalizedData.goals && Object.keys(normalizedData.goals).length > 0) {
        try {
          await supabaseRequest('/settings?on_conflict=id', {
            method: 'POST',
            body: [{ id: 'goals', value: JSON.stringify(normalizedData.goals) }]
          });
        } catch (err) {
          console.warn('Failed to save goals to Supabase', err);
        }
      }

            // Save Colors to Supabase
      if (normalizedData.colors && Object.keys(normalizedData.colors).length > 0) {
        try {
          await supabaseRequest('/settings?on_conflict=id', {
            method: 'POST',
            body: [{ id: 'colors', value: JSON.stringify(normalizedData.colors) }]
          });
        } catch (err) {
          console.warn('Failed to save colors to Supabase', err);
        }
      }

            // Save Thresholds to Supabase
      if (normalizedData.thresholds && Object.keys(normalizedData.thresholds).length > 0) {
        try {
          await supabaseRequest('/settings?on_conflict=id', {
            method: 'POST',
            body: [{ id: 'thresholds', value: JSON.stringify(normalizedData.thresholds) }]
          });
        } catch (err) {
          console.warn('Failed to save thresholds to Supabase', err);
        }
      }

      // Save Weight to Supabase
      if (normalizedData.weight && Object.keys(normalizedData.weight).length > 0) {
        const weightPayload = Object.entries(normalizedData.weight).map(([date, data]) => ({
          date,
          value: data.value,
          period: data.period
        }));
        try {
          for (const item of weightPayload) {
            await supabaseRequest('/weight?on_conflict=date', { method: 'POST', body: [item] });
          }
        } catch (err) {
          console.warn('Failed to save weight to Supabase', err);
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
      const tx = db.transaction([DB_STORE, DB_STORE_CUSTOM_FOODS, DB_STORE_WEIGHT], 'readwrite');
      const daysStore = tx.objectStore(DB_STORE);
      const customFoodsStore = tx.objectStore(DB_STORE_CUSTOM_FOODS);
      const weightStore = tx.objectStore(DB_STORE_WEIGHT);

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

      weightStore.clear();
      for (const [date, data] of Object.entries(normalizedData.weight)) {
        weightStore.put({ date, value: data.value, period: data.period });
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
const customFoodUnit = document.getElementById('customFoodUnit');
const customFoodKcal = document.getElementById('customFoodKcal');

const customFoodProtein = document.getElementById('customFoodProtein');
const customFoodCarbs = document.getElementById('customFoodCarbs');
const customFoodFat = document.getElementById('customFoodFat');
const customFoodFiber = document.getElementById('customFoodFiber');
const customFoodList = document.getElementById('customFoodList');
const foodName = document.getElementById('foodName');
const foodWeight = document.getElementById('foodWeight');
const foodUnitLabel = document.getElementById('foodUnitLabel');
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
const viewStatistics = document.getElementById('viewStatistics');
const viewWeight = document.getElementById('viewWeight');
const viewWeightStats = document.getElementById('viewWeightStats');
const weightForm = document.getElementById('weightForm');
const weightInput = document.getElementById('weightInput');
const periodInput = document.getElementById('periodInput');
const weightTableBody = document.getElementById('weightTableBody');
const weightDateLabel = document.getElementById('weightDateLabel');
const weightDateSub = document.getElementById('weightDateSub');
const prevWeightDay = document.getElementById('prevWeightDay');
const nextWeightDay = document.getElementById('nextWeightDay');
const weightStatsSummary = document.getElementById('weightStatsSummary');
const statsStartDate = document.getElementById('statsStartDate');
const statsEndDate = document.getElementById('statsEndDate');
const appEl = document.getElementById('app');
const confirmModal = document.getElementById('confirmModal');
const confirmOk = document.getElementById('confirmOk');
const confirmCancel = document.getElementById('confirmCancel');
const FOOD_SEARCH_MIN = 3;
const SEARCH_DEBOUNCE = 300;
const SEARCH_PAGE_SIZE = 20;
let searchTimeout = null;
let searchAbortController = null;
let selectedFoodBaseNutrition = null;
let aiApiKey = localStorage.getItem('openai_api_key') || '';
let pendingImageBase64 = null;
let combinedChart = null;
let weightChart = null;
let chatHistory = [];

function getSystemPrompt() {
  return {
    role: 'system',
    content: `Du bist ein intelligenter Ernährungs-Coach für einen Kalorien-Tracker.
Aktuelles Datum: ${new Date().toLocaleDateString('de-DE')} (${new Date().toLocaleDateString('de-DE', { weekday: 'long' })}).
DEINE REGELN:
1. KONSISTENZ PRÜFEN: Bevor du einen neuen Eintrag anlegst (add_entry), nutze IMMER zuerst 'get_data', um zu sehen, ob der Nutzer dieses Lebensmittel schon einmal gegessen hat oder ob es in den 'customFoods' existiert. Nutze bevorzugt diese bekannten Nährwerte.
2. NÄHRWERTE VOLLSTÄNDIG: Ermittle für JEDEN Eintrag IMMER alle folgenden Werte: Kalorien (kcal), Protein (g), Fett (g), Kohlenhydrate (g) und Ballaststoffe (g). Schätze sie realistisch ein, wenn keine genauen Angaben vorliegen.
3. PROAKTIV SEIN: Wenn du Daten abrufst, gib kurzes Feedback (z.B. "Das ist dein zweiter Apfel heute" oder "Damit bist du fast bei deinem Proteinziel").
4. PRÄZISION: Frage bei ungenauen Angaben ("Ein Brot") nach der Menge oder schätze sie realistisch ein.
5. BILDANALYSE: Analysiere Bilder von Essen, schätze Portionen und Nährwerte.
6. BEARBEITEN: Du kannst Einträge mit 'update_entry' ändern, wenn der Nutzer z.B. sagt "Ich habe doch 2 Äpfel gegessen" oder "Ändere das Frühstück von heute auf 500 kcal".
Nutze die bereitgestellten Tools für alle Aktionen. Antworte immer freundlich auf Deutsch.`
  };
}

function initChatHistory() {
  chatHistory = [getSystemPrompt()];
}

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
      weightGrams: food.weightGrams || 100,
      unit: food.unit || 'g',
      portionLabel: `${food.weightGrams || 100} ${food.unit || 'g'}`,
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

  const amount = Math.max(parseNumericValue(foodWeight.value) || selectedFoodBaseNutrition.baseAmount || 100, 0.1);
  const factor = amount / (selectedFoodBaseNutrition.baseAmount || 100);

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
    baseAmount: result.weightGrams || 100,
    unit: result.unit || 'g'
  };
  foodWeight.value = String(selectedFoodBaseNutrition.baseAmount);
  foodUnitLabel.textContent = selectedFoodBaseNutrition.unit;
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

function showConfirm(title, message) {
  return new Promise((resolve) => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    
    const onOk = () => {
      confirmModal.close();
      cleanup();
      resolve(true);
    };
    
    const onCancel = () => {
      confirmModal.close();
      cleanup();
      resolve(false);
    };
    
    const cleanup = () => {
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
    };
    
    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmModal.showModal();
  });
}

async function resetAllData() {
  const confirmed = await showConfirm('Daten löschen', 'Alle gespeicherten Daten wirklich löschen?');
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
  const isStatistics = view === 'statistics';
  const isWeight = view === 'weight';
  const isWeightStats = view === 'weightStats';

  viewTracking.classList.toggle('hidden', !isTracking);
  viewHistory.classList.toggle('hidden', !isHistory);
  viewCustomFoods.classList.toggle('hidden', !isCustomFoods);
  viewGoals.classList.toggle('hidden', !isGoals);
  viewAiChat.classList.toggle('hidden', !isAiChat);
  viewStatistics.classList.toggle('hidden', !isStatistics);
  viewWeight.classList.toggle('hidden', !isWeight);
  viewWeightStats.classList.toggle('hidden', !isWeightStats);
  
  headerTracking.classList.toggle('hidden', !isTracking);
  headerHistory.classList.toggle('hidden', !isHistory && !isCustomFoods && !isGoals && !isAiChat && !isStatistics && !isWeight && !isWeightStats);
  addBtn.classList.toggle('hidden', !isTracking);
  appEl.classList.toggle('app--no-fab', !isTracking);

  pageTitle.textContent = isHistory ? 'Übersicht' : isCustomFoods ? 'Gerichte' : isGoals ? 'Ziele' : isAiChat ? 'KI Chat' : isStatistics ? 'Statistiken' : isWeight ? 'Gewicht' : isWeightStats ? 'Gewichtsverlauf' : 'Übersicht';

  navDrawer.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  location.hash = view === 'history' ? '#/history' : view === 'customFoods' ? '#/gerichte' : view === 'goals' ? '#/ziele' : view === 'aiChat' ? '#/ki-chat' : view === 'statistics' ? '#/statistiken' : view === 'weight' ? '#/gewicht' : view === 'weightStats' ? '#/gewichtsverlauf' : '#/';

  if (isTracking) await renderTracking();
  else if (isCustomFoods) await renderCustomFoods();
  else if (isGoals) await renderGoals();
  else if (isAiChat) await renderAiChat();
  else if (isStatistics) await renderStatistics();
  else if (isWeight) await renderWeight();
  else if (isWeightStats) await renderWeightStats();
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
  const totalFiber = sumFiber(entries);

  dateLabel.textContent = formatDateLabel(selectedDate);
  dateSub.textContent = formatDateSub(selectedDate);
  nextDayBtn.disabled = isFuture(startOfDay(new Date(selectedDate.getTime() + 86400000)));

  totalKcalEl.textContent = total.toLocaleString('de-DE');
  totalProteinEl.textContent = totalProtein.toLocaleString('de-DE');
  totalMacrosEl.textContent = `${totalProtein.toLocaleString('de-DE')} g P · ${totalFat.toLocaleString('de-DE')} g F · ${totalCarbs.toLocaleString('de-DE')} g K · ${totalFiber.toLocaleString('de-DE')} g B`;
  entryCountEl.textContent = formatEntryCount(entries.length);

  // Use original pink color for kcal total
  totalKcalEl.style.color = 'var(--accent)';

  mealsList.innerHTML = '';
  const grouped = groupByMeal(entries);

  for (const meal of MEAL_ORDER) {
    const items = grouped[meal];
    if (!items?.length) continue;

    const group = document.createElement('div');
    group.className = 'meal-group';

    const header = document.createElement('div');
    header.className = 'meal-header';
    header.innerHTML = `<h3>${MEAL_LABELS[meal]}</h3><span class="meal-total">${sumKcal(items).toLocaleString('de-DE')} kcal · ${sumProtein(items).toLocaleString('de-DE')} g P</span>`;
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
  const colors = data.colors || {};
  const thresholds = data.thresholds || {};
  const rows = buildGoalRows(actuals, goals, colors, thresholds);

  goalsOverview.innerHTML = '';
  goalsForm.querySelectorAll('.goal-input').forEach((input) => {
    const key = input.dataset.goalKey;
    const value = goals[key];
    input.value = value > 0 ? String(value) : '';
  });

  // Fill color inputs
  goalsForm.querySelectorAll('.color-input').forEach((input) => {
    const key = input.dataset.colorKey;
    if (colors[key]) {
      input.value = colors[key];
    }
  });

  // Fill threshold inputs
  goalsForm.querySelectorAll('.threshold-input').forEach((input) => {
    const key = input.dataset.thresholdKey;
    if (thresholds[key]) {
      input.value = Math.round(thresholds[key] * 100);
    }
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
  const foods = (Array.isArray(data.customFoods) ? data.customFoods : [])
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de', { sensitivity: 'base' }));
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
    const unit = food.unit || 'g';
    card.innerHTML = `
      <div>
        <h3>${escapeHtml(food.name)}</h3>
        <p>${food.weightGrams || 100} ${unit} · ${Number(food.kcal) || 0} kcal</p>
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
  el.innerHTML = createEntryTemplate(entry);

  el.querySelector('[data-copy]').addEventListener('click', () => openCopyModal(entry));
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
  foodUnitLabel.textContent = 'g';
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
  foodUnitLabel.textContent = entry.unit || 'g';
  foodKcal.value = String(entry.kcal);
  foodProtein.value = String(entry.protein ?? 0);
  foodCarbs.value = String(entry.carbs ?? 0);
  foodFat.value = String(entry.fat ?? 0);
  foodFiber.value = String(entry.fiber ?? 0);

  // Set base nutrition for automatic adjustment when weight changes
  const originalWeight = Math.max(parseNumericValue(entry.weightGrams), 0.1);
  selectedFoodBaseNutrition = {
    kcal: (parseNumericValue(entry.kcal) / originalWeight) * 100,
    protein: (parseNumericValue(entry.protein) / originalWeight) * 100,
    carbs: (parseNumericValue(entry.carbs) / originalWeight) * 100,
    fat: (parseNumericValue(entry.fat) / originalWeight) * 100,
    fiber: (parseNumericValue(entry.fiber) / originalWeight) * 100,
    baseAmount: 100,
    unit: entry.unit || 'g'
  };

  clearSearchResults();
  applyEntryModalLayout();
  document.body.classList.add('modal-open');
  entryModal.showModal();
  requestAnimationFrame(() => {
    foodName.focus();
    foodName.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });
}


function openCopyModal(entry) {
  editingEntryId = null;
  document.getElementById('modalTitle').textContent = 'Eintrag nach heute kopieren';
  
  // Set date to today
  selectedDate = startOfDay(new Date());
  
  renderMealPicker(entry.meal);
  foodName.value = entry.name;
  foodWeight.value = String(entry.weightGrams ?? '');
  foodUnitLabel.textContent = entry.unit || 'g';
  foodKcal.value = String(entry.kcal);
  foodProtein.value = String(entry.protein ?? 0);
  foodCarbs.value = String(entry.carbs ?? 0);
  foodFat.value = String(entry.fat ?? 0);
  foodFiber.value = String(entry.fiber ?? 0);

  // Set base nutrition for automatic adjustment when weight changes
  const originalWeight = Math.max(parseNumericValue(entry.weightGrams), 0.1);
  selectedFoodBaseNutrition = {
    kcal: (parseNumericValue(entry.kcal) / originalWeight) * 100,
    protein: (parseNumericValue(entry.protein) / originalWeight) * 100,
    carbs: (parseNumericValue(entry.carbs) / originalWeight) * 100,
    fat: (parseNumericValue(entry.fat) / originalWeight) * 100,
    fiber: (parseNumericValue(entry.fiber) / originalWeight) * 100,
    baseAmount: 100,
    unit: entry.unit || 'g'
  };

  clearSearchResults();
  applyEntryModalLayout();
  document.body.classList.add('modal-open');
  entryModal.showModal();
  
  // Update the background tracking view to today
  renderTracking();
  
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
  const unit = foodUnitLabel.textContent;
  const selectedMeal = normalizeMealValue(mealSelect.value);
  if (!name || !kcal || kcal < 1 || protein < 0 || carbs < 0 || fat < 0 || fiber < 0) return;

  const data = await loadData();
  const key = dateKey(selectedDate);
  if (!data.days[key]) data.days[key] = [];

  if (editingEntryId) {
    const idx = data.days[key].findIndex((x) => x.id === editingEntryId);
    if (idx !== -1) {
      data.days[key][idx] = { ...data.days[key][idx], name, kcal, protein, carbs, fat, fiber, weightGrams, unit, meal: selectedMeal };
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
      unit,
      meal: selectedMeal,
      createdAt: Date.now(),
    });
  }

  await saveData(data);
  entryModal.close();
  await renderTracking();
}


async function deleteEntry(id) {
  const confirmed = await showConfirm('Eintrag löschen', 'Diesen Eintrag wirklich löschen?');
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
  const colors = {};
  const thresholds = {};

  goalsForm.querySelectorAll('.goal-input').forEach((input) => {
    const key = input.dataset.goalKey;
    const value = parseNumericValue(input.value);
    goals[key] = Number.isFinite(value) ? value : 0;
  });

  goalsForm.querySelectorAll('.color-input').forEach((input) => {
    const key = input.dataset.colorKey;
    colors[key] = input.value;
  });

  goalsForm.querySelectorAll('.threshold-input').forEach((input) => {
    const key = input.dataset.thresholdKey;
    const value = parseNumericValue(input.value);
    thresholds[key] = value / 100;
  });

  data.goals = normalizeGoalValues(goals);
  data.colors = colors;
  data.thresholds = thresholds;
  await saveData(data);
  await renderGoals();
  await renderTracking();
}

async function saveCustomFood(event) {
  event.preventDefault();
  const name = customFoodName.value.trim();
  const weightInput = Math.max(parseNumericValue(customFoodWeight.value), 0) || 100;
  const unit = customFoodUnit.value;
  
  // Normalization factor (to 100 for grams/ml, or per 1 unit for Stk)
  // But wait: if it's "per Stück", let's just store it as "1 Stk".
  // To keep it simple: we store the kcal for the given "weightInput" and "unit".
  
  const kcal = parseNumericValue(customFoodKcal.value);
  const protein = parseNumericValue(customFoodProtein.value);
  const carbs = parseNumericValue(customFoodCarbs.value);
  const fat = parseNumericValue(customFoodFat.value);
  const fiber = parseNumericValue(customFoodFiber.value);

  if (!name || kcal < 0 || protein < 0 || carbs < 0 || fat < 0 || fiber < 0) return;

  const data = await loadData();
  const updatedData = upsertCustomFood(
    data,
    { name, weightGrams: weightInput, unit, kcal, protein, carbs, fat, fiber },
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
  const confirmed = await showConfirm('Gericht löschen', 'Dieses Gericht wirklich löschen?');
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
  customFoodUnit.value = food.unit || 'g';
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
  const data = await loadData(); // Ensure data (and API Key) is loaded
  
  // Initialize chat history if empty
  if (chatHistory.length === 0) {
    initChatHistory();
  }
  
  const keyHint = document.querySelector('.api-key-hint');
  if (aiApiKey && keyHint) {
    keyHint.classList.add('hidden');
  } else if (!aiApiKey && keyHint) {
    keyHint.classList.remove('hidden');
  }
  
  aiInput.focus();
}

function clearChatHistory() {
  // Clear chat history
  initChatHistory();
  
  // Clear UI messages
  aiMessages.innerHTML = `
    <div class="message system">
      <p>Hallo! Ich bin dein KI-Assistent. Ich kann Einträge für dich anlegen, Ziele ändern oder deine Daten analysieren.</p>
      <p class="api-key-hint ${aiApiKey ? 'hidden' : ''}">Um zu starten, hinterlege bitte einen OpenAI API-Key in den Einstellungen oder tippe ihn hier ein.</p>
    </div>
  `;
}

function showTypingIndicator() {
  const existingIndicator = document.getElementById('typingIndicator');
  if (existingIndicator) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'typingIndicator';
  indicator.className = 'message assistant typing-indicator';
  indicator.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  aiMessages.appendChild(indicator);
  scrollChatToBottom();
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typingIndicator');
  if (indicator) indicator.remove();
}

function appendToolMessage(toolName, isStart = true) {
  const toolLabels = {
    'get_data': { start: '📊 Lade Daten...', end: '✅ Daten geladen' },
    'add_entry': { start: '➕ Füge Eintrag hinzu...', end: '✅ Eintrag hinzugefügt' },
    'delete_entry': { start: '🗑️ Lösche Eintrag...', end: '✅ Eintrag gelöscht' },
    'update_entry': { start: '✏️ Aktualisiere Eintrag...', end: '✅ Eintrag aktualisiert' },
    'set_goals': { start: '🎯 Setze Ziele...', end: '✅ Ziele gespeichert' },
    'add_custom_food': { start: '🍽️ Speichere Gericht...', end: '✅ Gericht gespeichert' },
    'set_weight': { start: '⚖️ Speichere Gewicht...', end: '✅ Gewicht gespeichert' }
  };
  
  const label = toolLabels[toolName] || { start: '⏳ Verarbeite...', end: '✅ Fertig' };
  const text = isStart ? label.start : label.end;
  
  const msgEl = document.createElement('div');
  msgEl.className = 'message system tool-message';
  msgEl.innerHTML = `<p>${text}</p>`;
  aiMessages.appendChild(msgEl);
  scrollChatToBottom();
}


async function renderWeight() {
  const data = await loadData();
  const weightData = data.weight || {};
  const currentKey = dateKey(selectedWeightDate);
  
  weightDateLabel.textContent = formatDateLabel(selectedWeightDate);
  weightDateSub.textContent = formatDateSub(selectedWeightDate);
  nextWeightDay.disabled = isFuture(startOfDay(new Date(selectedWeightDate.getTime() + 86400000)));

  if (weightData[currentKey]) {
    weightInput.value = weightData[currentKey].value;
    periodInput.checked = weightData[currentKey].period;
  } else {
    weightInput.value = '';
    periodInput.checked = false;
  }

  weightTableBody.innerHTML = '';
  
  // Show last 7 days including selectedWeightDate
  const tableDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(selectedWeightDate);
    d.setDate(d.getDate() - i);
    tableDays.push(dateKey(d));
  }

  for (const date of tableDays) {
    const entry = weightData[date];
    const d = parseDateKey(date);
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(formatTableDate(date))}</td>
      <td class="num">${entry ? entry.value.toLocaleString('de-DE') + ' kg' : '—'}</td>
      <td class="num">${entry && entry.period ? '<span class="period-indicator">Ja</span>' : '—'}</td>
      <td class="num">
        ${entry ? `<button type="button" class="weight-entry-delete" data-date="${date}" style="background:none; border:none; color:var(--over); cursor:pointer; font-size:1.1rem;">✕</button>` : ''}
      </td>
    `;
    
    if (entry) {
      tr.querySelector('.weight-entry-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteWeightEntry(date);
      });
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => {
        selectedWeightDate = parseDateKey(date);
        renderWeight();
      });
    }
    
    weightTableBody.appendChild(tr);
  }
}

async function saveWeight(e) {
  e.preventDefault();
  const value = parseNumericValue(weightInput.value);
  if (!value || value <= 0) return;

  const data = await loadData();
  const currentKey = dateKey(selectedWeightDate);
  data.weight[currentKey] = { value, period: periodInput.checked };
  await saveData(data);
  await renderWeight();
  alert('Gewicht für ' + formatDateLabel(selectedWeightDate) + ' gespeichert!');
}

async function deleteWeightEntry(date) {
  const confirmed = await showConfirm('Eintrag löschen', 'Diesen Gewichtseintrag wirklich löschen?');
  if (!confirmed) return;

  const data = await loadData();
  delete data.weight[date];
  
  if (isSupabaseConfigured()) {
    try {
      await supabaseRequest(`/weight?date=eq.${encodeURIComponent(date)}`, { method: 'DELETE' });
    } catch (err) {
      console.warn('Supabase delete weight failed', err);
    }
  }

  await saveData(data);
  await renderWeight();
}

async function renderWeightStats() {
  const data = await loadData();
  const weightData = data.weight || {};
  
  const daysToShow = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    daysToShow.push(dateKey(d));
  }

  const values = daysToShow.map(key => weightData[key]?.value || null);
  const periods = daysToShow.map(key => weightData[key]?.period || false);
  const labels = daysToShow.map(key => {
    const d = parseDateKey(key);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  });

  if (weightChart) weightChart.destroy();

  weightChart = new Chart(document.getElementById('weightChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Gewicht (kg)',
        data: values,
        borderColor: '#EC4899',
        backgroundColor: 'rgba(236, 72, 153, 0.1)',
        borderWidth: 3,
        pointRadius: 5,
        pointBackgroundColor: periods.map(p => p ? '#ef4444' : '#EC4899'),
        pointBorderColor: periods.map(p => p ? '#ef4444' : '#EC4899'),
        tension: 0.3,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: false,
          title: { display: true, text: 'kg' }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            afterLabel: (context) => {
              const index = context.dataIndex;
              return periods[index] ? ' (Periode)' : '';
            }
          }
        }
      }
    }
  });

  // Summary
  const validValues = values.filter(v => v !== null);
  if (validValues.length > 0) {
    const min = Math.min(...validValues);
    const max = Math.max(...validValues);
    const first = validValues[0];
    const last = validValues[validValues.length - 1];
    const diff = last - first;

    weightStatsSummary.innerHTML = `
      <div class="stats-summary-item">
        <span>Min / Max</span>
        <strong>${min.toLocaleString('de-DE')} - ${max.toLocaleString('de-DE')} kg</strong>
      </div>
      <div class="stats-summary-item">
        <span>Differenz</span>
        <strong style="color: ${diff <= 0 ? '#22C55E' : '#ef4444'}">${diff > 0 ? '+' : ''}${diff.toLocaleString('de-DE')} kg</strong>
      </div>
    `;
  } else {
    weightStatsSummary.innerHTML = '<p class="empty-state">Noch keine Gewichtsdaten für die letzten 30 Tage.</p>';
  }
}

async function renderStatistics() {
  const data = await loadData();
  
  // Initialize date range if not set
  if (!statsStartDate.value || !statsEndDate.value) {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6); // Last 7 days including today
    
    statsStartDate.value = dateKey(start);
    statsEndDate.value = dateKey(end);
  }

  const start = parseDateKey(statsStartDate.value);
  const end = parseDateKey(statsEndDate.value);
  
  const daysToShow = [];
  let current = new Date(start);
  while (current <= end) {
    daysToShow.push(dateKey(current));
    current.setDate(current.getDate() + 1);
  }

  const range = daysToShow.length || 1;

  const kcalData = daysToShow.map(key => sumKcal(data.days[key] || []));
  const proteinData = daysToShow.map(key => sumProtein(data.days[key] || []));
  const labels = daysToShow.map(key => {
    const d = parseDateKey(key);
    if (range > 14) {
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    }
    return d.toLocaleDateString('de-DE', { weekday: 'short' });
  });

  if (combinedChart) combinedChart.destroy();

  combinedChart = new Chart(document.getElementById('combinedChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'kcal',
          data: kcalData,
          backgroundColor: 'rgba(236, 72, 153, 0.6)',
          borderColor: '#EC4899',
          borderWidth: 1,
          borderRadius: 6,
          yAxisID: 'yKcal',
          order: 2
        },
        {
          label: 'Protein (g)',
          data: proteinData,
          type: 'line',
          borderColor: '#22C55E',
          backgroundColor: '#22C55E',
          borderWidth: 3,
          pointRadius: 4,
          tension: 0.3,
          yAxisID: 'yProtein',
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      scales: {
        yKcal: {
          type: 'linear',
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: 'Kalorien (kcal)', color: '#EC4899' },
          grid: { display: false }
        },
        yProtein: {
          type: 'linear',
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Protein (g)', color: '#22C55E' },
          grid: { color: 'rgba(0,0,0,0.05)' }
        }
      },
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });

  // Summary
  const avgKcal = Math.round(kcalData.reduce((a, b) => a + b, 0) / range);
  const avgProtein = Math.round(proteinData.reduce((a, b) => a + b, 0) / range);
  
  const statsSummary = document.getElementById('statsSummary');
  statsSummary.innerHTML = `
    <div class="stats-summary-item">
      <span>Ø Kalorien</span>
      <strong>${avgKcal} kcal</strong>
    </div>
    <div class="stats-summary-item">
      <span>Ø Protein</span>
      <strong>${avgProtein} g</strong>
    </div>
  `;
}

function scrollChatToBottom() {
  requestAnimationFrame(() => {
    aiMessages.scrollTop = aiMessages.scrollHeight;
  });
}

function appendMessage(role, content) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;
  
  let textContent = '';
  let imageUrl = null;

  if (Array.isArray(content)) {
    const textPart = content.find(c => c.type === 'text');
    const imagePart = content.find(c => c.type === 'image_url');
    textContent = textPart ? textPart.text : '';
    imageUrl = imagePart ? imagePart.image_url.url : null;
  } else {
    textContent = content;
  }

  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'message-image';
    img.loading = 'eager';
    // Handle image load to scroll properly
    img.onload = scrollChatToBottom;
    msgEl.appendChild(img);
  }

  if (textContent) {
    const p = document.createElement('p');
    p.innerHTML = escapeHtml(textContent).replace(/\n/g, '<br>');
    msgEl.appendChild(p);
  }

  if (role === 'user') {
    msgEl.addEventListener('click', () => {
      if (textContent) {
        aiInput.value = textContent;
        aiInput.focus();
        aiInput.style.height = 'auto';
        aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
      }
    });
  }

  aiMessages.appendChild(msgEl);
  scrollChatToBottom();
}

async function handleAiMessage() {
  const text = aiInput.value.trim();
  if (!text && !pendingImageBase64) return;

  if (!aiApiKey) {
    if (text.startsWith('sk-')) {
      aiApiKey = text;
      localStorage.setItem('openai_api_key', aiApiKey);
      if (isSupabaseConfigured()) {
        try {
          await supabaseRequest('/settings?on_conflict=id', {
            method: 'POST',
            body: [{ id: 'openai_api_key', value: aiApiKey }]
          });
          appendMessage('system', '🔐 API-Key sicher in der Cloud gespeichert!');
        } catch (e) {
          appendMessage('system', '🔐 API-Key lokal gespeichert.');
        }
      } else {
        appendMessage('system', '🔐 API-Key lokal gespeichert.');
      }
      const keyHint = document.querySelector('.api-key-hint');
      if (keyHint) keyHint.classList.add('hidden');
      aiInput.value = '';
      aiInput.style.height = 'auto';
      return;
    } else {
      appendMessage('user', text || 'Bild gesendet');
      appendMessage('assistant', 'Bitte gib zuerst deinen OpenAI API-Key ein (beginnend mit sk-).');
      aiInput.value = '';
      aiInput.style.height = 'auto';
      return;
    }
  }

  // Update system prompt with current date before sending
  if (chatHistory.length > 0 && chatHistory[0].role === 'system') {
    chatHistory[0] = getSystemPrompt();
  }

  const userMessageContent = [];
  if (text) userMessageContent.push({ type: 'text', text: text });
  if (pendingImageBase64) {
    userMessageContent.push({
      type: 'image_url',
      image_url: { url: pendingImageBase64 }
    });
  }

  appendMessage('user', userMessageContent);
  aiInput.value = '';
  aiInput.style.height = 'auto';
  clearPendingImage();

  chatHistory.push({ role: 'user', content: userMessageContent });
  
  // Disable input while processing
  aiInput.disabled = true;
  aiSendBtn.disabled = true;
  showTypingIndicator();

  try {
    let keepProcessing = true;
    let maxRounds = 5; // Safety limit
    let uiNeedsRefresh = false;

    while (keepProcessing && maxRounds > 0) {
      maxRounds--;
      const data = await callAi(chatHistory, aiApiKey);
      const message = data.choices[0].message;
      
      // Always push the assistant's message (even if it's just tool_calls)
      chatHistory.push(message);

      if (message.tool_calls) {
        hideTypingIndicator();
        
        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          appendToolMessage(toolName, true);
          
          const result = await executeTool(toolCall);
          
                    // Check if UI needs refresh
          if (['add_entry', 'delete_entry', 'update_entry', 'set_goals', 'add_custom_food', 'set_weight'].includes(toolName)) {
            uiNeedsRefresh = true;
          }
          
          chatHistory.push({
            tool_call_id: toolCall.id,
            role: 'tool',
            name: toolName,
            content: JSON.stringify(result)
          });
        }
        
        showTypingIndicator();
        // After processing tools, the loop will call AI again with the results
      } else {
        hideTypingIndicator();
        // No tool calls? We are done, show the message to the user
        if (message.content) {
          appendMessage('assistant', message.content);
        }
        keepProcessing = false;
      }
    }
    
    if (maxRounds === 0) {
      hideTypingIndicator();
      appendMessage('system', '⚠️ Die KI hat zu viele Schritte benötigt.');
    }
    
    // Refresh UI if data was modified
        if (uiNeedsRefresh) {
      await renderTracking();
      await renderGoals();
      await renderWeight();
    }

  } catch (error) {
    hideTypingIndicator();
    console.error('AI Error:', error);
    
    // Better error messages
    let errorMsg = error.message;
    if (errorMsg.includes('401') || errorMsg.includes('Incorrect API key')) {
      errorMsg = 'Ungültiger API-Key. Bitte überprüfe deinen OpenAI API-Key.';
    } else if (errorMsg.includes('429')) {
      errorMsg = 'Zu viele Anfragen. Bitte warte einen Moment.';
    } else if (errorMsg.includes('500') || errorMsg.includes('502') || errorMsg.includes('503')) {
      errorMsg = 'OpenAI-Server nicht erreichbar. Bitte versuche es später erneut.';
    }
    
    appendMessage('system', `❌ ${errorMsg}`);
  } finally {
    // Re-enable input
    aiInput.disabled = false;
    aiSendBtn.disabled = false;
    aiInput.focus();
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

  // Compress image for better performance
  try {
    const compressedBase64 = await compressImage(file, 1024, 0.8);
    pendingImageBase64 = compressedBase64;
    aiImagePreview.querySelector('img').src = pendingImageBase64;
    aiImagePreview.classList.remove('hidden');
  } catch (err) {
    console.warn('Image compression failed, using original', err);
    const reader = new FileReader();
    reader.onload = (event) => {
      pendingImageBase64 = event.target.result;
      aiImagePreview.querySelector('img').src = pendingImageBase64;
      aiImagePreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
}

function compressImage(file, maxSize = 1024, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      
      // Scale down if larger than maxSize
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        } else {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to JPEG for smaller size
      const base64 = canvas.toDataURL('image/jpeg', quality);
      resolve(base64);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
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

    if (name === 'update_entry') {
    const data = await loadData();
    const key = args.date;
    if (data.days[key]) {
      const idx = data.days[key].findIndex(e => e.id === args.id);
      if (idx !== -1) {
        data.days[key][idx] = { ...data.days[key][idx], ...args, createdAt: data.days[key][idx].createdAt };
        await saveData(data);
        return { success: true };
      }
    }
    return { success: false, error: 'Eintrag nicht gefunden' };
  }

  if (name === 'set_weight') {
    const data = await loadData();
    const key = args.date;
    data.weight[key] = { value: args.weight, period: Boolean(args.period) };
    await saveData(data);
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
  else if (hash === '#/statistiken') setView('statistics');
  else if (hash === '#/gewicht') setView('weight');
  else if (hash === '#/gewichtsverlauf') setView('weightStats');
  else setView('tracking');
}

// Events
menuBtn.addEventListener('click', () => {
  if (navDrawer.classList.contains('open')) closeNav();
  else openNav();
});

navBackdrop.addEventListener('click', closeNav);

navDrawer.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    void setView(/** @type {'tracking' | 'history' | 'customFoods' | 'goals' | 'aiChat' | 'statistics'} */ (btn.dataset.view));
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
statsStartDate.addEventListener('change', () => renderStatistics());
statsEndDate.addEventListener('change', () => renderStatistics());

prevWeightDay.addEventListener('click', () => {
  selectedWeightDate.setDate(selectedWeightDate.getDate() - 1);
  renderWeight();
});

nextWeightDay.addEventListener('click', () => {
  if (nextWeightDay.disabled) return;
  selectedWeightDate.setDate(selectedWeightDate.getDate() + 1);
  renderWeight();
});

weightForm.addEventListener('submit', saveWeight);

// Clear chat button
const clearChatBtn = document.getElementById('clearChatBtn');
if (clearChatBtn) {
  clearChatBtn.addEventListener('click', clearChatHistory);
}

aiInput.addEventListener('input', () => {
  aiInput.style.height = 'auto';
  aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px';
});

// iOS Keyboard handling - scroll to bottom when focused
aiInput.addEventListener('focus', () => {
  // Small delay to let iOS keyboard appear
  setTimeout(() => {
    aiMessages.scrollTop = aiMessages.scrollHeight;
  }, 300);
});

// Handle visualViewport resize (iOS keyboard)
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    if (currentView === 'aiChat') {
      // Scroll chat to bottom when keyboard appears/disappears
      setTimeout(() => {
        aiMessages.scrollTop = aiMessages.scrollHeight;
      }, 100);
    }
  });
}

window.addEventListener('hashchange', initFromHash);

renderMealPicker(guessMealByTime());
applyEntryModalLayout();
initChatHistory();
initFromHash();
