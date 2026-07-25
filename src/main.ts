import './style.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { rcaData, setRcaData, setSavedRcaData, savedAnalyses, setSavedAnalyses, setSelectedAnalysisIndex, syncSavedRcaDataFromSelected, persistCurrentState, hasData, CATEGORY_ORDER, type RCAData } from './state/store';
import { escapeHtml, getTodayISODate } from './utils/text';
import { showToast } from './utils/toast';
import { logError, logWarn, logInfo } from './utils/logger';
import { initLogViewer } from './components/log-viewer';
import { handleError } from './utils/errorHandler';
import { initModal } from './utils/ui';
import { confirmAction, confirmDanger } from './utils/confirm';
import { saveAnalysisFile, checkAnalysisFile, loadAnalysis, deleteAnalysis } from './services/analysisStorage';
import { getCurrentCauseSummary } from './state/store';
import {
  renderWhysWizard, updateRootCauseSummary,
  whysNext, whysPrev, whysFinish, whysEdit, toggleWhysTimeline, clearWhys
} from './components/whys-wizard';
import {
  refreshIshikawaDiagram, updateIshikawaDiagram, editCategory,
  saveIshikawa, clearIshikawa
} from './components/ishikawa';
import { addAccion, removeAccion, addAccionToDOM, clearActionPlan } from './components/plan';
import { renderDatepicker, getDatepickerValue, setDatepickerValue } from './components/datepicker';
import { toggleReviewDrawer, openReviewDrawer, closeReviewDrawer, renderDrawerTable } from './components/drawer';
import { toggleTableView, openTableView, closeTableView, renderDataTable, startEdit, saveEdit, cancelEdit, deleteField, deleteSection, deletePlanRow, switchDataTab } from './components/data-table';
import { exportExcel } from './services/exportExcel';
import { handlePDFExport, createSimplifiedIshikawa, createSimplifiedPareto } from './services/exportPDF';
import { recordRootCauseForPareto, getIshikawaParetoData, getAccumulatedParetoData } from './services/pareto';
import { getIshikawaHistory, updateIshikawaForMachine } from './services/ishikawaHistory';
import {
  showTab, navigateStep, updateStepNav, updateNextButtonState,
  updateTabLockState, updateClearAllButton, updateResumen,
  syncPlanFromAnalysis, clearCurrentStep,
  clearCaptura, saveCaptura, syncIndicador, saveIshikawaData,
  updateIshikawaGenerateBtn, resetWhysState, STEPS
} from './components/navigation';

/* ==========================================================================
   Global API for Inline Event Handlers
   ========================================================================== */

declare global {
  interface Window {
    __showTab: (name: string) => void;
    __saveCaptura: () => void;
    __clearCaptura: () => void;
    __toggleTableView: () => void;
    __toggleReviewDrawer: (e?: Event) => void;
    __closeReviewDrawer: () => void;
    __closeTableView: () => void;
    __clearAll: () => void;
    __clearAllFromTable: () => void;
    __whysNext: () => void;
    __whysPrev: () => void;
    __whysFinish: () => void;
    __whysEdit: (level: number) => void;
    __toggleWhysTimeline: () => void;
    __clearWhys: () => void;
    __saveIshikawa: () => void;
    __clearIshikawa: () => void;
    __editCategory: (cat: string) => void;
    __addAccion: (tipo: string) => void;
    __removeAccion: (btn: HTMLElement, tipo: string) => void;
    __handlePDFExport: () => void;
    __exportExcel: () => void;
    __exportFullPDF: () => void;
    __exportFullExcel: () => void;
    __navigateStep: (dir: number) => void;
    __clearCurrentStep: () => void;
    __saveAnalysis: () => void;
    __generateIshikawa: () => void;
    __startEdit: (key: string) => void;
    __saveEdit: (key: string) => void;
    __cancelEdit: () => void;
    __deleteField: (key: string) => void;
    __deleteSection: (section: string) => void;
    __deletePlanRow: (tipo: string, index: number) => void;
    __loadAnalysis: () => Promise<void>;
    __deleteAnalysis: () => Promise<void>;
    __switchDataTab: (section: string) => void;

    __syncIndicador: () => void;
  }
}

