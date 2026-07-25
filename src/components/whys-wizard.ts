import { rcaData, type RCAWhys, getLastWhyLevel, isWizardCompleted, getWizardLevel, getCurrentCauseSummary, getWhy, setWhy } from '../state/store';
import { escapeHtml } from '../utils/text';
import { showToast } from '../utils/toast';

/* ==========================================================================
   5 Whys Wizard Constants
   ========================================================================== */

export const WHY_COLORS = [
  null,
  { bg: 'bg-blue-600', text: 'text-blue-700', label: 'text-blue-800' },
  { bg: 'bg-blue-600', text: 'text-blue-700', label: 'text-blue-800' },
  { bg: 'bg-blue-600', text: 'text-blue-700', label: 'text-blue-800' },
  { bg: 'bg-blue-600', text: 'text-blue-700', label: 'text-blue-800' },
  { bg: 'bg-blue-600', text: 'text-blue-700', label: 'text-blue-800' }
];

export const WHY_LABELS: Record<number, string> = {
  1: '¿Por qué ocurrió el problema?',
  2: '¿Por qué ocurrió eso?',
  3: '¿Por qué ocurrió eso?',
  4: '¿Por qué ocurrió eso?',
  5: '¿Por qué ocurrió eso? (Causa raíz)'
};

export const WHY_PLACEHOLDERS: Record<number, string> = {
  1: 'Describe la primera causa...',
  2: 'Profundiza en la causa...',
  3: 'Sigue profundizando...',
  4: 'Casi llegamos a la raíz...',
  5: 'Esta es la causa raíz fundamental...'
};

// State query functions (getLastWhyLevel, isWizardCompleted, etc.)
// are imported from store.ts to avoid circular dependencies.

/** Saves the active input to state */
export function captureActiveWhyInput(): void {
  const input = document.getElementById('why-active-input') as HTMLInputElement | null;
  if (!input) return;
  const level = getWizardLevel();
  if (level >= 1 && level <= 5) {
    setWhy(rcaData.whys, level, input.value.trim());
  }
}

/** Counts completed responses before the active level */
function getTimelineCount(whys: RCAWhys, currentLevel: number): number {
  let count = 0;
  for (let i = 1; i < currentLevel; i++) {
    if (getWhy(whys, i)) count++;
  }
  return count;
}

/* ==========================================================================
   Rendering
   ========================================================================== */

/** Renders the complete wizard */
export function renderWhysWizard(): void {
  const timelineBody = document.getElementById('whys-timeline-body');
  const activeSection = document.getElementById('whys-active-section');
  const completedSection = document.getElementById('whys-completed-section');
  if (!timelineBody || !activeSection || !completedSection) return;

  const whys = rcaData.whys || {};
  const level = getWizardLevel();

  renderWhysTimeline(timelineBody, whys, level);

  if (isWizardCompleted()) {
    activeSection.classList.add('hidden');
    completedSection.classList.remove('hidden');
    renderWhysCompleted(completedSection, whys);
    const addLink = document.getElementById('whys-add-link');
    if (addLink) addLink.innerHTML = '';
  } else {
    activeSection.classList.remove('hidden');
    completedSection.classList.add('hidden');
    renderWhyActive(level, getWhy(whys, level));
    renderWhysAddLink(level);
  }

  const count = getTimelineCount(whys, level);
  // Always show timeline open by default — remove collapsed class
  document.getElementById('whys-timeline-body')?.classList.remove('whys-timeline-collapsed');
  const chevron = document.getElementById('whys-timeline-chevron');
  if (chevron) chevron.style.transform = '';

  updateRootCauseSummary();
}

/** Renders the timeline of completed responses */
function renderWhysTimeline(container: HTMLElement, whys: RCAWhys, currentLevel: number): void {
  const items: string[] = [];
  const maxLevel = isWizardCompleted() ? getLastWhyLevel() : currentLevel - 1;
  const completedLevel = getLastWhyLevel();

  for (let i = 1; i <= maxLevel; i++) {
    const text = getWhy(whys, i);
    if (!text) continue;

    const color = WHY_COLORS[i]!;
    const isRootCause = isWizardCompleted() && i === completedLevel;

    items.push(`
      <div class="why-card p-2 sm:p-3">
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 ${color.bg} text-white rounded-full flex items-center justify-center font-bold flex-shrink-0 text-xs">${i}</div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-semibold ${color.text}">${escapeHtml(WHY_LABELS[i])}</p>
            <p class="text-sm text-gray-700 truncate">${escapeHtml(text)}</p>
          </div>
          ${isRootCause ? '<span class="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full flex-shrink-0">Causa raíz</span>' : ''}
          ${!isWizardCompleted() ? '<button onclick="window.__whysEdit(' + i + ')" class="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-1" title="Editar"><i class="fas fa-pen text-xs"></i></button>' : ''}
        </div>
      </div>
    `);
  }

  container.innerHTML = items.join('');
  const countEl = document.getElementById('whys-timeline-count');
  if (countEl) countEl.textContent = String(items.length);
}

