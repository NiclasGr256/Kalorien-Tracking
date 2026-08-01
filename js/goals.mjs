export const GOAL_NUTRIENTS = [
  { key: 'kcal', label: 'Kalorien', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Kohlenhydrate', unit: 'g' },
  { key: 'fat', label: 'Fett', unit: 'g' },
  { key: 'fiber', label: 'Ballaststoffe', unit: 'g' },
];

export function normalizeGoalValues(goals = {}) {
  return GOAL_NUTRIENTS.reduce((acc, nutrient) => {
    const value = Number(goals[nutrient.key]);
    acc[nutrient.key] = Number.isFinite(value) ? value : 0;
    return acc;
  }, {});
}

function getGoalProgress(actual, goal) {
  if (!goal || goal <= 0) return null;
  return actual / goal;
}

function getGoalColor(progress) {
  if (progress == null) return '#8B93A7';
  if (progress < 0.7) return '#FF073A';
  if (progress < 0.9) return '#ffae00';
  if (progress <= 1.05) return '#39FF14';
  return '#00E5FF';
}

export function buildGoalRows(actuals = {}, goals = {}) {
  const normalizedGoals = normalizeGoalValues(goals);

  return GOAL_NUTRIENTS.map((nutrient) => {
    const actual = Number(actuals[nutrient.key]) || 0;
    const goal = Number(normalizedGoals[nutrient.key]) || 0;
    const progress = getGoalProgress(actual, goal);
    const percent = progress == null ? null : progress * 100;

    return {
      ...nutrient,
      actual,
      goal,
      progress,
      percent,
      color: getGoalColor(progress),
      progressWidth: percent == null ? 0 : Math.min(100, Math.max(0, percent)),
    };
  });
}

export function formatGoalPercent(percent) {
  if (percent == null) return '—';
  return `${percent.toFixed(0)}%`;
}