function registerGlobalAPI(): void {
  const syncPlan = () => { updateResumen(); };
  const updateClearAll = () => updateClearAllButton();

  window.__showTab = showTab;
  window.__saveCaptura = saveCaptura;
  window.__clearCaptura = clearCaptura;
  window.__toggleTableView = toggleTableView;
  window.__toggleReviewDrawer = toggleReviewDrawer;
  window.__closeReviewDrawer = closeReviewDrawer;
  window.__closeTableView = closeTableView;
  window.__clearAll = clearAll;
  window.__clearAllFromTable = clearAllFromTable;
  window.__syncIndicador = syncIndicador;
  window.__whysNext = () => {
    whysNext(syncPlan, persistCurrentState);
    updateStepNav();
    updateTabLockState();
  };
  window.__whysPrev = () => {
    whysPrev(syncPlan, persistCurrentState);
    updateStepNav();
    updateTabLockState();
  };
  window.__whysFinish = () => {
    whysFinish(syncPlan, persistCurrentState);
    updateStepNav();
    updateTabLockState();
  };
  window.__whysEdit = whysEdit;
  window.__toggleWhysTimeline = toggleWhysTimeline;
  window.__clearWhys = () => {
    clearWhys(resetWhysState, syncPlan, persistCurrentState);
    updateTabLockState();
  };
  window.__saveIshikawa = () => saveIshikawa(syncPlan, persistCurrentState, updateIshikawaForMachine);
  window.__clearIshikawa = () => clearIshikawa(syncPlan, persistCurrentState);
  window.__editCategory = editCategory;
  window.__addAccion = (tipo: string) => addAccion(tipo, persistCurrentState);
  window.__removeAccion = (btn: HTMLElement, tipo: string) => removeAccion(btn, tipo, persistCurrentState);
  window.__handlePDFExport = () => handlePDFExport(updateIshikawaForMachine);
  window.__exportExcel = () => exportExcel(updateIshikawaForMachine);
  window.__exportFullPDF = async () => {
    const { exportAllPDF } = await import('./services/exportPDF');
    exportAllPDF(savedAnalyses);
  };
  window.__exportFullExcel = async () => {
    const { exportAllExcel } = await import('./services/exportExcel');
    exportAllExcel(savedAnalyses);
  };
  window.__startEdit = startEdit;
  window.__saveEdit = (key: string) => saveEdit(key, renderWhysWizard, refreshIshikawaDiagram, persistCurrentState);
  window.__cancelEdit = cancelEdit;
  window.__deleteField = (key: string) => deleteField(key, renderWhysWizard, refreshIshikawaDiagram, persistCurrentState);
  window.__deleteSection = (section: string) => deleteSection(section, renderWhysWizard, refreshIshikawaDiagram, persistCurrentState);
  window.__deletePlanRow = (tipo: string, index: number) => deletePlanRow(tipo, index, persistCurrentState);
  window.__switchDataTab = (section: string) => switchDataTab(section as any);
  window.__loadAnalysis = loadAnalysisFromJson;
  window.__deleteAnalysis = deleteAnalysisFile;
  window.__navigateStep = (dir: number) => navigateStep(dir);
  window.__clearCurrentStep = clearCurrentStep;
  window.__generateIshikawa = generateIshikawa;

  window.__saveAnalysis = saveAnalysis;


}



/* ==========================================================================
   Ishikawa Generate
   ========================================================================== */

