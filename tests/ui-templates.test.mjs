import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntryTemplate, createGoalCardTemplate, escapeHtml } from '../js/ui-components.js';

test('escapeHtml verhindert XSS Angriffe', () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const safe = escapeHtml(unsafe);
  assert.strictEqual(safe.includes('<'), false);
  assert.strictEqual(safe.includes('&lt;'), true);
});

test('createEntryTemplate erzeugt korrektes HTML-Gerüst', () => {
  const entry = {
    id: '123',
    name: 'Test Food',
    kcal: 500,
    protein: 20,
    carbs: 50,
    fat: 10,
    fiber: 5,
    weightGrams: 100,
    unit: 'g'
  };
  
  const html = createEntryTemplate(entry);
  
  assert.ok(html.includes('Test Food'), 'Name fehlt im HTML');
  assert.ok(html.includes('500'), 'Kalorien fehlen im HTML');
  assert.ok(html.includes('P 20 g'), 'Protein fehlt im HTML');
  assert.ok(html.includes('data-edit="123"'), 'Edit-ID fehlt');
});

test('createGoalCardTemplate zeigt Fortschritt korrekt an', () => {
  const row = {
    label: 'Kalorien',
    actual: 1500,
    goal: 2000,
    unit: 'kcal',
    percent: 75,
    progressWidth: 75,
    color: '#39FF14'
  };
  
  const html = createGoalCardTemplate(row);
  
  assert.ok(html.includes('75%'), 'Prozentanzeige fehlt');
  assert.ok(html.includes('width:75%'), 'Fortschrittsbalken-Breite falsch');
  assert.ok(html.includes('background:#39FF14'), 'Farbe wird nicht angewendet');
});
