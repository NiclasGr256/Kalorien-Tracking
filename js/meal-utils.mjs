const MEAL_ORDER = ['frühstück', 'mittag', 'abend', 'snack'];
const MEAL_LABELS = {
  frühstück: 'Frühstück',
  mittag: 'Mittag',
  abend: 'Abend',
  snack: 'Snack',
};

function normalizeMealValue(value) {
  return MEAL_ORDER.includes(value) ? value : 'snack';
}

function guessMealByTime(now = new Date()) {
  const hour = now.getHours();
  if (hour < 10) return 'frühstück';
  if (hour < 14) return 'mittag';
  if (hour < 18) return 'abend';
  return 'snack';
}

export { MEAL_ORDER, MEAL_LABELS, normalizeMealValue, guessMealByTime };