function generateIshikawa(): void {
  saveIshikawaData();

  setTimeout(() => {
    const diagram = document.getElementById('ishikawa-diagram');
    if (diagram && !diagram.classList.contains('hidden')) {
      diagram.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, 100);
}

/* ==========================================================================
   Save Analysis (from Plan step)
   ========================================================================== */

async function saveAnalysis(): Promise<void> {
  // Save current plan data from DOM
  persistCurrentState();

  // Check if there's data to save
  if (!rcaData.captura?.problema) {
    showToast('No hay datos para guardar.', 'warning');
    return;
  }

  try {
    // Append to the analyses array in the file
    await saveAnalysisFile(rcaData);

    // Reload the full list from the server (or localStorage) to refresh savedAnalyses
    const entries = await loadAnalysis();
    setSavedAnalyses(entries);
    setSelectedAnalysisIndex(entries.length - 1);
    syncSavedRcaDataFromSelected();

    showToast('Guardado correctamente.', 'success');

    // Clear the wizard completely — start fresh
    await clearAll(true);
  } catch (err) {
    handleError(err, 'guardar el análisis');
  }
}

/* ==========================================================================
   Clear All (wizard only — keeps rcaData intact for the table view)
   ========================================================================== */

async function clearAll(skipConfirm = false): Promise<void> {
  if (!skipConfirm) {
    const confirmed = await confirmDanger(
      'Esta acción no se puede deshacer.',
      '¿Limpiar TODO el análisis?'
    );
    if (!confirmed) return;
  }

  setDatepickerValue('fechaEvento-container', [getTodayISODate()]);
  const ids = ['maquina', 'tiempoParo', 'descripcionProblema', 'sintomas', 'responsable', 'indicador'];
  ids.forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (el) el.value = '';
  });
  document.querySelectorAll<HTMLInputElement>('input[name="indicador"]').forEach(cb => cb.checked = false);

  CATEGORY_ORDER.forEach(cat => {
    const el = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement | null;
    if (el) el.value = '';
  });

  const ishikawaDiagram = document.getElementById('ishikawa-diagram');
  if (ishikawaDiagram) ishikawaDiagram.classList.add('hidden');
  updateIshikawaDiagram({
    maquina: false, metodo: false, materiales: false,
    manoObra: false, medicion: false, medioAmbiente: false
  });

  clearActionPlan();

  const resumenProblema = document.getElementById('resumenProblema');
  const resumenCausa = document.getElementById('resumenCausa');
  if (resumenProblema) resumenProblema.textContent = 'No definido';
  if (resumenCausa) resumenCausa.textContent = 'No definida';

  updateIshikawaGenerateBtn();

  // Reset stepper — remove all daisyUI step states and re-lock
  const stepIds = ['tab-captura', 'tab-ishikawa', 'tab-5whys', 'tab-plan'];
  stepIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('step-success', 'step-info', 'step-neutral', 'step-primary');
    if (id !== 'tab-captura') {
      el.classList.add('tab-locked');
      el.style.opacity = '0.4';
      el.style.pointerEvents = 'none';
      el.onclick = null;
    } else {
      el.dataset.content = '1';
    }
  });

  setRcaData({
    captura: {},
    whys: { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 },
    ishikawa: {},
    acciones: { correctivas: [], preventivas: [] }
  });
  persistCurrentState();

  // Render whys wizard AFTER resetting data so timeline shows empty
  renderWhysWizard();

  localStorage.setItem('wizardCleared', 'true');

  // When user invoked directly (not from saveAnalysis/deleteAnalysisFile),
  // also delete the server file so old data doesn't reappear on refresh
  if (!skipConfirm) {
    try {
      await deleteAnalysis();
    } catch {
      // Silently fail if file doesn't exist
    }
  }

  showTab('captura');
  updateClearAllButton();
}

/* ==========================================================================
   Clear All from Table View (deletes saved file only — does NOT touch wizard)
   ========================================================================== */

async function clearAllFromTable(): Promise<void> {
  const confirmed = await confirmDanger(
    'Se eliminarán todos los análisis guardados.\n\nLos datos del wizard no se verán afectados.',
    '¿Limpiar todos los análisis guardados?'
  );
  if (!confirmed) return;

  setSavedAnalyses([]);
  setSelectedAnalysisIndex(-1);
  syncSavedRcaDataFromSelected();

  localStorage.removeItem('wizardCleared');

  try {
    await deleteAnalysis();
  } catch {
    // Silently fail if file doesn't exist
  }

  renderDataTable();
}

/* ==========================================================================
   Data Change Listeners
   ========================================================================== */

function addDataListeners(): void {
  const capturaFields = [
    'maquina', 'tiempoParo',
    'descripcionProblema', 'sintomas', 'responsable', 'indicador'
  ];
  capturaFields.forEach(id => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener('input', updateClearAllButton);
      field.addEventListener('change', updateClearAllButton);
    }
  });

  const whysContainer = document.getElementById('content-5whys');
  if (whysContainer) {
    whysContainer.addEventListener('input', function(e) {
      if ((e.target as HTMLElement).id === 'why-active-input') updateClearAllButton();
    });
    whysContainer.addEventListener('change', function(e) {
      if ((e.target as HTMLElement).id === 'why-active-input') updateClearAllButton();
    });
  }

  // Validation listeners for step-nav buttons
  const problemaField = document.getElementById('descripcionProblema');
  if (problemaField) {
    problemaField.addEventListener('input', () => updateNextButtonState('captura'));
    problemaField.addEventListener('change', () => updateNextButtonState('captura'));
  }

  // Ishikawa fields - check all-filled state for generar button
  CATEGORY_ORDER.forEach(cat => {
    const field = document.getElementById(`ishikawa-${cat}`);
    if (field) {
      field.addEventListener('input', () => {
        updateClearAllButton();
        updateIshikawaGenerateBtn();
      });
      field.addEventListener('change', () => {
        updateClearAllButton();
        updateIshikawaGenerateBtn();
      });
    }
  });

  ['accionesCorrectivas', 'accionesPreventivas'].forEach(containerId => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.addEventListener('input', persistCurrentState);
    container.addEventListener('change', persistCurrentState);
  });
}