/** Renders the active card for the current level */
function renderWhyActive(level: number, value: string): void {
  const card = document.getElementById('whys-active-card');
  if (!card) return;
  const color = WHY_COLORS[level]!;

  card.innerHTML = `
    <div class="why-card p-3 sm:p-4 why-wizard-enter">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-8 h-8 ${color.bg} text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">${level}</div>
        <label class="font-semibold ${color.label}" for="why-active-input">${escapeHtml(WHY_LABELS[level])}</label>
      </div>
      <input type="text" id="why-active-input" class="input input-bordered w-full" placeholder="${escapeHtml(WHY_PLACEHOLDERS[level])}" value="${escapeHtml(value)}" autofocus>
    </div>
  `;

  setTimeout(() => {
    const input = document.getElementById('why-active-input') as HTMLInputElement | null;
    if (input) input.focus();
  }, 100);
}

/** Renders the '+ Agregar otro por qué' link below the active card */
function renderWhysAddLink(level: number): void {
  const container = document.getElementById('whys-add-link');
  if (!container) return;

  if (level >= 5) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="flex justify-end">
      <button onclick="window.__whysNext()" class="btn btn-sm btn-outline">
        <i class="fas fa-plus-circle"></i>
        <span>Agregar otro por qué</span>
      </button>
    </div>
  `;
}

/** Renders the completed state */
function renderWhysCompleted(container: HTMLElement, whys: RCAWhys): void {
  const level = getLastWhyLevel();
  const text = getWhy(whys, level);
  const color = WHY_COLORS[level] || WHY_COLORS[5]!;

  container.innerHTML = `
    <div class="text-center py-4">
      <div class="text-3xl mb-2"><i class="fas fa-flag-checkered text-green-500"></i></div>
      <h3 class="text-lg font-bold text-gray-800 mb-1">Análisis Completado</h3>
      <p class="text-gray-500 mb-4">Se identificó la causa raíz en el nivel ${level}.</p>
      <div class="why-card p-3 sm:p-4 inline-block text-left max-w-md mx-auto">
        <p class="text-xs font-semibold ${color.text} mb-1">Causa raíz (Nivel ${level})</p>
        <p class="text-sm text-gray-700">${escapeHtml(text)}</p>
      </div>
    </div>
    <div class="flex justify-center gap-2 mt-6">
      <button onclick="window.__whysEdit(${level})" class="btn btn-secondary">
        <i class="fas fa-pen"></i>
        <span>Editar</span>
      </button>
    </div>
  `;
}

/** Updates the root cause summary display */
export function updateRootCauseSummary(): string {
  const causeSummary = getCurrentCauseSummary();
  const el = document.getElementById('causaRaizResumen');
  if (el) el.textContent = causeSummary || '';
  return causeSummary;
}

/* ==========================================================================
   Wizard Navigation
   ========================================================================== */

/** Validates that the active input has content */
function validateActiveWhy(): boolean {
  const input = document.getElementById('why-active-input') as HTMLInputElement | null;
  if (!input || !input.value.trim()) {
    showToast('Por favor describe la causa antes de continuar.', 'warning');
    if (input) input.focus();
    return false;
  }
  return true;
}

/** Advances to the next level */
export function whysNext(syncPlan: () => void, persist: () => void): void {
  if (!validateActiveWhy()) return;
  captureActiveWhyInput();
  const level = getWizardLevel();
  rcaData.whys.wizardLevel = Math.min(level + 1, 5);
  renderWhysWizard();
  syncPlan();
  persist();
}

/** Goes back to the previous level */
export function whysPrev(syncPlan: () => void, persist: () => void): void {
  const level = getWizardLevel();
  if (level <= 1) return;
  captureActiveWhyInput();
  for (let i = level; i <= 5; i++) {
    setWhy(rcaData.whys, i, '');
  }
  rcaData.whys.wizardLevel = level - 1;
  renderWhysWizard();
  syncPlan();
  persist();
}

/** Finishes the wizard marking the current level as root cause */
export function whysFinish(syncPlan: () => void, persist: () => void): void {
  if (!validateActiveWhy()) return;
  captureActiveWhyInput();
  const level = getWizardLevel();
  for (let i = level + 1; i <= 5; i++) {
    setWhy(rcaData.whys, i, '');
  }
  rcaData.whys.wizardLevel = 0;
  renderWhysWizard();
  syncPlan();
  persist();
}

/** Edits a specific level going back in the wizard */
export function whysEdit(level: number): void {
  captureActiveWhyInput();
  rcaData.whys.wizardLevel = level;
  for (let i = level + 1; i <= 5; i++) {
    setWhy(rcaData.whys, i, '');
  }
  renderWhysWizard();
}

/** Toggles the timeline collapse */
export function toggleWhysTimeline(): void {
  const body = document.getElementById('whys-timeline-body');
  const chevron = document.getElementById('whys-timeline-chevron');
  if (!body) return;
  body.classList.toggle('whys-timeline-collapsed');
  if (chevron) {
    chevron.style.transform = body.classList.contains('whys-timeline-collapsed') ? 'rotate(-90deg)' : '';
  }
}

/** Clears all whys */
export function clearWhys(resetState: () => void, syncPlan: () => void, persist: () => void): void {
  rcaData.whys = { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 };
  renderWhysWizard();
  syncPlan();
  persist();
}
