import { buildSectionRows, buildPlanHorizontalCell as buildPlanCell, setEditingKey, getEditingKey, rcaData, savedRcaData, savedAnalyses, selectedAnalysisIndex, setSavedRcaData, setSavedAnalyses, setSelectedAnalysisIndex, syncSavedRcaDataFromSelected, removeActionFromState, persistCurrentState, DATA_SECTIONS, serializeDates, parseDates, formatDate, ISHIKAWA_CATEGORY_CONFIG, type DataSection } from '../state/store';
import { escapeHtml, formatDateDDMMYYYY } from '../utils/text';
import { confirmAction } from '../utils/confirm';
import { showToast } from '../utils/toast';
import { generateIshikawaPreview } from './ishikawa';
import { exportSingleRowPDF, exportAllPDF, formatFechas } from '../services/exportPDF';
import { exportSingleRowExcel, exportAllExcel, exportFilteredExcel } from '../services/exportExcel';
import { closeReviewDrawer, renderDrawerTable } from './drawer';
import { addAccionToDOM } from './plan';
import { updateEntryById, deleteAnalysisById, loadAnalysis } from '../services/analysisStorage';

/* ==========================================================================
   Full Data Table View Component — Section Tabs
   ========================================================================== */

let previousTab: string | null = null;
let currentDataTab: DataSection = 'captura';

// Filter state for Mes-Año + Máquina
let filterMonth = '';
let filterMachine = '';

// Pagination state
let currentPage = 1;
const PAGE_SIZE = 10;

/** Returns entries filtered by the current Mes-Año + Máquina filters */
function getFilteredEntries(): import('../state/store').AnalysisEntry[] {
  return savedAnalyses.filter(entry => {
    const fechaAnalisis = entry.data.captura?.fecha?.[0] || '';
    if (filterMonth && fechaAnalisis.substring(0, 7) !== filterMonth) return false;
    if (filterMachine && entry.data.captura?.maquina?.trim() !== filterMachine) return false;
    return true;
  });
}

/** Total number of pages for a given amount of entries */
function getTotalPages(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

/** Builds the pagination controls (prev / page numbers / next) */
function buildPaginationHtml(total: number, start: number, end: number): string {
  const maxPage = getTotalPages(total);
  const pageBtn = (p: number, label?: string) =>
    `<button class="page-btn ${p === currentPage ? 'is-active' : ''}" onclick="window.__goToPage(${p})">${label ?? p}</button>`;
  let pageBtns = '';
  if (maxPage <= 7) {
    for (let p = 1; p <= maxPage; p++) pageBtns += pageBtn(p);
  } else {
    pageBtns += pageBtn(1);
    const from = Math.max(2, currentPage - 1);
    const to = Math.min(maxPage - 1, currentPage + 1);
    if (from > 2) pageBtns += '<span class="page-ellipsis">…</span>';
    for (let p = from; p <= to; p++) pageBtns += pageBtn(p);
    if (to < maxPage - 1) pageBtns += '<span class="page-ellipsis">…</span>';
    pageBtns += pageBtn(maxPage);
  }
  const prevDisabled = currentPage <= 1 ? 'disabled' : '';
  const nextDisabled = currentPage >= maxPage ? 'disabled' : '';
  return `<div class="data-table-pagination">
    <span class="data-table-pagination-info"><i class="fas fa-list-alt"></i> Mostrando ${start}–${end} de ${total} registro${total === 1 ? '' : 's'}</span>
    <div class="pagination-nav">
      <button class="page-btn" ${prevDisabled} onclick="window.__goToPage(${currentPage - 1})" title="Anterior"><i class="fas fa-chevron-left"></i></button>
      ${pageBtns}
      <button class="page-btn" ${nextDisabled} onclick="window.__goToPage(${currentPage + 1})" title="Siguiente"><i class="fas fa-chevron-right"></i></button>
    </div>
  </div>`;
}

/** Goes to a specific page and re-renders the table */
window.__goToPage = function(page: number): void {
  const maxPage = getTotalPages(getFilteredEntries().length);
  currentPage = Math.min(Math.max(1, page), maxPage);
  renderDataTable();
};

/** Opens or closes the data table view */
export function toggleTableView(): void {
  const tabla = document.getElementById('content-tabla');
  if (tabla && !tabla.classList.contains('hidden')) {
    closeTableView();
  } else {
    openTableView();
  }
}

/** Opens the full data table view */
export function openTableView(): void {
  closeReviewDrawer();
  document.querySelectorAll('[id^="content-"]').forEach(el => {
    if (!el.classList.contains('hidden') && el.id !== 'content-tabla') {
      previousTab = el.id.replace('content-', '');
    }
  });
  document.querySelectorAll('[id^="content-"]').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.remove('tab-active'));
  const tabla = document.getElementById('content-tabla');
  if (tabla) tabla.classList.remove('hidden');
  currentDataTab = 'captura';
  renderDataTable();
  updateSubtabUI();
  updateSubtabDisabled();
  const fab = document.getElementById('fab');
  if (fab) fab.classList.add('hidden');
  // Hide stepper, show simplified nav in footer
  const stepper = document.querySelector('.stepper-wrap') as HTMLElement | null;
  const wizardView = document.getElementById('step-nav-wizard-view') as HTMLElement | null;
  const tableView = document.getElementById('step-nav-table-view') as HTMLElement | null;
  if (stepper) stepper.style.display = 'none';
  if (wizardView) wizardView.classList.add('hidden');
  if (tableView) tableView.classList.remove('hidden');
}

