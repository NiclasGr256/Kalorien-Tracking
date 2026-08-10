/**
 * Hilfsfunktion zum Escapen von HTML (verhindert XSS)
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Erzeugt das HTML für einen Nahrungsmittel-Eintrag
 */
export function createEntryTemplate(entry) {
  const unit = entry.unit || 'g';
  const protein = Number(entry.protein) || 0;
  const fat = Number(entry.fat) || 0;
  const carbs = Number(entry.carbs) || 0;
  const fiber = Number(entry.fiber) || 0;

  return `
    <div class="entry-info">
      <div class="entry-main">
        <div class="entry-name">${escapeHtml(entry.name)}</div>
        <div class="entry-subtext">${entry.weightGrams || 0} ${unit} · ${entry.kcal} kcal · P ${protein} g · F ${fat} g · K ${carbs} g · B ${fiber} g</div>
      </div>
    </div>
    <span class="entry-kcal">${entry.kcal}</span>
    <div class="entry-actions">
      <button type="button" data-copy="${entry.id}" title="Nach heute kopieren">📋</button>
      <button type="button" data-edit="${entry.id}">✎</button>
      <button type="button" class="delete-btn" data-delete="${entry.id}">✕</button>
    </div>
  `;
}

/**
 * Erzeugt das HTML für eine Ziel-Karte (Fortschrittsbalken)
 */
export function createGoalCardTemplate(row) {
  const percentLabel = row.percent == null ? '—' : `${Math.round(row.percent)}%`;
  const progressWidth = Math.min(100, Math.max(0, row.progressWidth || 0));
  
  return `
    <div class="goal-card-header">
      <div>
        <h3>${escapeHtml(row.label)}</h3>
        <p>${row.actual.toLocaleString('de-DE')} ${row.unit} / ${row.goal > 0 ? `${row.goal.toLocaleString('de-DE')} ${row.unit}` : 'kein Ziel'}</p>
      </div>
      <span class="goal-pill" style="background:${row.color}; color:#111827;">${percentLabel}</span>
    </div>
    <div class="goal-progress">
      <div class="goal-progress-bar" style="width:${progressWidth}%; background:${row.color};"></div>
    </div>
  `;
}
