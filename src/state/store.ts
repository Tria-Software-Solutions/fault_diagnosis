import { escapeHtml, getTodayISODate, formatDateDDMMYYYY } from '../utils/text';

/* ==========================================================================
   TypeScript Interfaces
   ========================================================================== */

export interface RCACaptura {
  fecha?: string[];
  maquina?: string;
  tiempoParo?: string;
  problema?: string;
  sintomas?: string;
  responsable?: string;
  indicador?: string;
  ordenMantto?: string;
  requisicion?: string;
  codigoProducto?: string;
}

export interface RCAWhys {
  why1: string;
  why2: string;
  why3: string;
  why4: string;
  why5: string;
  wizardLevel: number;
  causaRaiz?: string;
}

export type WhyKey = 'why1' | 'why2' | 'why3' | 'why4' | 'why5';

export function getWhy(whys: RCAWhys, i: number): string {
  const key = `why${i}` as WhyKey;
  return whys[key] || '';
}

export function setWhy(whys: RCAWhys, i: number, value: string): void {
  const key = `why${i}` as WhyKey;
  whys[key] = value;
}

export interface RCAIshikawa {
  maquina?: string;
  metodo?: string;
  materiales?: string;
  manoObra?: string;
  medicion?: string;
  medioAmbiente?: string;
  [key: string]: string | undefined;
}

export interface Accion {
  descripcion: string;
  responsable: string;
  fecha: string;
  prioridad: 'alta' | 'media' | 'baja';
  estado?: 'listo' | 'en_proceso' | 'pendiente';
}

export interface RCAAcciones {
  correctivas: Accion[];
  preventivas: Accion[];
}

export interface RCAData {
  captura: RCACaptura;
  whys: RCAWhys;
  ishikawa: RCAIshikawa;
  acciones: RCAAcciones;
}

export interface AnalysisEntry {
  id: string;
  savedAt: string;
  data: RCAData;
}

export interface IshikawaCategoryConfig {
  label: string;
  icon: string;
}

export interface ParetoItem {
  causa: string;
  frecuencia: number;
}

export interface ExportHistoryEntry {
  fecha: string;
  maquina: string;
  problema: string;
  indicador?: string;
  tipoAccion: string;
  correctivoText: string;
  preventivoText: string;
  status: string;
  responsable: string;
  fechaFin: string;
  causaRaiz: string;
  ishikawa: RCAIshikawa;
}

/* ==========================================================================
   Ishikawa Category Configuration
   ========================================================================== */

export const ISHIKAWA_CATEGORY_CONFIG: Record<string, IshikawaCategoryConfig> = {
  maquina:       { label: 'Máquina',       icon: 'fas fa-cog' },
  metodo:        { label: 'Método',        icon: 'fas fa-clipboard-list' },
  materiales:    { label: 'Materiales',    icon: 'fas fa-box' },
  manoObra:      { label: 'Mano de obra',  icon: 'fas fa-users' },
  medicion:      { label: 'Medición',      icon: 'fas fa-chart-line' },
  medioAmbiente: { label: 'Medio ambiente', icon: 'fas fa-leaf' }
};

export const CATEGORY_ORDER: string[] = Object.keys(ISHIKAWA_CATEGORY_CONFIG);

/* ==========================================================================
   Global Application State
   ========================================================================== */

export let rcaData: RCAData = {
  captura: {},
  whys: { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 },
  ishikawa: {},
  acciones: { correctivas: [], preventivas: [] }
};

/** Replaces rcaData (used during load/init) */
export function setRcaData(data: RCAData): void {
  rcaData = data;
}

/* ── Multiple analyses (saved) ────────────────────────── */

export let savedAnalyses: AnalysisEntry[] = [];
export let selectedAnalysisIndex: number = -1;

export function setSavedAnalyses(entries: AnalysisEntry[]): void {
  savedAnalyses = entries;
  if (selectedAnalysisIndex >= savedAnalyses.length) {
    selectedAnalysisIndex = savedAnalyses.length - 1;
  }
}

export function setSelectedAnalysisIndex(idx: number): void {
  selectedAnalysisIndex = idx;
}