/** Closes the data table view and returns to previous tab */
export function closeTableView(): void {
  const tabla = document.getElementById('content-tabla');
  if (tabla) tabla.classList.add('hidden');
  // Restore stepper and wizard nav
  const stepper = document.querySelector('.stepper-wrap') as HTMLElement | null;
  const wizardView = document.getElementById('step-nav-wizard-view') as HTMLElement | null;
  const tableView = document.getElementById('step-nav-table-view') as HTMLElement | null;
  if (stepper) stepper.style.display = '';
  if (wizardView) wizardView.classList.remove('hidden');
  if (tableView) tableView.classList.add('hidden');
  if (previousTab && previousTab !== 'tabla') {
    window.__showTab(previousTab);
  } else {
    window.__showTab('captura');
  }
}

/** Switch sub-tab within the data table */
export function switchDataTab(section: DataSection): void {
  if (savedAnalyses.length === 0) return; // No data, can't switch
  currentDataTab = section;
  currentPage = 1;
  renderDataTable();
  updateSubtabUI();
}

/** Updates the sub-tab button active states (daisyUI tabs-box) */
function updateSubtabUI(): void {
  document.querySelectorAll('[role="tablist"] .tab').forEach(btn => {
    const section = btn.getAttribute('data-section');
    btn.classList.toggle('tab-active', section === currentDataTab);
  });
}

/** Disables or enables sub-tab buttons based on whether saved data exists */
function updateSubtabDisabled(): void {
  const hasData = savedAnalyses.length > 0;
  document.querySelectorAll('[role="tablist"] .tab').forEach(btn => {
    btn.classList.toggle('tab-disabled', !hasData);
    btn.classList.toggle('pointer-events-none', !hasData);
    btn.classList.toggle('opacity-40', !hasData);
  });
}

/** Gets the display value for a cell from an analysis entry */
function getEntryDisplayValue(entry: import('../state/store').AnalysisEntry, section: string, key: string): string {
  const data = entry.data;
  const captura = data.captura || {};
  const whys = data.whys || {};
  const ishikawa = data.ishikawa || {};

  if (section === 'captura') {
    const raw = captura[key as keyof import('../state/store').RCACaptura];
    if (key === 'fecha') return formatFechas(raw);
    if (key === 'tiempoParo') {
      const mins = (raw as string) || '';
      if (!mins) return '';
      const total = parseInt(mins, 10);
      if (isNaN(total) || total < 0) return mins;
      if (total === 0) return '0 min';
      if (total < 60) return `${total} min`;
      const hrs = Math.floor(total / 60);
      const m = total % 60;
      return m === 0 ? `${hrs}h` : `${hrs}h ${m}min`;
    }
    return (raw as string) || '';
  } else if (section === 'ishikawa') {
    return ishikawa[key] || '';
  } else if (section === '5whys') {
    if (key === 'causaRaiz') {
      for (let i = 5; i >= 1; i--) {
        if (whys[`why${i}` as keyof import('../state/store').RCAWhys]) {
          return whys[`why${i}` as keyof import('../state/store').RCAWhys] as string;
        }
      }
      return '';
    }
    return (whys[key as keyof import('../state/store').RCAWhys] as string) || '';
  }
  return '';
}

