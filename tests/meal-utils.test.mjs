import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMealValue, guessMealByTime } from '../js/meal-utils.js';


test('normalizeMealValue keeps known meal keys and falls back to snack', () => {
  assert.equal(normalizeMealValue('frühstück'), 'frühstück');
  assert.equal(normalizeMealValue('mittag'), 'mittag');
  assert.equal(normalizeMealValue('abend'), 'abend');
  assert.equal(normalizeMealValue('snack'), 'snack');
  assert.equal(normalizeMealValue('unknown'), 'snack');
});

test('guessMealByTime picks breakfast, lunch, dinner and snack by hour', () => {
  assert.equal(guessMealByTime(new Date('2024-01-01T09:59:00')), 'frühstück');
  assert.equal(guessMealByTime(new Date('2024-01-01T10:00:00')), 'mittag');
  assert.equal(guessMealByTime(new Date('2024-01-01T17:59:00')), 'abend');
  assert.equal(guessMealByTime(new Date('2024-01-01T18:00:00')), 'snack');
});
