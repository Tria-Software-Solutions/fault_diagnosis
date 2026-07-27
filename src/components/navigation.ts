import { rcaData, CATEGORY_ORDER, persistCurrentState, hasData, getCurrentCauseSummary } from '../state/store';
import { refreshIshikawaDiagram, clearIshikawa } from './ishikawa';
import { clearWhys } from './whys-wizard';
import { clearActionPlan } from './plan';
import { setDatepickerValue, getDatepickerValue } from './datepicker';
import { getTodayISODate } from '../utils/text';
import { confirmAction } from '../utils/confirm';
import { showToast } from '../utils/toast';

export const STEPS = ['captura', 'ishikawa', '5whys', 'plan'] as const;
type StepName = (typeof STEPS)[number];

/* ==========================================================================
   Tab Navigation
   ========================================================================== */

export function showTab(tabName: string): void {
  if (tabName !== 'captura') {
    const tabBtn = document.getElementById(`tab-${tabName}`);
    if (tabBtn && tabBtn.classList.contains('tab-locked')) return;
  }

  document.querySelectorAll('[id^="content-"]').forEach(el => el.classList.add('hidden'));

  // Update daisyUI step classes for active state
  const stepIds = ['tab-captura', 'tab-ishikawa', 'tab-5whys', 'tab-plan'];
  stepIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('step-primary');
  });

  document.getElementById(`content-${tabName}`)?.classList.remove('hidden');
  const currentStep = document.getElementById(`tab-${tabName}`);
  if (currentStep && !currentStep.classList.contains('step-success')) {
    currentStep.classList.add('step-primary');
  }

  if (tabName === 'ishikawa') {
    refreshIshikawaDiagram();
    updateIshikawaGenerateBtn();
  }
  if (tabName === 'plan') {
    syncPlanFromAnalysis();
  }
  if (tabName === '5whys') {
    updateTabLockState();
  }

  localStorage.setItem('rcaCurrentStep', tabName);
  updateStepNav();
}

/* ==========================================================================
   Step Navigation
   ========================================================================== */

export function navigateStep(dir: number): void {
  const currentTab = document.querySelector('[id^="content-"]:not(.hidden)');
  if (!currentTab) return;
  const currentId = currentTab.id.replace('content-', '');
  const currentIndex = STEPS.indexOf(currentId as StepName);
  if (currentIndex === -1) return;

  const nextIndex = currentIndex + dir;
  if (nextIndex < 0 || nextIndex >= STEPS.length) return;

  const nextTab = STEPS[nextIndex];

  if (currentId === 'captura') {
    saveCaptura();
    if (!rcaData.captura.problema) {
      showToast('Describe el problema antes de continuar.', 'warning');
      return;
    }
  } else if (currentId === 'ishikawa') {
    saveIshikawaData();
  } else if (currentId === '5whys') {
    const input = document.getElementById('why-active-input') as HTMLInputElement | null;
    if (input) {
      const level = rcaData.whys.wizardLevel;
      if (level >= 1 && level <= 5) {
        if (level === 1) rcaData.whys.why1 = input.value.trim();
        else if (level === 2) rcaData.whys.why2 = input.value.trim();
        else if (level === 3) rcaData.whys.why3 = input.value.trim();
        else if (level === 4) rcaData.whys.why4 = input.value.trim();
        else if (level === 5) rcaData.whys.why5 = input.value.trim();
      }
    }
    persistCurrentState();
  }

  showTab(nextTab);

  if (currentId === '5whys') {
    updateTabLockState();
  }
}

/* ==========================================================================
   Ishikawa Save
   ========================================================================== */

export function saveIshikawaData(): void {
  CATEGORY_ORDER.forEach(cat => {
    const field = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement | null;
    if (field && field.value.trim()) {
      rcaData.ishikawa[cat] = field.value.trim();
    }
  });
  refreshIshikawaDiagram();
  syncPlanFromAnalysis();
  persistCurrentState();
  updateTabLockState();
}

/* ==========================================================================
   Step Nav UI
   ========================================================================== */