/** Defines headers for each data section */
function getSectionHeaders(section: DataSection): { label: string; key: string }[] {
  if (section === 'captura') {
    return [
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
  } else if (section === 'ishikawa') {
    return [
      { key: 'maquina', label: 'Máquina' },
      { key: 'metodo', label: 'Método' },
      { key: 'materiales', label: 'Materiales' },
      { key: 'manoObra', label: 'Mano de obra' },
      { key: 'medicion', label: 'Medición' },
      { key: 'medioAmbiente', label: 'Medio Ambiente' }
    ];
  } else if (section === '5whys') {
    const hdrs: { label: string; key: string }[] = [];
    for (let i = 1; i <= 5; i++) hdrs.push({ key: `why${i}`, label: `Por qué ${i}` });
    hdrs.push({ key: 'causaRaiz', label: 'Causa Raíz' });
    return hdrs;
  }
  return [];
}

/** Renders the filter bar (Mes-Año + Máquina) and a selectable list of analyses */
function renderAnalysisFilters(): void {
  const container = document.getElementById('analysis-filters');
  if (!container) return;

  const entries = savedAnalyses;
  if (entries.length === 0) {
    container.innerHTML = '';
    return;
  }

  // Extract unique months and machines
  const months = new Set<string>();
  const machines = new Set<string>();
  entries.forEach(entry => {
    const fechaAnalisis = entry.data.captura?.fecha?.[0];
    if (fechaAnalisis) {
      const m = fechaAnalisis.substring(0, 7);
      months.add(m);
    }
    const mq = entry.data.captura?.maquina?.trim();
    if (mq) machines.add(mq);
  });

  const sortedMonths = Array.from(months).sort().reverse();
  const sortedMachines = Array.from(machines).sort();

  // Filter entries based on current filter state
  const filtered = entries.filter(entry => {
    const fechaAnalisis = entry.data.captura?.fecha?.[0] || '';
    if (filterMonth && fechaAnalisis.substring(0, 7) !== filterMonth) return false;
    if (filterMachine && entry.data.captura?.maquina?.trim() !== filterMachine) return false;
    return true;
  });

  // Month name helper
  const monthName = (ym: string): string => {
    const [y, m] = ym.split('-');
    const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };

  const monthOpts = `<option value="">Todos los meses</option>` +
    sortedMonths.map(m => `<option value="${m}" ${m === filterMonth ? 'selected' : ''}>${escapeHtml(monthName(m))}</option>`).join('');

  const machineOpts = `<option value="">Todas las máquinas</option>` +
    sortedMachines.map(m => `<option value="${escapeHtml(m)}" ${m === filterMachine ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');

  container.innerHTML = `<div class="analysis-filters-bar">
    <div class="filter-group">
      <label class="filter-label"><i class="fas fa-calendar-alt"></i> Mes-Año</label>
      <select class="select select-bordered select-sm" onchange="window.__setFilterMonth(this.value)">
        ${monthOpts}
      </select>
    </div>
    <div class="filter-group">
      <label class="filter-label"><i class="fas fa-industry"></i> Máquina</label>
      <select class="select select-bordered select-sm" onchange="window.__setFilterMachine(this.value)">
        ${machineOpts}
      </select>
    </div>
    <div class="filter-count">
      <span class="badge badge-ghost badge-sm">${filtered.length} de ${entries.length}</span>
    </div>
  </div>`;

  // No selected analysis bar — all entries show as rows in the table
}

/** Re-evaluates filter and refreshes the table */
function applyFilterAndSync(): void {
  renderDataTable();
}

/** Sets the month filter and refreshes the list */
window.__setFilterMonth = function(val: string): void {
  filterMonth = val;
  currentPage = 1;
  renderAnalysisFilters();
  applyFilterAndSync();
};

/** Sets the machine filter and refreshes the list */
window.__setFilterMachine = function(val: string): void {
  filterMachine = val;
  currentPage = 1;
  renderAnalysisFilters();
  applyFilterAndSync();
};

/** Renders ALL filtered analyses as rows in a single table */
export function renderDataTable(): void {
  const container = document.getElementById('data-table-body');
  if (!container) return;

  renderAnalysisFilters();
  updateSubtabDisabled();

  if (savedAnalyses.length === 0) {
    container.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-center py-8 text-gray-400">
      <i class="fas fa-database text-3xl mb-3"></i>
      <p>No hay análisis guardados.</p>
      <p class="text-xs">Completa el wizard y guarda para ver los datos aquí.</p>
    </div>`;
    return;
  }

  // Filter + paginate entries
  const filtered = getFilteredEntries();
  const maxPage = getTotalPages(filtered.length);
  if (currentPage > maxPage) currentPage = maxPage;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageEntries = filtered.slice(start, start + PAGE_SIZE);

  // Pagination controls (only when there are results)
  let paginationHtml = '';
  if (filtered.length > 0) {
    paginationHtml = buildPaginationHtml(filtered.length, start + 1, start + pageEntries.length);
  }

// For Plan section, show a single flat table: one row per action across
  // all filtered entries (same distribution as the other tabs)
  if (currentDataTab === 'plan') {
    const prioLabels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
    const prioColors: Record<string, string> = { alta: '#ef4444', media: '#f59e0b', baja: '#22c55e' };
    const estadoLabels: Record<string, string> = { listo: 'Listo', en_proceso: 'En proceso', pendiente: 'Pendiente' };
    const estadoColors: Record<string, string> = { listo: '#16a34a', en_proceso: '#2563eb', pendiente: '#6b7280' };

    const planRows = pageEntries.flatMap((entry, idx) => {
      const num = start + idx + 1;
      const maquina = entry.data.captura?.maquina || 'Sin máquina';
      const acciones = entry.data.acciones || { correctivas: [], preventivas: [] };
      const list: { tipo: string; label: string; color: string; action: import('../state/store').Accion; idx: number }[] = [
        ...acciones.correctivas.map((a, i) => ({ tipo: 'correctivas', label: 'Correctiva', color: '#059669', action: a, idx: i })),
        ...acciones.preventivas.map((a, i) => ({ tipo: 'preventivas', label: 'Preventiva', color: '#2563eb', action: a, idx: i }))
      ];

      const entryActions = `<td class="text-center">
        <div class="flex items-center justify-center gap-1">
          <button class="btn btn-ghost btn-xs btn-square" onclick="window.__editEntryById('${entry.id}')" title="Editar"><i class="fas fa-pen text-blue-500"></i></button>
          <button class="btn btn-ghost btn-xs btn-square text-red-500" onclick="window.__deleteEntryById('${entry.id}')" title="Eliminar"><i class="fas fa-trash-alt"></i></button>
        </div>
      </td>`;
      const exportCells = `<td class="text-center">
        <div class="flex items-center justify-center gap-1">
          <button class="btn btn-ghost btn-xs btn-square" onclick="window.__exportSinglePDF('${entry.id}')" title="PDF"><i class="fas fa-file-pdf text-red-500"></i></button>
          <button class="btn btn-ghost btn-xs btn-square" onclick="window.__exportSingleExcel('${entry.id}')" title="Excel"><i class="fas fa-file-excel text-green-600"></i></button>
        </div>
      </td>`;

      if (list.length === 0) {
        return [`<tr>
          <td class="text-center text-xs font-mono text-base-content/40">${num}</td>
          <td class="text-sm">${escapeHtml(maquina)}</td>
          <td colspan="5" class="text-center text-base-content/30 italic py-3">Sin acciones registradas</td>
          ${entryActions}${exportCells}
        </tr>`];
      }

      return list.map(({ tipo, label, color, action, idx: actionIdx }) => {
        const keyPrefix = `plan.${tipo}.${actionIdx}`;
        const tipoCell = `<td class="text-sm"><span style="color:${color};font-weight:600;font-size:12px">${label}</span></td>`;
        const prioDisplay = `<span class="plan-prio" style="background:${prioColors[action.prioridad] || '#6b7280'}">${prioLabels[action.prioridad] || action.prioridad}</span>`;
        const estadoDisplay = `<span class="plan-prio" style="background:${estadoColors[action.estado || 'pendiente']}">${estadoLabels[action.estado || 'pendiente']}</span>`;
        return `<tr>
          <td class="text-center text-xs font-mono text-base-content/40">${num}</td>
          <td class="text-sm font-medium">${escapeHtml(maquina)}</td>
          ${tipoCell}
          ${buildPlanCell(`${keyPrefix}.descripcion`, action.descripcion, escapeHtml(action.descripcion || '—'))}
          ${buildPlanCell(`${keyPrefix}.responsable`, action.responsable, escapeHtml(action.responsable || '—'))}
          ${buildPlanCell(`${keyPrefix}.fecha`, action.fecha, escapeHtml(formatFechas(action.fecha) || '—'))}
          ${buildPlanCell(`${keyPrefix}.prioridad`, action.prioridad || '', prioDisplay)}
          ${buildPlanCell(`${keyPrefix}.estado`, action.estado || '', estadoDisplay)}
          ${entryActions}${exportCells}
        </tr>`;
      });
    }).join('');

    container.innerHTML = `<div class="data-table-scroll overflow-x-auto rounded-box border border-base-200">
      <table class="table table-zebra table-pin-rows w-full min-w-max">
        <thead><tr>
          <th class="w-10 text-center">#</th>
          <th>Máquina</th>
          <th>Tipo</th>
          <th>Descripción</th>
          <th>Responsable</th>
          <th>Fecha</th>
          <th>Prioridad</th>
          <th>Estado</th>
          <th class="w-28 text-center">Acciones</th>
          <th class="w-24 text-center">Exportar</th>
        </tr></thead>
        <tbody>${planRows || '<tr><td colspan="10" class="text-center py-6 text-base-content/40">Sin resultados con los filtros actuales</td></tr>'}</tbody>
      </table>
    </div>` + paginationHtml;
    return;
  }

  // Get headers for current section
  const headers = getSectionHeaders(currentDataTab);

  // Build header row with # + fields + Diagrama (ishikawa only) + Acciones
  let extraHeaderCells = '';
  if (currentDataTab === 'ishikawa') {
    extraHeaderCells = `<th class="w-20 text-center">Diagrama</th>`;
  }
  const headerCells = `<th class="w-10 text-center">#</th>` +
    headers.map(h => `<th>${escapeHtml(h.label)}</th>`).join('') +
    extraHeaderCells +
    `<th class="w-28 text-center">Acciones</th>` +
    `<th class="w-24 text-center">Exportar</th>`;

  // Build data rows (only for current page)
  const rows = pageEntries.map((entry, idx) => {
    const cells = headers.map(h => {
      const display = getEntryDisplayValue(entry, currentDataTab, h.key);
      return `<td class="text-sm">${display ? escapeHtml(display) : '<span class="text-base-content/30">—</span>'}</td>`;
    }).join('');

    // Build diagram column cell (ishikawa only)
    let diagramCell = '';
    if (currentDataTab === 'ishikawa') {
      const hasIshikawa = Object.values(entry.data.ishikawa || {}).some(v => v);
      if (hasIshikawa) {
        diagramCell = `<td class="text-center">
          <button class="btn btn-ghost btn-xs btn-square" onclick="window.__viewIshikawaDiagram('${entry.id}')" title="Ver diagrama">
            <i class="fas fa-project-diagram text-indigo-500"></i>
          </button>
        </td>`;
      } else {
        diagramCell = `<td class="text-center text-base-content/20"><i class="fas fa-minus"></i></td>`;
      }
    }

    // Build action buttons (edit + delete)
    let actionBtns = `<button class="btn btn-ghost btn-xs btn-square" onclick="window.__editEntryById('${entry.id}')" title="Editar"><i class="fas fa-pen text-blue-500"></i></button>
        <button class="btn btn-ghost btn-xs btn-square text-red-500" onclick="window.__deleteEntryById('${entry.id}')" title="Eliminar"><i class="fas fa-trash-alt"></i></button>`;

    // Build export buttons (PDF + Excel)
    const exportBtns = `<button class="btn btn-ghost btn-xs btn-square" onclick="window.__exportSinglePDF('${entry.id}')" title="PDF"><i class="fas fa-file-pdf text-red-500"></i></button>
        <button class="btn btn-ghost btn-xs btn-square" onclick="window.__exportSingleExcel('${entry.id}')" title="Excel"><i class="fas fa-file-excel text-green-600"></i></button>`;

    const actions = `<td class="text-center">
      <div class="flex items-center justify-center gap-1">
        ${actionBtns}
      </div>
    </td>
    <td class="text-center">
      <div class="flex items-center justify-center gap-1">
        ${exportBtns}
      </div>
    </td>`;

    return `<tr>
      <td class="text-center text-xs font-mono text-base-content/40">${start + idx + 1}</td>
      ${cells}
      ${diagramCell}
      ${actions}
    </tr>`;
  }).join('');

  let html = `<div class="data-table-scroll overflow-x-auto rounded-box border border-base-200">
    <table class="table table-zebra table-pin-rows w-full min-w-max">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows || '<tr><td colspan="10" class="text-center py-6 text-base-content/40">Sin resultados con los filtros actuales</td></tr>'}</tbody>
    </table>
  </div>`;

  container.innerHTML = html + paginationHtml;
}

/** Deletes an analysis entry by its ID */
window.__deleteEntryById = async function(entryId: string): Promise<void> {
  const confirmed = await confirmAction('¿Eliminar este análisis permanentemente?');
  if (!confirmed) return;

  await deleteAnalysisById(entryId);

  // Refresh from the server
  const entries = await loadAnalysis();
  setSavedAnalyses(entries);

  if (entries.length > 0 && selectedAnalysisIndex >= entries.length) {
    setSelectedAnalysisIndex(entries.length - 1);
  } else if (entries.length === 0) {
    setSelectedAnalysisIndex(-1);
  }
  syncSavedRcaDataFromSelected();
  renderDataTable();
  showToast('Análisis eliminado.', 'success');
};

/** Exports a single analysis entry as PDF */
window.__exportSinglePDF = async function(entryId: string): Promise<void> {
  const entry = savedAnalyses.find(e => e.id === entryId);
  if (!entry) return;
  await exportAllPDF([entry], false);
};

/** Exports a single analysis entry as Excel */
window.__exportSingleExcel = async function(entryId: string): Promise<void> {
  const entry = savedAnalyses.find(e => e.id === entryId);
  if (!entry) return;
  await exportAllExcel([entry], false);
};

/* ==========================================================================
   Excel Export (Todos los Datos)
   Exports the filtered records with the same tabs as the individual export:
   Información (flat, one row per record) + Pareto. The Ishikawa diagram
   lives in the PDF, so it's skipped here.
   ========================================================================== */

/** Exports the filtered analyses (respecting Mes-Año/Máquina) as Excel */
export async function exportFilteredTableExcel(): Promise<void> {
  const filtered = getFilteredEntries();
  if (filtered.length === 0) {
    showToast('No hay registros con los filtros actuales.', 'warning');
    return;
  }

  // Build the applied-filter label for the Excel title
  const filterParts: string[] = [];
  if (filterMonth) {
    const [y, m] = filterMonth.split('-');
    const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    filterParts.push(`${names[parseInt(m, 10) - 1]} ${y}`);
  }
  if (filterMachine) filterParts.push(`Máquina: ${filterMachine}`);
  const filterLabel = filterParts.join(' • ');

  await exportFilteredExcel(filtered, filterLabel);
}

/** Opens a full-screen modal showing the Ishikawa diagram for a specific entry */
window.__viewIshikawaDiagram = function(entryId: string): void {
  const entry = savedAnalyses.find(e => e.id === entryId);
  if (!entry) return;

  const ishikawa = entry.data.ishikawa || {};
  const problema = entry.data.captura?.problema || '';

  const hasData = Object.values(ishikawa).some(v => v && String(v).trim());
  if (!hasData) {
    showToast('No hay datos de Ishikawa para este análisis.', 'warning');
    return;
  }

  const preview = generateIshikawaPreview(ishikawa, problema);
  if (preview.isEmpty) {
    showToast('No hay datos de Ishikawa para este análisis.', 'warning');
    return;
  }

  const maquina = entry.data.captura?.maquina || 'Sin máquina';
  const fecha = formatFechas(entry.data.captura?.fecha);

  // Create or reuse modal element
  let modal = document.getElementById('ishikawa-viewer-modal');
  if (modal) {
    modal.remove();
  }

  modal = document.createElement('div');
  modal.id = 'ishikawa-viewer-modal';
  modal.className = 'ish-viewer-overlay';
  modal.innerHTML = `<div class="ish-viewer-container">
    <div class="ish-viewer-header">
      <div class="ish-viewer-title">
        <i class="fas fa-project-diagram text-indigo-500"></i>
        <span>Diagrama de Ishikawa</span>
        <span class="ish-viewer-meta">${escapeHtml(maquina)} • ${escapeHtml(fecha)}</span>
      </div>
      <button class="ish-viewer-close" onclick="window.__closeIshikawaViewer()" aria-label="Cerrar">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="ish-viewer-body">
      <div class="ish-viewer-svg-wrap">
        <img src="${preview.imgData}" alt="Diagrama de Ishikawa" class="ish-viewer-svg" style="width:100%;height:auto;max-width:1600px">
      </div>
    </div>
  </div>`;

  document.body.appendChild(modal);

  // Animate in
  requestAnimationFrame(() => {
    modal.classList.add('open');
  });

  // Close on overlay click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      window.__closeIshikawaViewer();
    }
  });

  // Close on Escape
  const escHandler = function(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      window.__closeIshikawaViewer();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
};