/* ==========================================================================
   UI Initialization
   ========================================================================== */

function initializeDatePicker(): void {
  const initialFecha = rcaData.captura.fecha?.length ? rcaData.captura.fecha : [getTodayISODate()];
  rcaData.captura.fecha = initialFecha;
  renderDatepicker('fechaEvento-container', initialFecha, () => {
    persistCurrentState();
    updateClearAllButton();
  });
  initializeDateInputs();
  initializeDropdowns();
}

function initializeDateInputs(root: Document | HTMLElement = document): void {
  const dateInputs = root.querySelectorAll ? root.querySelectorAll('input[type="date"]') : [];
  dateInputs.forEach(input => {
    const el = input as HTMLInputElement;
    if (el.dataset.datepickerInitialized === 'true') return;
    el.dataset.datepickerInitialized = 'true';
    el.addEventListener('click', function() {
      this.focus();
      if (typeof this.showPicker === 'function') {
        this.showPicker();
      }
    });
    el.addEventListener('focus', function() {
      if (typeof this.showPicker === 'function') {
        setTimeout(() => { this.showPicker(); }, 0);
      }
    });
  });
}

function initializeDropdowns(): void {
  const selects = document.querySelectorAll('select');
  selects.forEach(select => {
    select.addEventListener('mousedown', function(this: HTMLSelectElement, e: MouseEvent) {
      const rect = this.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const spaceBelow = windowHeight - rect.bottom;
      if (spaceBelow < 200) {
        window.scrollBy({ top: 200 - spaceBelow, behavior: 'smooth' });
      }
    });
    select.addEventListener('focus', function() {
      const wrapper = this.closest('.select-wrapper') as HTMLElement | null;
      if (wrapper) {
        wrapper.style.position = 'relative';
        wrapper.style.zIndex = '1000';
      }
    });
    select.addEventListener('blur', function() {
      const wrapper = this.closest('.select-wrapper') as HTMLElement | null;
      if (wrapper) {
        setTimeout(() => { wrapper.style.zIndex = '10'; }, 300);
      }
    });
  });
}

/* ==========================================================================
   Global Error Handlers
   ========================================================================== */

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  logError('unhandledRejection', event.reason?.message || String(event.reason), event.reason);
});

window.addEventListener('error', (event: ErrorEvent) => {
  logError('uncaughtError', event.error?.message || event.message, { message: event.message, filename: event.filename, lineno: event.lineno });
});

/* ==========================================================================
   Initialization on DOMContentLoaded
   ========================================================================== */