/** Returns the data of the currently selected analysis, or empty RCAData if none */
export function getSelectedAnalysisData(): RCAData {
  if (selectedAnalysisIndex >= 0 && selectedAnalysisIndex < savedAnalyses.length) {
    return savedAnalyses[selectedAnalysisIndex].data;
  }
  return {
    captura: {},
    whys: { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 },
    ishikawa: {},
    acciones: { correctivas: [], preventivas: [] }
  };
}

/* ── Committed (saved) data for the data table ───────── */

// Kept for backward compatibility — synced from selected analysis
export let savedRcaData: RCAData = {
  captura: {},
  whys: { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 },
  ishikawa: {},
  acciones: { correctivas: [], preventivas: [] }
};

export function setSavedRcaData(data: RCAData): void {
  savedRcaData = data;
}

/** Syncs savedRcaData from the currently selected analysis entry */
export function syncSavedRcaDataFromSelected(): void {
  savedRcaData = JSON.parse(JSON.stringify(getSelectedAnalysisData()));
}

/* ==========================================================================
   Persistence in localStorage
   ========================================================================== */

/** Re-index action IDs after deletion */
export function reindexAcciones(tipo: string): void {
  const container = document.getElementById(
    `acciones${tipo.charAt(0).toUpperCase() + tipo.slice(1)}s`
  );
  if (!container) return;

  Array.from(container.children).forEach((card, index) => {
    const descripcion = card.querySelector(`input[id^="accion-${tipo}-"][id$="-desc"]`) as HTMLInputElement | null;
    const responsable = card.querySelector(`input[id^="accion-${tipo}-"][id$="-resp"]`) as HTMLInputElement | null;
    const fecha = card.querySelector(`input[id^="accion-${tipo}-"][id$="-fecha"]`) as HTMLInputElement | null;
    const prioridad = card.querySelector(`select[id^="accion-${tipo}-"][id$="-prio"]`) as HTMLSelectElement | null;
    const estado = card.querySelector(`select[id^="accion-${tipo}-"][id$="-estado"]`) as HTMLSelectElement | null;

    if (descripcion) descripcion.id = `accion-${tipo}-${index}-desc`;
    if (responsable) responsable.id = `accion-${tipo}-${index}-resp`;
    if (fecha) fecha.id = `accion-${tipo}-${index}-fecha`;
    if (prioridad) prioridad.id = `accion-${tipo}-${index}-prio`;
    if (estado) estado.id = `accion-${tipo}-${index}-estado`;
  });
}

/** Gets all actions from the DOM for a type (correctiva/preventiva) */
export function getAccionesFromDOM(tipo: string): Accion[] {
  return Array.from(
    document.querySelectorAll(`#acciones${tipo.charAt(0).toUpperCase() + tipo.slice(1)}s > div`)
  ).map((div, index) => ({
    descripcion: (document.getElementById(`accion-${tipo}-${index}-desc`) as HTMLInputElement)?.value || '',
    responsable: (document.getElementById(`accion-${tipo}-${index}-resp`) as HTMLInputElement)?.value || '',
    fecha: (document.getElementById(`accion-${tipo}-${index}-fecha`) as HTMLInputElement)?.value || '',
    prioridad: ((document.getElementById(`accion-${tipo}-${index}-prio`) as HTMLSelectElement)?.value || 'media') as 'alta' | 'media' | 'baja',
    estado: ((document.getElementById(`accion-${tipo}-${index}-estado`) as HTMLSelectElement)?.value || 'pendiente') as 'listo' | 'en_proceso' | 'pendiente'
  }));
}

/** Saves the current state to localStorage */
export function persistCurrentState(): void {
  reindexAcciones('correctiva');
  reindexAcciones('preventiva');
  rcaData.acciones = {
    correctivas: getAccionesFromDOM('correctiva'),
    preventivas: getAccionesFromDOM('preventiva')
  };
  try {
    localStorage.setItem('rcaData', JSON.stringify(rcaData));
  } catch {
    // localStorage may be full or unavailable — silently skip
  }
}

/* ==========================================================================
   Data Detection & UI State
   ========================================================================== */

/** Checks if any data has been entered in any field */
export function hasData(): boolean {
  const f = rcaData.captura;
  const w = rcaData.whys || {};
  const ish = rcaData.ishikawa || {};

  return !!(
    f.fecha?.length || f.maquina || f.tiempoParo || f.problema || f.sintomas || f.responsable || f.indicador ||
    w.why1 || w.why2 || w.why3 || w.why4 || w.why5 ||
    ish.maquina || ish.metodo || ish.materiales || ish.manoObra || ish.medicion || ish.medioAmbiente ||
    rcaData.acciones.correctivas.length > 0 || rcaData.acciones.preventivas.length > 0
  );
}

