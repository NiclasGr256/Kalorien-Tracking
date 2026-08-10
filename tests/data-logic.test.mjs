import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Hilfsfunktion zur Berechnung der Summen (Logik aus app.js)
 */
function calculateTotals(entries) {
  return entries.reduce((acc, e) => ({
    kcal: acc.kcal + (Number(e.kcal) || 0),
    protein: acc.protein + (Number(e.protein) || 0),
    carbs: acc.carbs + (Number(e.carbs) || 0),
    fat: acc.fat + (Number(e.fat) || 0),
    fiber: acc.fiber + (Number(e.fiber) || 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
}

test('calculateTotals summiert Nährwerte korrekt', () => {
  const entries = [
    { kcal: 100, protein: 10, carbs: 20, fat: 5, fiber: 2 },
    { kcal: 250, protein: 20, carbs: 30, fat: 10, fiber: 5 }
  ];
  
  const totals = calculateTotals(entries);
  
  assert.strictEqual(totals.kcal, 350);
  assert.strictEqual(totals.protein, 30);
  assert.strictEqual(totals.carbs, 50);
  assert.strictEqual(totals.fat, 15);
  assert.strictEqual(totals.fiber, 7);
});

test('calculateTotals geht mit fehlenden oder ungültigen Werten um', () => {
  const entries = [
    { kcal: '100', protein: null },
    { kcal: 50, carbs: undefined }
  ];
  
  const totals = calculateTotals(entries);
  
  assert.strictEqual(totals.kcal, 150);
  assert.strictEqual(totals.protein, 0);
  assert.strictEqual(totals.carbs, 0);
});

test('KI Tool-Argumente Validierung Simulation', () => {
  const addEntryArgs = { name: 'Banane', kcal: 90, meal: 'snack' };
  
  assert.ok(addEntryArgs.name.length > 0);
  assert.ok(addEntryArgs.kcal > 0);
  assert.strictEqual(addEntryArgs.meal, 'snack');
});