window.addEventListener('DOMContentLoaded', function() {
  registerGlobalAPI();
  initLogViewer();
  logInfo('app', 'Inicializada');
  initializeDatePicker();

  // Restore saved data
  const saved = localStorage.getItem('rcaData');
  if (saved) {
    const parsed = JSON.parse(saved);
    const rawFecha = parsed.captura?.fecha;
    const restoredFecha: string[] | undefined = Array.isArray(rawFecha) ? rawFecha : (rawFecha ? [rawFecha] : undefined);
    const restored: RCAData = {
      captura: { ...(parsed.captura || {}), fecha: restoredFecha },
      whys: {
        why1: parsed.whys?.why1 || '',
        why2: parsed.whys?.why2 || '',
        why3: parsed.whys?.why3 || '',
        why4: parsed.whys?.why4 || '',
        why5: parsed.whys?.why5 || '',
        wizardLevel: parsed.whys?.wizardLevel ?? 1,
        causaRaiz: parsed.whys?.causaRaiz
      },
      ishikawa: parsed.ishikawa || {},
      acciones: parsed.acciones || { correctivas: [], preventivas: [] }
    };
    setRcaData(restored);
    // NOTE: savedRcaData is intentionally NOT set here — it must only come
    // from loadAnalysisFromJson() below (the blob file), so the "Todos los
    // datos" table only shows explicitly saved/committed data.

    if (rcaData.captura.fecha?.length) {
      setDatepickerValue('fechaEvento-container', rcaData.captura.fecha);
    } else if (rcaData.captura.fecha === undefined) {
      rcaData.captura.fecha = [getTodayISODate()];
      setDatepickerValue('fechaEvento-container', [getTodayISODate()]);
    }
    if (rcaData.captura.maquina) {
      const el = document.getElementById('maquina') as HTMLSelectElement | null;
      if (el) el.value = rcaData.captura.maquina;
    }
    if (rcaData.captura.tiempoParo) {
      const el = document.getElementById('tiempoParo') as HTMLInputElement | null;
      if (el) el.value = rcaData.captura.tiempoParo;
    }
    if (rcaData.captura.problema) {
      const el = document.getElementById('descripcionProblema') as HTMLTextAreaElement | null;
      if (el) el.value = rcaData.captura.problema;
    }
    if (rcaData.captura.sintomas) {
      const el = document.getElementById('sintomas') as HTMLTextAreaElement | null;
      if (el) el.value = rcaData.captura.sintomas;
    }
    if (rcaData.captura.responsable) {
      const el = document.getElementById('responsable') as HTMLInputElement | null;
      if (el) el.value = rcaData.captura.responsable;
    }
    if (rcaData.captura.indicador) {
      const values = rcaData.captura.indicador.split(',');
      document.querySelectorAll<HTMLInputElement>('input[name="indicador"]').forEach(cb => {
        cb.checked = values.includes(cb.value);
      });
      const hidden = document.getElementById('indicador') as HTMLInputElement | null;
      if (hidden) hidden.value = rcaData.captura.indicador;
    }

    if (typeof rcaData.whys.wizardLevel !== 'number') {
      let hasFilled = false;
      let lastLevel = 0;
      for (let i = 1; i <= 5; i++) {
        if (rcaData.whys[`why${i}` as keyof typeof rcaData.whys]) { hasFilled = true; lastLevel = i; }
      }
      rcaData.whys.wizardLevel = hasFilled ? 0 : 1;
    }

    CATEGORY_ORDER.forEach(cat => {
      if (rcaData.ishikawa[cat]) {
        const el = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement | null;
        if (el) el.value = rcaData.ishikawa[cat]!;
      }
    });
    refreshIshikawaDiagram();
    updateIshikawaGenerateBtn();

    if (rcaData.acciones.correctivas) {
      rcaData.acciones.correctivas.forEach((accion, index) => {
        addAccionToDOM('correctiva', accion, index);
      });
    }
    if (rcaData.acciones.preventivas) {
      rcaData.acciones.preventivas.forEach((accion, index) => {
        addAccionToDOM('preventiva', accion, index);
      });
    }

    initializeDropdowns();
  }

  renderWhysWizard();

  setTimeout(() => {
    syncPlanFromAnalysis();
  }, 500);

  addDataListeners();
  updateTabLockState();
  updateClearAllButton();
  updateStepNav();

  // Restore last active step (defaulting to captura if none saved or invalid)
  const savedStep = localStorage.getItem('rcaCurrentStep');
  const initialStep = savedStep && (STEPS as readonly string[]).includes(savedStep) ? savedStep : 'captura';
  showTab(initialStep);

  // Auto-load analysis JSON file if it exists
  loadAnalysisFromJson();

  // Remove loading class to reveal content after initialization
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove('loading');
    });
  });
});

/* ==========================================================================
   Auto-load / Delete the single analysis JSON file
   ========================================================================== */

async function loadAnalysisFromJson(): Promise<void> {
  try {
    const result = await checkAnalysisFile();
    if (!result.exists) {
      setSavedAnalyses([]);
      setSelectedAnalysisIndex(-1);
      syncSavedRcaDataFromSelected();
      return;
    }

    const entries = await loadAnalysis();
    setSavedAnalyses(entries);

    // Select the latest analysis
    if (entries.length > 0) {
      setSelectedAnalysisIndex(entries.length - 1);
    }
    syncSavedRcaDataFromSelected();
  } catch {
    logWarn('loadAnalysis', 'No se pudo cargar el archivo guardado — iniciando fresco.');
    setSavedAnalyses([]);
    setSelectedAnalysisIndex(-1);
    syncSavedRcaDataFromSelected();
  }
}

async function deleteAnalysisFile(): Promise<void> {
  const confirmed = await confirmDanger(
    'Esta acción no se puede deshacer.',
    '¿Eliminar el análisis guardado?'
  );
  if (!confirmed) return;

  try {
    await deleteAnalysis();
    showToast('Análisis eliminado.', 'success');
    await clearAll(true);
  } catch (err) {
    handleError(err, 'eliminar el análisis');
  }
}