/** Closes the Ishikawa diagram viewer modal */
window.__closeIshikawaViewer = function(): void {
  const modal = document.getElementById('ishikawa-viewer-modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => modal.remove(), 300);
  }
};

/** Needed by the analysis filters and diagram viewer */
declare global {
  interface Window {
    __setFilterMonth: (val: string) => void;
    __setFilterMachine: (val: string) => void;
    __goToPage: (page: number) => void;
    __deleteEntryById: (entryId: string) => Promise<void>;
    __exportSinglePDF: (entryId: string) => Promise<void>;
    __exportSingleExcel: (entryId: string) => Promise<void>;
    __viewIshikawaDiagram: (entryId: string) => void;
    __closeIshikawaViewer: () => void;
    __editEntryById: (entryId: string) => Promise<void>;
  }
}


/** Auto-syncs the current edit to the saved file */
function tryAutoSyncFile(): void {
  (async () => {
    try {
      persistCurrentState();
      const entry = savedAnalyses[selectedAnalysisIndex];
      if (entry) {
        await updateEntryById(entry.id, savedRcaData);
      }
    } catch {
      showToast('No se pudo sincronizar el archivo guardado.', 'warning');
    }
  })();
}

/** Starts inline editing of a row */
export function startEdit(key: string): void {
  setEditingKey(key);
  const drawer = document.getElementById('review-drawer');
  if (drawer && drawer.classList.contains('open')) {
    renderDrawerTable();
  } else {
    renderDataTable();
  }
}

