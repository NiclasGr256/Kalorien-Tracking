import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertCustomFood } from '../js/custom-foods.js';


test('upsertCustomFood updates an existing custom food instead of duplicating it', () => {
  const data = {
    customFoods: [
      {
        id: 'food-1',
        name: 'Altes Gericht',
        weightGrams: 100,
        kcal: 200,
        protein: 10,
        carbs: 20,
        fat: 8,
        fiber: 2,
      },
    ],
  };

  const updated = upsertCustomFood(data, {
    name: 'Neues Gericht',
    weightGrams: 150,
    kcal: 300,
    protein: 15,
    carbs: 30,
    fat: 10,
    fiber: 4,
  }, 'food-1');

  assert.equal(updated.customFoods.length, 1);
  assert.equal(updated.customFoods[0].id, 'food-1');
  assert.equal(updated.customFoods[0].name, 'Neues Gericht');
  assert.equal(updated.customFoods[0].weightGrams, 150);
  assert.equal(updated.customFoods[0].kcal, 300);
});

test('upsertCustomFood adds a new custom food when no id is provided', () => {
  const data = { customFoods: [] };

  const updated = upsertCustomFood(data, {
    name: 'Frischer Salat',
    weightGrams: 200,
    kcal: 180,
    protein: 8,
    carbs: 12,
    fat: 6,
    fiber: 5,
  });

  assert.equal(updated.customFoods.length, 1);
  assert.equal(updated.customFoods[0].name, 'Frischer Salat');
  assert.ok(updated.customFoods[0].id);
});