export function updateStepNav(): void {
  const currentTab = document.querySelector('[id^="content-"]:not(.hidden)');
  if (!currentTab) return;
  const currentId = currentTab.id.replace('content-', '');
  const currentIndex = STEPS.indexOf(currentId as StepName);
  if (currentIndex === -1) return;

  const prevBtn = document.getElementById('step-nav-prev') as HTMLButtonElement | null;
  if (prevBtn) {
    prevBtn.style.display = currentIndex === 0 ? 'none' : '';
    prevBtn.disabled = false;
  }

  const btnContainer = document.getElementById('step-nav-right-btn');
  if (!btnContainer) return;

  if (currentId === 'plan') {
    btnContainer.innerHTML = `
      <button id="step-nav-save" class="btn btn-success btn-sm" onclick="window.__saveAnalysis()">
        <i class="fas fa-save"></i>
        <span>Guardar</span>
      </button>
    `;
    return;
  }

  const isLast = currentIndex === STEPS.length - 2;
  const isWhys = currentId === '5whys';
  const nextLabel = isWhys ? 'Siguiente' : (isLast ? 'Finalizar' : 'Siguiente');
  const nextIcon = isWhys ? 'fa-arrow-right' : (isLast ? 'fa-check-circle' : 'fa-arrow-right');
  const nextClass = isLast ? 'btn-success' : 'btn-primary';

  btnContainer.innerHTML = `
    <button id="step-nav-next" class="btn ${nextClass} btn-sm" onclick="window.__navigateStep(1)" disabled>
      <span>${nextLabel}</span>
      <i class="fas ${nextIcon}"></i>
    </button>
  `;

  updateNextButtonState(currentId);
}

export function updateNextButtonState(tabId: string): void {
  const nextBtn = document.getElementById('step-nav-next') as HTMLButtonElement | null;
  if (!nextBtn) return;

  if (tabId === 'captura') {
    const problema = (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() || '';
    nextBtn.disabled = !problema;
  } else {
    nextBtn.disabled = false;
  }
}

/* ==========================================================================
   Stepper State Management
   ========================================================================== */

export function updateTabLockState(): void {
  const c = rcaData.captura || {};
  const w = rcaData.whys || {};
  const ish = rcaData.ishikawa || {};
  const acciones = rcaData.acciones || { correctivas: [], preventivas: [] };

  const ishikawaCompleto = CATEGORY_ORDER.every(cat => !!ish[cat]);
  const onWhysTab = !document.getElementById('content-5whys')?.classList.contains('hidden');
  const whysCompleto = !onWhysTab && !!(w.why1 || w.why2 || w.why3 || w.why4 || w.why5);
  const planCompleto = !!(acciones.correctivas.length > 0 || acciones.preventivas.length > 0);
  const capturaDesbloqueada = !!c.problema;
  const capturaCompleta = !!(c.maquina && c.problema);

  // Lock/unlock tabs based on captura
  const lockedTabs = ['ishikawa', '5whys', 'plan'];
  lockedTabs.forEach(tabName => {
    const btn = document.getElementById(`tab-${tabName}`);
    if (!btn) return;
    if (capturaDesbloqueada) {
      btn.classList.remove('tab-locked');
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
      btn.onclick = null;
      btn.onclick = function() { showTab(tabName); };
    } else {
      btn.classList.add('tab-locked');
      btn.style.opacity = '0.4';
      btn.style.pointerEvents = 'none';
    }
  });

  // Toggle just the Resumen button + its divider (Datos stays visible always)
  const resumenBtn = document.getElementById('btn-resumen');
  const dividerResumen = document.getElementById('divider-resumen');
  if (resumenBtn && dividerResumen) {
    const shouldHide = !capturaDesbloqueada;
    resumenBtn.classList.toggle('hidden', shouldHide);
    dividerResumen.classList.toggle('hidden', shouldHide);
  }

  // Update step states using daisyUI steps classes
  // Simplified: solo 2 colores con significado claro
  // - step-success (verde) = completado
  // - step-primary (azul) = paso activo actual
  // - default (gris) = disponible pero no activo
  const steps = [
    { id: 'tab-captura', completed: capturaCompleta },
    { id: 'tab-ishikawa', completed: ishikawaCompleto && capturaDesbloqueada },
    { id: 'tab-5whys', completed: whysCompleto && capturaDesbloqueada },
    { id: 'tab-plan', completed: planCompleto && capturaDesbloqueada },
  ];

  steps.forEach((step, index) => {
    const el = document.getElementById(step.id);
    if (!el) return;

    // Remove all step color classes
    el.classList.remove('step-primary', 'step-success', 'step-info', 'step-warning', 'step-error');

    if (step.completed) {
      el.classList.add('step-success');
      el.dataset.content = '✓';
    } else {
      el.dataset.content = String(index + 1);
      // Check if this is the currently active step
      const isActive = !document.getElementById('content-' + STEPS[index])?.classList.contains('hidden');
      if (isActive) {
        el.classList.add('step-primary');
      }
    }
  });
}

/* ==========================================================================
   Sync / Resumen
   ========================================================================== */

export function syncPlanFromAnalysis(): void {
  updateResumen();
}

export function updateResumen(): void {
  const resumenProblema = document.getElementById('resumenProblema');
  const resumenCausa = document.getElementById('resumenCausa');
  const resumenIndicadores = document.getElementById('resumenIndicadores');
  if (resumenProblema) resumenProblema.textContent = rcaData.captura.problema || 'No definido';
  const causaRaiz = getCurrentCauseSummary();
  if (resumenCausa) resumenCausa.textContent = causaRaiz || 'No definida';
  if (resumenIndicadores) {
    const indicadores = rcaData.captura.indicador ? rcaData.captura.indicador.split(',').join(', ') : 'Ninguno';
    resumenIndicadores.textContent = indicadores;
  }
}

/* ==========================================================================
   Clear All Button Visibility
   ========================================================================== */

export function updateClearAllButton(): void {
  const hasDataVal = hasData();
  ['clearAllBtnDrawer', 'clearAllBtnTable'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.toggle('hidden', !hasDataVal);
  });
}