/** Saves the edited value */
export function saveEdit(
  key: string,
  renderWhysWizard: () => void,
  refreshIshikawaDiagram: () => void,
  persist: () => void
): void {
  const input = document.querySelector(`#data-table-body [data-key="${key}"] .inline-input`) as HTMLInputElement
             || document.querySelector(`#drawer-tables-container [data-key="${key}"] .inline-input`) as HTMLInputElement;
  if (!input) return;
  const newVal = input.value.trim();
  applyFieldEdit(key, newVal);
  setEditingKey(null);
  persist();
  if (key.startsWith('whys.') || key.startsWith('5whys.')) renderWhysWizard();
  if (key.startsWith('ishikawa.')) refreshIshikawaDiagram();
  renderDataTable();
  renderDrawerTable();
  // Auto-sync to saved file
  tryAutoSyncFile();
}

/** Cancels editing */
export function cancelEdit(): void {
  setEditingKey(null);
  renderDataTable();
  renderDrawerTable();
}

/** Deletes (clears) a field */
export async function deleteField(
  key: string,
  renderWhysWizard: () => void,
  refreshIshikawaDiagram: () => void,
  persist: () => void
): Promise<void> {
  const confirmed = await confirmAction('¿Eliminar este campo?');
  if (!confirmed) return;
  applyFieldEdit(key, '');
  setEditingKey(null);
  persist();
  if (key.startsWith('whys.') || key.startsWith('5whys.')) renderWhysWizard();
  if (key.startsWith('ishikawa.')) refreshIshikawaDiagram();
  renderDataTable();
  renderDrawerTable();
  // Auto-sync to saved file
  tryAutoSyncFile();
}

