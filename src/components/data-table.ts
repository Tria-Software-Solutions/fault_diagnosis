import { buildSectionRows, setEditingKey, getEditingKey, rcaData, savedRcaData, savedAnalyses, selectedAnalysisIndex, setSavedRcaData, setSavedAnalyses, setSelectedAnalysisIndex, syncSavedRcaDataFromSelected, removeActionFromState, persistCurrentState, DATA_SECTIONS, serializeDates, parseDates, formatDate, ISHIKAWA_CATEGORY_CONFIG, type DataSection } from '../state/store';
import { escapeHtml, formatDateDDMMYYYY } from '../utils/text';
import { confirmAction } from '../utils/confirm';
import { showToast } from '../utils/toast';
import { generateIshikawaPreview } from './ishikawa';
import { closeReviewDrawer, renderDrawerTable } from './drawer';
import { addAccionToDOM } from './plan';
import { updateEntryById } from '../services/analysisStorage';

/* ==========================================================================
   Full Data Table View Component — Section Tabs
   ========================================================================== */

let previousTab: string | null = null;
let currentDataTab: DataSection = 'captura';

// Filter state for Mes-Año + Máquina
let filterMonth = '';
let filterMachine = '';

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

/** Renders the selected analysis info bar + export actions below the filter list */
function renderSelectedAnalysisBar(): void {
  const container = document.getElementById('selected-analysis-bar');
  if (!container) return;

  if (savedAnalyses.length === 0 || selectedAnalysisIndex < 0) {
    container.innerHTML = '';
    return;
  }

  const entry = savedAnalyses[selectedAnalysisIndex];
  if (!entry) {
    container.innerHTML = '';
    return;
  }

  const data = entry.data;
  const maquina = data.captura?.maquina || 'Sin máquina';
  const problema = data.captura?.problema || 'Sin problema';
  const shortDate = formatDate(data.captura?.fecha);
  const indicador = data.captura?.indicador || '';
  const hasData = savedAnalyses.length > 0;
  const disabledClass = hasData ? '' : ' btn-disabled opacity-50 pointer-events-none';

  container.innerHTML = `<div class="selected-analysis-bar">
    <div class="selected-analysis-info">
      <i class="fas fa-cube text-blue-500"></i>
      <span class="selected-machine font-semibold">${escapeHtml(maquina)}</span>
      <span class="selected-sep">•</span>
      <span class="selected-problem">${escapeHtml(problema.substring(0, 60))}</span>
      ${indicador ? `<span class="selected-sep">•</span><span class="selected-indicator">${escapeHtml(indicador)}</span>` : ''}
      <span class="selected-sep">•</span>
      <span class="selected-date">${escapeHtml(shortDate)}</span>
    </div>
    <div class="selected-analysis-actions">
      <button class="btn btn-ghost btn-xs gap-1${disabledClass}" onclick="window.__exportFullPDF()" title="${hasData ? 'Exportar todos en PDF' : 'No hay datos'}">
        <i class="fas fa-file-pdf text-red-500"></i>
        <span>PDF</span>
      </button>
      <button class="btn btn-ghost btn-xs gap-1${disabledClass}" onclick="window.__exportFullExcel()" title="${hasData ? 'Exportar todos en Excel' : 'No hay datos'}">
        <i class="fas fa-file-excel text-green-600"></i>
        <span>Excel</span>
      </button>
      <div class="selected-actions-divider"></div>
      <button class="btn btn-ghost btn-xs gap-1 text-red-500 hover:bg-red-50" onclick="window.__deleteCurrentAnalysis()" title="Eliminar este análisis">
        <i class="fas fa-trash-alt"></i>
        <span>Eliminar</span>
      </button>
    </div>
  </div>`;
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

  // Also render the selected analysis bar below
  renderSelectedAnalysisBar();
}

/** Selects an analysis by index and refreshes the view */
window.__selectAnalysis = function(idx: number): void {
  setSelectedAnalysisIndex(idx);
  syncSavedRcaDataFromSelected();
  renderAnalysisFilters();
  renderDataTable();
};

/** Re-evaluates filter + auto-selects first visible if current selection is out of filter */
function applyFilterAndSync(): void {
  const entries = savedAnalyses;
  const filtered = entries.filter(entry => {
    const fechaAnalisis = entry.data.captura?.fecha?.[0] || '';
    if (filterMonth && fechaAnalisis.substring(0, 7) !== filterMonth) return false;
    if (filterMachine && entry.data.captura?.maquina?.trim() !== filterMachine) return false;
    return true;
  });

  // Only auto-select if the current selection is no longer in the filtered set
  const currentStillVisible = selectedAnalysisIndex >= 0 && filtered.some(e => entries.indexOf(e) === selectedAnalysisIndex);
  if (filtered.length > 0 && !currentStillVisible) {
    const idx = entries.indexOf(filtered[0]);
    if (idx !== selectedAnalysisIndex) {
      setSelectedAnalysisIndex(idx);
      syncSavedRcaDataFromSelected();
      renderDataTable();
    }
  }
}