/* ==========================================================================
   Clear Current Step
   ========================================================================== */

export async function clearCurrentStep(): Promise<void> {
  const currentTab = document.querySelector('[id^="content-"]:not(.hidden)');
  if (!currentTab) return;
  const currentId = currentTab.id.replace('content-', '');

  const labelMap: Record<string, string> = {
    captura: 'Captura del Problema',
    ishikawa: 'Diagrama de Ishikawa',
    '5whys': '5 Porqués',
    plan: 'Plan de Acción'
  };
  const confirmed = await confirmAction(`¿Limpiar todos los datos de ${labelMap[currentId] || currentId}?`);
  if (!confirmed) return;

  switch (currentId) {
    case 'captura': clearCaptura(); break;
    case 'ishikawa': clearIshikawa(syncPlanFromAnalysis, persistCurrentState); updateIshikawaGenerateBtn(); break;
    case '5whys': clearWhys(resetWhysState, syncPlanFromAnalysis, persistCurrentState); break;
    case 'plan': clearActionPlan(); persistCurrentState(); break;
  }

  updateTabLockState();
  updateClearAllButton();
  updateStepNav();
}

/* ==========================================================================
   Captura Helpers
   ========================================================================== */

export function clearCaptura(): void {
  rcaData.captura = {};
  setDatepickerValue('fechaEvento-container', [getTodayISODate()]);
  const ids = ['maquina', 'tiempoParo', 'descripcionProblema', 'sintomas', 'responsable', 'indicador'];
  ids.forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (el) el.value = '';
  });
  document.querySelectorAll<HTMLInputElement>('input[name="indicador"]').forEach(cb => cb.checked = false);
  syncPlanFromAnalysis();
  persistCurrentState();
}

export function resetWhysState(): void {
  rcaData.whys = { why1: '', why2: '', why3: '', why4: '', why5: '', wizardLevel: 1 };
}

export function updateIshikawaGenerateBtn(): void {
  const ISHIKAWA_FIELDS = ['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'];
  const allFilled = ISHIKAWA_FIELDS.every(cat => {
    const field = document.getElementById(`ishikawa-${cat}`) as HTMLTextAreaElement | null;
    return (field?.value?.trim()?.length ?? 0) > 0;
  });
  const btn = document.getElementById('btn-generar-ishikawa') as HTMLButtonElement | null;
  const area = document.getElementById('ishikawa-generate-area');
  if (btn) {
    btn.disabled = !allFilled;
    // Reset to "Generar diagrama" mode if a category was edited after generation
    if (allFilled && btn.getAttribute('data-generated') === 'true') {
      // Only reset if the SVG was cached — meaning it was generated before
    } else if (!allFilled) {
      btn.removeAttribute('data-generated');
      const icon = btn.querySelector('i');
      if (icon) icon.className = 'fas fa-sync-alt';
      const textSpan = document.getElementById('btn-ishikawa-text');
      if (textSpan) textSpan.textContent = 'Generar diagrama';
      btn.onclick = function() { window.__generateIshikawa(); };
      const infoText = document.getElementById('ish-generate-info-text');
      if (infoText) infoText.textContent = 'Completa las 6 categorías para generar el diagrama';
    }
  }
  if (area) area.classList.toggle('ready', allFilled);
}

export function saveCaptura(): void {
  syncIndicador();
  rcaData.captura = {
    fecha: getDatepickerValue('fechaEvento-container'),
    maquina: (document.getElementById('maquina') as HTMLSelectElement)?.value || '',
    tiempoParo: (document.getElementById('tiempoParo') as HTMLInputElement)?.value || '',
    problema: (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value || '',
    sintomas: (document.getElementById('sintomas') as HTMLTextAreaElement)?.value || '',
    responsable: (document.getElementById('responsable') as HTMLInputElement)?.value || '',
    indicador: (document.getElementById('indicador') as HTMLInputElement)?.value || ''
  };

  if (!rcaData.captura.problema) {
    showToast('Describe el problema antes de continuar.', 'warning');
    return;
  }

  syncPlanFromAnalysis();
  persistCurrentState();
  updateTabLockState();
}

export function syncIndicador(): void {
  const checked = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="indicador"]:checked'))
    .map(cb => cb.value)
    .join(',');
  const hidden = document.getElementById('indicador') as HTMLInputElement | null;
  if (hidden) {
    hidden.value = checked;
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