/** Checks if the problem capture is complete */
export function hasCapturaData(): boolean {
  return !!(rcaData.captura && rcaData.captura.problema);
}

/* ==========================================================================
   Data Formatting Helpers
   ========================================================================== */

export function formatDate(isoDate: string | string[] | undefined): string {
  if (!isoDate || (Array.isArray(isoDate) && isoDate.length === 0)) return '';
  if (Array.isArray(isoDate)) {
    if (isoDate.length === 1) return formatSingleDate(isoDate[0]);
    if (isoDate.length === 2) return formatDateRange(isoDate[0], isoDate[1]);
    return isoDate.map(d => formatShortDate(d)).join(', ');
  }
  return formatSingleDate(isoDate);
}

export function formatSingleDate(isoDate: string): string {
  return formatDateDDMMYYYY(isoDate);
}

export function formatShortDate(isoDate: string): string {
  return formatDateDDMMYYYY(isoDate);
}

export function formatDateRange(from: string, to: string): string {
  if (!from || !to) return formatSingleDate(from || to);
  const f = formatDateDDMMYYYY(from);
  const t = formatDateDDMMYYYY(to);
  if (f === from || t === to) return `${from} — ${to}`;
  return `${f} — ${t}`;
}

export function serializeDates(dates: string[] | undefined): string {
  return dates?.filter(Boolean).join(', ') || '';
}