/** Syncs savedRcaData changes back to the savedAnalyses array */
function syncEditToArray(): void {
  if (selectedAnalysisIndex >= 0 && selectedAnalysisIndex < savedAnalyses.length) {
    savedAnalyses[selectedAnalysisIndex].data = JSON.parse(JSON.stringify(savedRcaData));
  }
}

/** Applies a change to rcaData, savedRcaData, and the DOM */
function applyFieldEdit(key: string, value: string): void {
  const parts = key.split('.');
  const field = parts[1];

  if (parts[0] === 'captura') {
    rcaData.captura = rcaData.captura || {};
    if (field === 'fecha') {
      (rcaData.captura as Record<string, string[]>)[field] = parseDates(value);
    } else {
      (rcaData.captura as Record<string, string>)[field] = value;
    }
    savedRcaData.captura = savedRcaData.captura || {};
    if (field === 'fecha') {
      (savedRcaData.captura as Record<string, string[]>)[field] = parseDates(value);
    } else {
      (savedRcaData.captura as Record<string, string>)[field] = value;
    }
    const domMap: Record<string, string> = {
      maquina: 'maquina',
      problema: 'descripcionProblema',
      tiempoParo: 'tiempoParo',
      sintomas: 'sintomas',
      responsable: 'responsable',
      ordenMantto: 'ordenMantto',
      requisicion: 'requisicion',
      codigoProducto: 'codigoProducto'
    };
    const elId = domMap[field];
    if (elId) {
      const el = document.getElementById(elId) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (el) el.value = value;
    }
  } else if (parts[0] === 'whys' || parts[0] === '5whys') {
    rcaData.whys = rcaData.whys || { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 };
    (rcaData.whys as unknown as Record<string, string | number>)[field] = value;
    savedRcaData.whys = savedRcaData.whys || { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 };
    (savedRcaData.whys as unknown as Record<string, string | number>)[field] = value;
  } else if (parts[0] === 'ishikawa') {
    rcaData.ishikawa = rcaData.ishikawa || {};
    (rcaData.ishikawa as Record<string, string>)[field] = value;
    savedRcaData.ishikawa = savedRcaData.ishikawa || {};
    (savedRcaData.ishikawa as Record<string, string>)[field] = value;
    const el = document.getElementById(`ishikawa-${field}`) as HTMLTextAreaElement | null;
    if (el) el.value = value;
  } else if (parts[0] === 'plan') {
    const tipo = parts[1];
    const index = parseInt(parts[2], 10);
    const planField = parts[3];
    const acciones = rcaData.acciones || { correctivas: [], preventivas: [] };
    const list = tipo === 'correctivas' ? acciones.correctivas : acciones.preventivas;
    if (index >= 0 && index < list.length && planField) {
      const action = list[index];
      if (planField === 'descripcion') action.descripcion = value;
      else if (planField === 'responsable') action.responsable = value;
      else if (planField === 'fecha') action.fecha = value;
      else if (planField === 'prioridad') action.prioridad = value as 'alta' | 'media' | 'baja';
      else if (planField === 'estado') action.estado = value as 'listo' | 'en_proceso' | 'pendiente';

      const fieldSuffix: Record<string, string> = {
        descripcion: 'desc',
        responsable: 'resp',
        fecha: 'fecha',
        prioridad: 'prio',
        estado: 'estado'
      };
      const domFieldId = fieldSuffix[planField] || planField;
      const domTipo = tipo === 'correctivas' ? 'correctiva' : 'preventiva';
      const domInput = document.getElementById(`accion-${domTipo}-${index}-${domFieldId}`) as HTMLInputElement | HTMLSelectElement | null;
      if (domInput) domInput.value = value;
    }
    rcaData.acciones = acciones;
    // Also update savedRcaData.acciones
    const savedAcciones = savedRcaData.acciones || { correctivas: [], preventivas: [] };
    const savedList = tipo === 'correctivas' ? savedAcciones.correctivas : savedAcciones.preventivas;
    if (index >= 0 && index < savedList.length && planField) {
      const savedAction = savedList[index];
      if (planField === 'descripcion') savedAction.descripcion = value;
      else if (planField === 'responsable') savedAction.responsable = value;
      else if (planField === 'fecha') savedAction.fecha = value;
      else if (planField === 'prioridad') savedAction.prioridad = value as 'alta' | 'media' | 'baja';
      else if (planField === 'estado') savedAction.estado = value as 'listo' | 'en_proceso' | 'pendiente';
    }
    savedRcaData.acciones = savedAcciones;
  }
  // Sync back to savedAnalyses array
  syncEditToArray();
}

