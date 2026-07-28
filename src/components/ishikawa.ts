import { rcaData, CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, type RCAIshikawa } from '../state/store';
import { splitTextValues, sanitizeKeywordEntries } from '../utils/text';
import { showToast } from '../utils/toast';
import { createIshikawaImage } from '../services/ishikawaRenderer';

/* ==========================================================================
   Ishikawa Diagram Functions
   ========================================================================== */

/** Gets Ishikawa categories that have content */
export function getFilledIshikawaEntries(): { categoryKey: string; label: string; value: string }[] {
  return CATEGORY_ORDER
    .map(categoryKey => ({
      categoryKey,
      label: ISHIKAWA_CATEGORY_CONFIG[categoryKey].label,
      value: (document.getElementById(`ishikawa-${categoryKey}`) as HTMLTextAreaElement)?.value?.trim() || ''
    }))
    .filter(entry => entry.value);
}

/* ==========================================================================
   Canvas-based Ishikawa Renderer (shared with PDF export)
   ========================================================================== */

/** Refreshes the canvas-based diagram in the main Ishikawa tab */
export function refreshIshikawaDiagram(): void {
  const diagram = document.getElementById('ishikawa-diagram');
  if (!diagram) return;

  const filledEntries = getFilledIshikawaEntries();
  if (filledEntries.length === 0) {
    diagram.classList.add('hidden');
    return;
  }
  diagram.classList.remove('hidden');

  // Build data from DOM
  const ishikawa: Record<string, string> = {};
  CATEGORY_ORDER.forEach(cat => {
    const el = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement | null;
    ishikawa[cat] = el?.value?.trim() || '';
  });
  const problema = (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() || '';

  const result = createIshikawaImage(ishikawa, problema, 1);
  if (!result || !result.imgData) {
    diagram.classList.add('hidden');
    return;
  }

  // Replace contents with an <img> tag using the canvas data URL
  let img = diagram.querySelector('img.ishikawa-svg') as HTMLImageElement | null;
  if (!img) {
    diagram.innerHTML = '';
    img = document.createElement('img');
    img.className = 'ishikawa-svg';
    img.alt = 'Diagrama de Ishikawa';
    diagram.appendChild(img);
  }
  img.src = result.imgData;
  img.style.width = '100%';
  img.style.height = 'auto';
}

/** Generates canvas image preview from saved data (for modals and the "Todos los datos" view) */
export function generateIshikawaPreview(
  ishikawa: Record<string, string | undefined>,
  problema: string
): { imgData: string; width: number; height: number; isEmpty: boolean } {
  const hasData = Object.values(ishikawa).some(v => v && String(v).trim());
  if (!hasData) {
    return { imgData: '', width: 0, height: 0, isEmpty: true };
  }
  const result = createIshikawaImage(ishikawa, problema, 2);
  if (!result) {
    return { imgData: '', width: 0, height: 0, isEmpty: true };
  }
  return {
    imgData: result.imgData,
    width: result.width,
    height: result.height,
    isEmpty: false
  };
}



/** Updates the diagram visuals (simplified — no cards to color, kept for API compatibility) */
export function updateIshikawaDiagram(_detectedCategories: Record<string, boolean>): void {
  // Cards were removed; this is kept for API compatibility
}

/** Focuses the textarea of a category when clicking on the diagram */
export function editCategory(cat: string): void {
  const el = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement | null;
  if (el) {
    el.focus();
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

/** Saves the Ishikawa data */
export function saveIshikawa(
  syncPlan: () => void,
  persist: () => void,
  updateIshikawaForMachine: (machine: string, data: RCAIshikawa, problem: string) => void
): void {
  const emptyCategories: string[] = [];
  CATEGORY_ORDER.forEach(cat => {
    const field = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement;
    if (!field.value.trim()) {
      emptyCategories.push(cat);
    }
  });

  if (emptyCategories.length > 0) {
    const missingNames = emptyCategories.map(cat => ISHIKAWA_CATEGORY_CONFIG[cat].label).join(', ');
    showToast(`Completa todas las categorías: ${missingNames}`, 'warning');
    return;
  }

  CATEGORY_ORDER.forEach(cat => {
    const field = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement;
    const sanitizedValue = sanitizeKeywordEntries(splitTextValues(field.value)).join(', ');
    field.value = sanitizedValue;
    rcaData.ishikawa[cat] = sanitizedValue;
  });
  refreshIshikawaDiagram();

  const machine = (document.getElementById('maquina') as HTMLSelectElement)?.value?.trim() || '';
  const problemText = (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() || '';
  if (machine && problemText) {
    updateIshikawaForMachine(machine, rcaData.ishikawa, problemText);
  }

  syncPlan();
  persist();
}

/** Clears all Ishikawa data */
export function clearIshikawa(syncPlan: () => void, persist: () => void): void {
  CATEGORY_ORDER.forEach(cat => {
    const el = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement;
    if (el) el.value = '';
    rcaData.ishikawa[cat] = '';
  });

  const diagram = document.getElementById('ishikawa-diagram');
  if (diagram) diagram.classList.add('hidden');

  const emptyState: Record<string, boolean> = {};
  CATEGORY_ORDER.forEach(cat => { emptyState[cat] = false; });
  updateIshikawaDiagram(emptyState);
  syncPlan();
  persist();
}