/** Sets the month filter and refreshes the list */
window.__setFilterMonth = function(val: string): void {
  filterMonth = val;
  renderAnalysisFilters();
  applyFilterAndSync();
};

/** Sets the machine filter and refreshes the list */
window.__setFilterMachine = function(val: string): void {
  filterMachine = val;
  renderAnalysisFilters();
  applyFilterAndSync();
};

/** Renders the current sub-tab's section table from the selected analysis data */
export function renderDataTable(): void {
  const container = document.getElementById('data-table-body');
  if (!container) return;

  renderAnalysisFilters();
  updateSubtabDisabled();

  const data = savedRcaData;
  const hasAnyData = data.captura?.problema || Object.values(data.ishikawa || {}).some(v => v);

  if (!hasAnyData && savedAnalyses.length === 0) {
    container.innerHTML = `<div class="text-center py-8 text-gray-400">
      <i class="fas fa-database text-3xl mb-3 block"></i>
      <p>No hay análisis guardados.</p>
      <p class="text-xs">Completa el wizard y guarda para ver los datos aquí.</p>
    </div>`;
    return;
  }

  const sectionHtml = buildSectionRows(currentDataTab, data);

  // Build extra content based on section
  let extraHtml = '';
  if (currentDataTab === 'ishikawa') {
    const preview = generateIshikawaPreview(
      data.ishikawa || {},
      data.captura?.problema || ''
    );
    if (!preview.isEmpty) {
      extraHtml = `<div class="data-table-ishikawa-preview">
        <div class="ishikawa-preview-header">
          <span><i class="fas fa-project-diagram text-blue-600 mr-1"></i> Diagrama de Ishikawa</span>
        </div>
        <div class="ishikawa-preview-body">
          <div class="ishikawa-preview-svg-wrap">
            <svg viewBox="${preview.viewBox}" xmlns="http://www.w3.org/2000/svg" class="ishikawa-preview-svg">
              ${preview.svgContent}
            </svg>
          </div>
        </div>
      </div>`;
    } else {
      extraHtml = `<div class="data-table-ishikawa-preview">
        <div class="ishikawa-preview-header">
          <span><i class="fas fa-project-diagram text-blue-600 mr-1"></i> Diagrama de Ishikawa</span>
        </div>
        <div class="ishikawa-preview-body">
          <div class="ishikawa-preview-empty">
            <i class="fas fa-project-diagram"></i>
            <span>No hay datos de Ishikawa disponibles</span>
          </div>
        </div>
      </div>`;
    }
  }

  container.innerHTML = `<div class="data-section-block">${sectionHtml}</div>${extraHtml}`;

  if (getEditingKey()) {
    requestAnimationFrame(() => {
      const input = container.querySelector(`[data-key="${getEditingKey()}"] .inline-input`) as HTMLInputElement | null;
      if (input) input.focus();
    });
  }
}

/** Deletes the currently selected analysis from the saved list */
window.__deleteCurrentAnalysis = async function(): Promise<void> {
  if (selectedAnalysisIndex < 0 || selectedAnalysisIndex >= savedAnalyses.length) return;
  const confirmed = await confirmAction('¿Eliminar este análisis permanentemente?');
  if (!confirmed) return;

  const entryId = savedAnalyses[selectedAnalysisIndex].id;
  const { deleteAnalysisById } = await import('../services/analysisStorage');
  await deleteAnalysisById(entryId);

  // Refresh from the server
  const { loadAnalysis } = await import('../services/analysisStorage');
  const entries = await loadAnalysis();
  setSavedAnalyses(entries);

  if (entries.length > 0) {
    setSelectedAnalysisIndex(0);
  } else {
    setSelectedAnalysisIndex(-1);
  }
  syncSavedRcaDataFromSelected();
  renderDataTable();
  showToast('Análisis eliminado.', 'success');
};

/** Needed by the analysis filters */
declare global {
  interface Window {
    __selectAnalysis: (idx: number) => void;
    __setFilterMonth: (val: string) => void;
    __setFilterMachine: (val: string) => void;
    __deleteCurrentAnalysis: () => Promise<void>;
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
      responsable: 'responsable'
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

      const fieldSuffix: Record<string, string> = {
        descripcion: 'desc',
        responsable: 'resp',
        fecha: 'fecha',
        prioridad: 'prio'
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
    ['maquina', 'descripcionProblema', 'tiempoParo', 'sintomas', 'responsable', 'indicador'].forEach(id => {
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
  const { exportSingleRowPDF } = await import('../services/exportPDF');
  try {
    await exportSingleRowPDF(section, tipo, index);
  } catch (err) {
    console.error('Error exporting row PDF:', err);
  }
};

/** Exports a single row/section as a compact Excel */
window.__exportRowExcel = async function(section: string, tipo?: string, index?: number): Promise<void> {
  const { exportSingleRowExcel } = await import('../services/exportExcel');
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
