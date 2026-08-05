export const GOAL_NUTRIENTS = [
  { key: 'kcal', label: 'Kalorien', unit: 'kcal' },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'carbs', label: 'Kohlenhydrate', unit: 'g' },
  { key: 'fat', label: 'Fett', unit: 'g' },
  { key: 'fiber', label: 'Ballaststoffe', unit: 'g' },
];

export function parseNumericInput(value) {
  if (value == null) return 0;

  const text = String(value).trim().replace(/,/, '.');
  if (!text) return 0;

  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeGoalValues(goals = {}) {
  return GOAL_NUTRIENTS.reduce((acc, nutrient) => {
    const value = parseNumericInput(goals[nutrient.key]);
    acc[nutrient.key] = Number.isFinite(value) ? value : 0;
    return acc;
  }, {});
}

function getGoalProgress(actual, goal) {
  if (!goal || goal <= 0) return null;
  return actual / goal;
}

const DEFAULT_COLORS = {
  low: '#FF073A',
  medium: '#ffae00',
  ideal: '#39FF14',
  over: '#00E5FF',
};

function getGoalColor(progress, colors = DEFAULT_COLORS) {
  if (progress == null) return '#8B93A7';
  if (progress < 0.7) return colors.low || DEFAULT_COLORS.low;
  if (progress < 0.9) return colors.medium || DEFAULT_COLORS.medium;
  if (progress <= 1.05) return colors.ideal || DEFAULT_COLORS.ideal;
  return colors.over || DEFAULT_COLORS.over;
}

export function buildGoalRows(actuals = {}, goals = {}, colors = DEFAULT_COLORS) {
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
      color: getGoalColor(progress, colors),
      progressWidth: percent == null ? 0 : Math.min(100, Math.max(0, percent)),
    };
  });
}

export function formatGoalPercent(percent) {
  if (percent == null) return '—';
  return `${percent.toFixed(0)}%`;
}