/** Deletes a single action row from the Plan section */
export async function deletePlanRow(
  tipo: string,
  index: number,
  persist: () => void
): Promise<void> {
  const list = tipo === 'correctivas' ? rcaData.acciones.correctivas : rcaData.acciones.preventivas;
  if (index < 0 || index >= list.length) return;
  const confirmed = await confirmAction('¿Eliminar esta acción?');
  if (!confirmed) return;

  removeActionFromState(tipo, index);
  // Also remove from savedRcaData
  const savedList = tipo === 'correctivas' ? savedRcaData.acciones.correctivas : savedRcaData.acciones.preventivas;
  if (index >= 0 && index < savedList.length) savedList.splice(index, 1);

  const containerId = `acciones${tipo === 'correctivas' ? 'Correctivas' : 'Preventivas'}`;
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = '';
    const updatedList = tipo === 'correctivas' ? rcaData.acciones.correctivas : rcaData.acciones.preventivas;
    updatedList.forEach((a, i) => {
      addAccionToDOM(tipo === 'correctivas' ? 'correctiva' : 'preventiva', a, i);
    });
  }

  syncEditToArray();
  setEditingKey(null);
  persist();
  renderDataTable();
  renderDrawerTable();
  tryAutoSyncFile();
}

/** Deletes (clears) all fields in a section */
export async function deleteSection(
  section: string,
  renderWhysWizard: () => void,
  refreshIshikawaDiagram: () => void,
  persist: () => void
): Promise<void> {
  const labelMap: Record<string, string> = {
    captura: 'Captura',
    ishikawa: 'Ishikawa',
    '5whys': '5 Porqués',
    plan: 'Plan de Acción'
  };
  const confirmed = await confirmAction(`¿Limpiar todos los datos de ${labelMap[section] || section}?`);
  if (!confirmed) return;

  if (section === 'captura') {
    rcaData.captura = {};
    savedRcaData.captura = {};
    ['maquina', 'descripcionProblema', 'tiempoParo', 'sintomas', 'responsable', 'indicador', 'ordenMantto', 'requisicion', 'codigoProducto'].forEach(id => {
      const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (el) el.value = '';
    });
    const fechaContainer = document.getElementById('fechaEvento-container');
    if (fechaContainer) {
      const hidden = fechaContainer.querySelector('input[type="hidden"]') as HTMLInputElement | null;
      if (hidden) hidden.value = '';
    }
    document.querySelectorAll<HTMLInputElement>('input[name="indicador"]').forEach(cb => cb.checked = false);
  } else if (section === 'ishikawa') {
    rcaData.ishikawa = {};
    savedRcaData.ishikawa = {};
    ['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'].forEach(field => {
      const el = document.getElementById(`ishikawa-${field}`) as HTMLTextAreaElement | null;
      if (el) el.value = '';
    });
  } else if (section === '5whys') {
    rcaData.whys = { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 };
    savedRcaData.whys = { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 };
  } else if (section === 'plan') {
    rcaData.acciones = { correctivas: [], preventivas: [] };
    savedRcaData.acciones = { correctivas: [], preventivas: [] };
    const corrContainer = document.getElementById('accionesCorrectivas');
    const prevContainer = document.getElementById('accionesPreventivas');
    if (corrContainer) corrContainer.innerHTML = '';
    if (prevContainer) prevContainer.innerHTML = '';
  }

  syncEditToArray();
  setEditingKey(null);
  persist();
  if (section === '5whys') renderWhysWizard();
  if (section === 'ishikawa') refreshIshikawaDiagram();
  renderDataTable();
  renderDrawerTable();
  tryAutoSyncFile();
}

/** Exports a single row/section as a compact PDF */
window.__exportRowPDF = async function(section: string, tipo?: string, index?: number): Promise<void> {
  try {
    await exportSingleRowPDF(section, tipo, index);
  } catch (err) {
    console.error('Error exporting row PDF:', err);
  }
};

/** Exports a single row/section as a compact Excel */
window.__exportRowExcel = async function(section: string, tipo?: string, index?: number): Promise<void> {
  try {
    await exportSingleRowExcel(section, tipo, index);
  } catch (err) {
    console.error('Error exporting row Excel:', err);
  }
};

/** Needed by drawer close buttons */
declare global {
  interface Window {
    __closeReviewDrawer: () => void;
    __closeTableView: () => void;
    __showTab: (name: string) => void;
    __switchDataTab: (section: string) => void;
    __exportRowPDF: (section: string, tipo?: string, index?: number) => Promise<void>;
    __exportRowExcel: (section: string, tipo?: string, index?: number) => Promise<void>;
  }
}