export function parseDates(str: string): string[] {
  if (!str?.trim()) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

function formatTiempoParo(minutes: string): string {
  if (!minutes) return '';
  const total = parseInt(minutes, 10);

  if (isNaN(total) || total < 0) return minutes;
  if (total === 0) return '0 min';
  if (total < 60) return `${total} min`;
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  if (mins === 0) {
    return `${hrs}h`;
  }
  return `${hrs}h ${mins}min`;
}

/* ==========================================================================
   Section data for sub-tabs inside the full data table
   ========================================================================== */

export const DATA_SECTIONS = ['captura', 'ishikawa', '5whys', 'plan'] as const;
export type DataSection = (typeof DATA_SECTIONS)[number];


/** Builds a horizontal table for a single section: field names as headers, values in one row */
export function buildSectionRows(section: DataSection, source?: RCAData): string {
  const data = source || rcaData;
  const captura = data.captura || {};
  const whys = data.whys || {};
  const ishikawa = data.ishikawa || {};
  const acciones = data.acciones || { correctivas: [], preventivas: [] };

  let headers: { label: string; key: string; format?: (v: any) => string }[] = [];

  if (section === 'captura') {
    headers = [
      { key: 'maquina', label: 'Máquina' },
      { key: 'problema', label: 'Problema' },
      { key: 'fecha', label: 'Fecha', format: formatDate },
      { key: 'tiempoParo', label: 'Tiempo Paro', format: formatTiempoParo },
      { key: 'indicador', label: 'Indicador' },
      { key: 'sintomas', label: 'Síntomas' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'ordenMantto', label: 'Orden de Mantto' },
      { key: 'requisicion', label: 'Requisición' },
      { key: 'codigoProducto', label: 'Código de Producto' }
    ];
  } else if (section === 'ishikawa') {
    headers = [
      { key: 'maquina', label: 'Máquina' },
      { key: 'metodo', label: 'Método' },
      { key: 'materiales', label: 'Materiales' },
      { key: 'manoObra', label: 'Mano de obra' },
      { key: 'medicion', label: 'Medición' },
      { key: 'medioAmbiente', label: 'Medio Ambiente' }
    ];
  } else if (section === '5whys') {
    for (let i = 1; i <= 5; i++) {
      headers.push({ key: `why${i}`, label: `Por qué ${i}` });
    }
    headers.push({ key: 'causaRaiz', label: 'Causa Raíz' });
  } else if (section === 'plan') {
    return buildHorizontalPlanTable(acciones);
  }

  // Build header row (just field names, no Acciones column)
  const headerRow = `<tr>${headers.map(h => `<th>${escapeHtml(h.label)}</th>`).join('')}</tr>`;
  const dataRow = buildHorizontalDataRow(section, headers, data);

  return `<div class="overflow-x-auto rounded-box border border-base-200"><table class="table table-zebra table-pin-rows w-full">
    <thead>${headerRow}</thead>
    <tbody>${dataRow}</tbody>
  </table></div>`;
}

/** Builds a single horizontal data row for the given section */
function buildHorizontalDataRow(
  section: DataSection,
  headers: { key: string; label: string; format?: (v: any) => string }[],
  source?: RCAData
): string {
  const data = source || rcaData;
  const captura = data.captura || {};
  const whys = data.whys || {};
  const ishikawa = data.ishikawa || {};

  const cells = headers.map(h => {
    let value = '';
    let cellDisplayValue: string | undefined;
    const key = `${section}.${h.key}`;
    if (section === 'captura') {
      const raw = captura[h.key as keyof RCACaptura];
      if (h.key === 'fecha') {
        value = serializeDates(raw as string[] | undefined);
        cellDisplayValue = h.format ? h.format(raw) : value;
      } else {
        value = (raw as string) || '';
        if (h.format) cellDisplayValue = h.format(value);
      }
    } else if (section === 'ishikawa') {
      value = ishikawa[h.key] || '';
    } else if (section === '5whys') {
      if (h.key === 'causaRaiz') {
        // Causa raíz = el último why con contenido
        for (let i = 5; i >= 1; i--) {
          if (whys[`why${i}` as keyof RCAWhys]) {
            value = whys[`why${i}` as keyof RCAWhys] as string;
            break;
          }
        }
      } else {
        value = (whys[h.key as keyof RCAWhys] as string) || '';
      }
    }
    return buildHorizontalCell(key, value, cellDisplayValue);
  });

  return `<tr>${cells.join('')}</tr>`;
}

/** Builds a single cell in the horizontal table (edit button per cell, no delete) */
function buildHorizontalCell(key: string, value: string, displayValue?: string): string {
  const editingKey = _editingKey;
  const isEditing = editingKey === key;
  const display = displayValue !== undefined ? escapeHtml(displayValue) : (value ? escapeHtml(value) : '<span class="val-empty">—</span>');

  let cellContent: string;
  if (isEditing) {
    cellContent = `<div class="inline-edit-h">
      <input type="text" class="inline-input" value="${escapeHtml(value)}">
      <button class="inline-save" onclick="window.__saveEdit('${key}')"><i class="fas fa-check"></i></button>
      <button class="inline-cancel" onclick="window.__cancelEdit()"><i class="fas fa-times"></i></button>
    </div>`;
  } else {
    const editBtn = `<button class="cell-btn cell-btn-inline" onclick="window.__startEdit('${key}')" title="Editar"><i class="fas fa-pen"></i></button>`;
    cellContent = `<span class="cell-h-val">${display}</span><span class="cell-h-actions">${editBtn}</span>`;
  }

  return `<td data-key="${key}" class="cell-h">${cellContent}</td>`;
}

/** Builds a single editable cell for a plan action field */
export function buildPlanHorizontalCell(key: string, value: string, displayValue: string): string {
  const editingKey = _editingKey;
  const isEditing = editingKey === key;
  const displayVal = value ? displayValue : '<span class="val-empty">—</span>';

  let cellContent: string;
  if (isEditing) {
    cellContent = `<div class="inline-edit-h">
      <input type="text" class="inline-input" value="${escapeHtml(value)}">
      <button class="inline-save" onclick="window.__saveEdit('${key}')"><i class="fas fa-check"></i></button>
      <button class="inline-cancel" onclick="window.__cancelEdit()"><i class="fas fa-times"></i></button>
    </div>`;
  } else {
    const editBtn = `<button class="cell-btn cell-btn-inline" onclick="window.__startEdit('${key}')" title="Editar"><i class="fas fa-pen"></i></button>`;
    cellContent = `<span class="cell-h-val">${displayVal}</span><span class="cell-h-actions">${editBtn}</span>`;
  }

  return `<td data-key="${key}" class="cell-h">${cellContent}</td>`;
}

/** Builds the Plan section as a single table consistent with Captura / Ishikawa / 5 Whys */
function buildHorizontalPlanTable(acciones: RCAAcciones): string {
  const prioLabels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const prioColors: Record<string, string> = { alta: '#ef4444', media: '#f59e0b', baja: '#22c55e' };
  const estadoLabels: Record<string, string> = { listo: 'Listo', en_proceso: 'En proceso', pendiente: 'Pendiente' };
  const estadoColors: Record<string, string> = { listo: '#16a34a', en_proceso: '#2563eb', pendiente: '#6b7280' };

  const planHeaders = '<thead><tr><th>Tipo</th><th>Descripción</th><th>Responsable</th><th>Fecha</th><th>Prioridad</th><th>Estado</th></tr></thead>';

  // Combine all actions into a flat list with tipo marker
  const allActions: { tipo: string; label: string; color: string; action: Accion; idx: number }[] = [
    ...acciones.correctivas.map((a, i) => ({ tipo: 'correctivas', label: 'Correctiva', color: '#059669', action: a, idx: i })),
    ...acciones.preventivas.map((a, i) => ({ tipo: 'preventivas', label: 'Preventiva', color: '#2563eb', action: a, idx: i }))
  ];

  if (allActions.length === 0) {
    return `<div class="overflow-x-auto rounded-box border border-base-200">
      <table class="table table-zebra table-pin-rows w-full">
        ${planHeaders}
        <tbody><tr><td colspan="6" class="text-center text-gray-400 italic py-4">Sin acciones registradas</td></tr></tbody>
      </table>
    </div>`;
  }

  const rows = allActions.map(({ tipo, label, color, action, idx }) => {
    const keyPrefix = `plan.${tipo}.${idx}`;
    const tipoCell = `<td class="cell-h"><span style="color:${color};font-weight:600;font-size:12px">${label}</span></td>`;
    const descCell = buildPlanHorizontalCell(`${keyPrefix}.descripcion`, action.descripcion, escapeHtml(action.descripcion || '—'));
    const respCell = buildPlanHorizontalCell(`${keyPrefix}.responsable`, action.responsable, escapeHtml(action.responsable || '—'));
    const fechaCell = buildPlanHorizontalCell(`${keyPrefix}.fecha`, action.fecha, escapeHtml(formatDate(action.fecha) || '—'));
    const prioDisplay = `<span class="plan-prio" style="background:${prioColors[action.prioridad] || '#6b7280'}">${prioLabels[action.prioridad] || action.prioridad}</span>`;
    const prioCell = buildPlanHorizontalCell(`${keyPrefix}.prioridad`, action.prioridad, prioDisplay);
    const estadoDisplay = `<span class="plan-prio" style="background:${estadoColors[action.estado || 'pendiente']}">${estadoLabels[action.estado || 'pendiente']}</span>`;
    const estadoCell = buildPlanHorizontalCell(`${keyPrefix}.estado`, action.estado || '', estadoDisplay);
    return `<tr>${tipoCell}${descCell}${respCell}${fechaCell}${prioCell}${estadoCell}</tr>`;
  }).join('');

  return `<div class="overflow-x-auto rounded-box border border-base-200">
    <table class="table table-zebra table-pin-rows w-full">
      ${planHeaders}
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/* ==========================================================================
   Data Table / Drawer Builders (shared between drawer and full table)
   ========================================================================== */

/** Builds vertical tables (Campo | Valor) for the review drawer — shows only sections with data */
export function buildDataRows(): string {
  const captura = rcaData.captura || {};
  const whys = rcaData.whys || {};
  const ishikawa = rcaData.ishikawa || {};
  const acciones = rcaData.acciones || { correctivas: [], preventivas: [] };

  const hasCapturaData = !!(captura.maquina || captura.problema || captura.fecha?.length || captura.tiempoParo || captura.indicador || captura.sintomas || captura.responsable || captura.ordenMantto || captura.requisicion || captura.codigoProducto);
  const hasIshikawaData = !!(ishikawa.maquina || ishikawa.metodo || ishikawa.materiales || ishikawa.manoObra || ishikawa.medicion || ishikawa.medioAmbiente);
  const hasWhysData = !!(whys.why1 || whys.why2 || whys.why3 || whys.why4 || whys.why5);
  const hasPlanData = !!(acciones.correctivas.length > 0 || acciones.preventivas.length > 0);

  const tables: string[] = [];

  // --- Captura (solo si tiene datos) ---
  if (hasCapturaData) {
    const capturaFields = [
      { key: 'maquina', label: 'Máquina' },
      { key: 'problema', label: 'Problema' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'tiempoParo', label: 'Tiempo Paro' },
      { key: 'indicador', label: 'Indicador' },
      { key: 'sintomas', label: 'Síntomas' },
      { key: 'responsable', label: 'Responsable' },
      { key: 'ordenMantto', label: 'Orden de Mantto' },
      { key: 'requisicion', label: 'Requisición' },
      { key: 'codigoProducto', label: 'Código de Producto' }
    ];
    tables.push(buildDrawerVerticalSectionTable('Captura', 'fa-clipboard text-blue-600', capturaFields.map(f => {
      const raw = captura[f.key as keyof RCACaptura];
      let value = Array.isArray(raw) ? raw.join(', ') : (raw || '');
      if (f.key === 'fecha') value = formatDate(raw);
      if (f.key === 'tiempoParo') value = formatTiempoParo(value);
      return { key: `captura.${f.key}`, label: f.label, value };
    })));
  }

  // --- Ishikawa (solo si tiene datos) ---
  if (hasIshikawaData) {
    const ishikawaCats = [
      { key: 'maquina', label: 'Máquina' },
      { key: 'metodo', label: 'Método' },
      { key: 'materiales', label: 'Materiales' },
      { key: 'manoObra', label: 'Mano de obra' },
      { key: 'medicion', label: 'Medición' },
      { key: 'medioAmbiente', label: 'Medio Ambiente' }
    ];
    tables.push(buildDrawerVerticalSectionTable('Ishikawa', 'fa-project-diagram text-emerald-600', ishikawaCats.map(c => ({
      key: `ishikawa.${c.key}`,
      label: c.label,
      value: ishikawa[c.key] || ''
    }))));
  }

  // --- 5 Porqués (solo si tiene datos) ---
  if (hasWhysData) {
    const whysItems: { key: string; label: string; value: string }[] = [];
    for (let i = 1; i <= 5; i++) {
      const val = (whys[`why${i}` as keyof RCAWhys] as string) || '';
      whysItems.push({ key: `whys.why${i}`, label: `Por qué ${i}`, value: val });
    }
    const causaRaiz = getCurrentCauseSummary();
    whysItems.push({ key: 'whys.causaRaiz', label: 'Causa Raíz', value: causaRaiz });
    tables.push(buildDrawerVerticalSectionTable('5 Porqués', 'fa-question-circle text-amber-500', whysItems));
  }

  // --- Plan de Acción (solo si tiene datos) ---
  if (hasPlanData) {
    tables.push(buildDrawerPlanSection(acciones));
  }

  return tables.join('');
}

/** Builds a vertical (Campo | Valor) table for a drawer section — daisyUI modern */
function buildDrawerVerticalSectionTable(
  title: string,
  icon: string,
  items: { key: string; label: string; value: string }[],
): string {
  const rows = items.map(item => {
    const displayVal = item.value ? escapeHtml(item.value) : '<span class="text-gray-300 italic">—</span>';
    return `<tr>
      <th class="text-xs font-semibold text-gray-500 w-[30%] !bg-transparent">${escapeHtml(item.label)}</th>
      <td class="text-sm text-gray-700 !bg-transparent">${displayVal}</td>
    </tr>`;
  }).join('');

  return `<div class="card bg-base-100/80 border border-base-200 shadow-sm mb-3">
    <div class="card-body p-4">
      <h4 class="card-title text-sm font-bold flex items-center gap-2 text-base-content">
        <i class="fas ${icon}"></i> ${escapeHtml(title)}
      </h4>
      <div class="overflow-x-auto">
        <table class="table table-sm w-full">
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

/** Builds the Plan drawer section with full action details — daisyUI modern */
function buildDrawerPlanSection(acciones: RCAAcciones): string {
  const prioLabels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const prioBadge: Record<string, string> = { alta: 'badge-error', media: 'badge-warning', baja: 'badge-success' };
  const estadoLabels: Record<string, string> = { listo: 'Listo', en_proceso: 'En proceso', pendiente: 'Pendiente' };
  const estadoBadge: Record<string, string> = { listo: 'badge-success', en_proceso: 'badge-info', pendiente: 'badge-ghost' };

  const buildActionTable = (list: Accion[], icon: string, label: string, color: string): string => {
    if (list.length === 0) {
      return `<div class="mb-3 last:mb-0">
        <h5 class="text-xs font-bold flex items-center gap-1.5 mb-2" style="color:${color}"><i class="fas ${icon}"></i> ${label}</h5>
        <p class="text-xs text-gray-400 italic">Sin acciones</p>
      </div>`;
    }

    const rows = list.map(a => `
      <tr>
        <td class="text-sm font-medium text-gray-700 !bg-transparent w-1/2">${escapeHtml(a.descripcion || '—')}</td>
        <td class="!bg-transparent">
          <div class="flex flex-wrap gap-2 items-center text-xs text-gray-500">
            <span class="inline-flex items-center gap-1"><i class="fas fa-user text-gray-400"></i> ${escapeHtml(a.responsable || '—')}</span>
            <span class="inline-flex items-center gap-1"><i class="fas fa-calendar text-gray-400"></i> ${escapeHtml(formatDate(a.fecha) || '—')}</span>
            <span class="badge badge-sm ${prioBadge[a.prioridad] || 'badge-ghost'}">${prioLabels[a.prioridad] || a.prioridad}</span>
            <span class="badge badge-sm ${estadoBadge[a.estado || 'pendiente']}">${estadoLabels[a.estado || 'pendiente']}</span>
          </div>
        </td>
      </tr>`).join('');

    return `<div class="mb-3 last:mb-0">
      <h5 class="text-xs font-bold flex items-center gap-1.5 mb-2" style="color:${color}"><i class="fas ${icon}"></i> ${label} (${list.length})</h5>
      <div class="overflow-x-auto">
        <table class="table table-sm w-full">
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
  };

  const correctivas = buildActionTable(acciones.correctivas, 'fa-check-circle', 'Correctivas', '#059669');
  const preventivas = buildActionTable(acciones.preventivas, 'fa-shield-alt', 'Preventivas', '#2563eb');

  return `<div class="card bg-base-100/80 border border-base-200 shadow-sm mb-3">
    <div class="card-body p-4">
      <h4 class="card-title text-sm font-bold flex items-center gap-2 text-base-content">
        <i class="fas fa-tasks text-red-500"></i> Plan de Acción
      </h4>
      ${correctivas}
      ${preventivas}
    </div>
  </div>`;
}

let _editingKey: string | null = null;
export function getEditingKey(): string | null { return _editingKey; }
export function setEditingKey(val: string | null): void { _editingKey = val; }

/** Removes a single action from rcaData by tipo and index (persists, no DOM) */
export function removeActionFromState(tipo: string, index: number): void {
  const acciones = rcaData.acciones || { correctivas: [], preventivas: [] };
  const list = tipo === 'correctivas' ? acciones.correctivas : acciones.preventivas;
  if (index >= 0 && index < list.length) {
    list.splice(index, 1);
    rcaData.acciones[tipo === 'correctivas' ? 'correctivas' : 'preventivas'] = list;
  }
}

/* ==========================================================================
   Shared Logic: 5 Whys Cause Summary
   ========================================================================== */

/** Gets the deepest level with content */
export function getLastWhyLevel(): number {
  const whys = rcaData.whys || {};
  for (let i = 5; i >= 1; i--) {
    if (whys[`why${i}` as keyof RCAWhys]) return i;
  }
  return 0;
}

/** Determines if the wizard is completed */
export function isWizardCompleted(): boolean {
  return !!(rcaData.whys && rcaData.whys.wizardLevel === 0);
}

/** Gets the current wizard level (1-5 active, 0 completed) */
export function getWizardLevel(): number {
  if (isWizardCompleted()) return 0;
  return (rcaData.whys && rcaData.whys.wizardLevel) || 1;
}

/** Gets the root cause: deepest why with content */
export function getCurrentCauseSummary(): string {
  const whys = rcaData.whys || {};
  if (isWizardCompleted()) {
    return getWhy(whys, getLastWhyLevel());
  }
  const level = getWizardLevel();
  for (let i = level; i >= 1; i--) {
    const v = getWhy(whys, i);
    if (v) return v;
  }
  return '';
}

/** Gets all 5 why texts from state */
export function getWhyTexts(): string[] {
  const whys = rcaData.whys || {};
  const values: string[] = [];
  for (let i = 1; i <= 5; i++) {
    values.push(getWhy(whys, i));
  }
  return values;
}
