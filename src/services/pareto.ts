import { rcaData, type RCAIshikawa, CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, type RCAData } from '../state/store';
import { normalizeText } from '../utils/text';

/* ==========================================================================
   Pareto - Accumulated Data per Machine
   Stores root cause frequencies per machine for Pareto analysis
   ========================================================================== */

/** Gets accumulated Pareto history */
export function getParetoHistory(): Record<string, Record<string, number>> {
  try {
    return JSON.parse(localStorage.getItem('paretoHistory') || '{}');
  } catch {
    return {};
  }
}

/** Saves Pareto history */
function saveParetoHistory(data: Record<string, Record<string, number>>): void {
  try {
    localStorage.setItem('paretoHistory', JSON.stringify(data));
  } catch {
    // localStorage may be full or unavailable — silently skip
  }
}

/** Records the current root cause in the machine's accumulated history */
export function recordRootCauseForPareto(getCurrentCauseSummary: () => string): void {
  const machine = (document.getElementById('maquina') as HTMLSelectElement)?.value?.trim() || '';
  if (!machine) return;

  const rootCause = getCurrentCauseSummary();
  if (!rootCause) return;

  const history = getParetoHistory();
  if (!history[machine]) {
    history[machine] = {};
  }

  const normalized = normalizeText(rootCause);
  let found = false;
  for (const key of Object.keys(history[machine])) {
    if (normalizeText(key) === normalized) {
      history[machine][key]++;
      found = true;
      break;
    }
  }

  if (!found) {
    history[machine][rootCause] = 1;
  }

  saveParetoHistory(history);
}

/** Gets accumulated Pareto items for a specific machine */
export function getAccumulatedParetoData(machine: string): { causa: string; frecuencia: number }[] {
  const history = getParetoHistory();
  const machineData = history[machine] || {};
  return Object.entries(machineData).map(([causa, frecuencia]) => ({
    causa,
    frecuencia
  }));
}

/** Gets Pareto data from Ishikawa categories */
export function getIshikawaParetoData(): { causa: string; frecuencia: number }[] {
  return CATEGORY_ORDER.map(key => {
    const value = (document.getElementById(`ishikawa-${key}`) as HTMLTextAreaElement)?.value?.trim() || '';
    if (!value) return null;
    const causes = value.split(/[,.\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    return { causa: ISHIKAWA_CATEGORY_CONFIG[key].label, frecuencia: causes.length };
  }).filter((item): item is { causa: string; frecuencia: number } => item !== null);
}

/** Deepest non-empty 'Por qué' of a record — the same rule the data table's
 *  Causa Raíz column uses, applied to saved data instead of the wizard state. */
export function getRootCauseFromData(whys: unknown): string {
  if (!whys || typeof whys !== 'object') return '';
  const w = whys as Record<string, unknown>;
  if (w.causaRaiz && String(w.causaRaiz).trim()) return String(w.causaRaiz).trim();
  for (let i = 5; i >= 1; i--) {
    const v = w[`why${i}`];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** Builds Pareto items from saved analysis data (data-driven, not from
 *  localStorage history). Optionally filtered to a single machine. Root
 *  causes are counted per analysis regardless of how the record was saved. */
export function buildParetoItems(
  analyses: Array<{ data: RCAData }>,
  machine?: string,
): { causa: string; frecuencia: number }[] {
  const buckets: Array<{ key: string; causa: string; frecuencia: number }> = [];
  analyses.forEach(({ data }) => {
    const m = (data.captura?.maquina || '').trim() || 'Sin máquina';
    if (machine && m !== machine) return;
    const causa = getRootCauseFromData(data.whys);
    if (!causa) return;
    const key = normalizeText(causa);
    const found = buckets.find(b => b.key === key);
    if (found) {
      found.frecuencia++;
    } else {
      buckets.push({ key, causa, frecuencia: 1 });
    }
  });
  return buckets
    .sort((a, b) => b.frecuencia - a.frecuencia)
    .map(({ causa, frecuencia }) => ({ causa, frecuencia }));
}
