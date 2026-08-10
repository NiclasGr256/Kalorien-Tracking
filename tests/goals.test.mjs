import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGoalValues, buildGoalRows, parseNumericInput } from '../js/goals.mjs';

test('normalizeGoalValues converts goal values to numbers and preserves known keys', () => {
  const normalized = normalizeGoalValues({ kcal: '2200', protein: '120', carbs: '240', fat: '80', fiber: '30', unknown: '5' });

  assert.deepEqual(normalized, {
    kcal: 2200,
    protein: 120,
    carbs: 240,
    fat: 80,
    fiber: 30,
  });
});

test('buildGoalRows uses the configured color thresholds for each nutrient', () => {
  const rows = buildGoalRows({ kcal: 1400, protein: 60, carbs: 210, fat: 70, fiber: 20 }, { kcal: 2000, protein: 80, carbs: 300, fat: 100, fiber: 25 });

  // 1400/2000 = 0.7 (genau an der Grenze zum Warnbereich)
  assert.equal(rows[0].color, '#ffae00');
  // 60/80 = 0.75
  assert.equal(rows[1].color, '#ffae00');
  // 210/300 = 0.7
  assert.equal(rows[2].color, '#ffae00');
  // 70/100 = 0.7
  assert.equal(rows[3].color, '#ffae00');
  // 20/25 = 0.8
  assert.equal(rows[4].color, '#ffae00');
});


test('parseNumericInput normalizes comma decimals and invalid values', () => {
  assert.equal(parseNumericInput('12,5'), 12.5);
  assert.equal(parseNumericInput('3.25'), 3.25);
  assert.equal(parseNumericInput(''), 0);
  assert.equal(parseNumericInput('abc'), 0);
});
