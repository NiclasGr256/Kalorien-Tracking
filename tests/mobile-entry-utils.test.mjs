import test from 'node:test';
import assert from 'node:assert/strict';
import { isCompactEntryFormViewport, getEntryFormLayoutMode } from '../js/mobile-entry-utils.mjs';

test('isCompactEntryFormViewport erkennt mobile Breite', () => {
  // Breite <= 768px sollte true sein
  assert.strictEqual(isCompactEntryFormViewport(375, false), true);
  assert.strictEqual(isCompactEntryFormViewport(768, false), true);
  // Breite > 768px sollte false sein
  assert.strictEqual(isCompactEntryFormViewport(1024, false), false);
});

test('isCompactEntryFormViewport priorisiert Touch-Support', () => {
  // Auch auf Desktop-Breite sollte Touch true ergeben
  assert.strictEqual(isCompactEntryFormViewport(1024, true), true);
});

test('getEntryFormLayoutMode liefert korrektes UI-Element', () => {
  assert.strictEqual(getEntryFormLayoutMode(375, false), 'sheet');
  assert.strictEqual(getEntryFormLayoutMode(1024, false), 'dialog');
});
