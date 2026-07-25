import { rcaData, type Accion } from '../state/store';
import { getTodayISODate } from '../utils/text';
import { confirmAction } from '../utils/confirm';

/* ==========================================================================
   Action Plan Component
   ========================================================================== */

/** Generates HTML for an action card */
function buildAccionHTML(tipo: string, index: number, accion: Partial<Accion> = {}): string {
  const descripcion = accion.descripcion || '';
  const responsable = accion.responsable || '';
  const fecha = accion.fecha || getTodayISODate();
  const prioridad = accion.prioridad || 'media';

  return `
    <div class="accion-card">
      <button onclick="window.__removeAccion(this, '${tipo}')" class="accion-delete-btn absolute top-3 right-3" title="Eliminar acción">
        <i class="fas fa-trash-alt"></i>
      </button>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="sm:col-span-3">
          <label class="std-label" for="accion-${tipo}-${index}-desc">Descripción</label>
          <input type="text" id="accion-${tipo}-${index}-desc" value="${descripcion}"
                 class="input input-bordered w-full"
                 placeholder="Describe la acción...">
        </div>
        <div>
          <label class="std-label" for="accion-${tipo}-${index}-resp">Responsable</label>
          <input type="text" id="accion-${tipo}-${index}-resp" value="${responsable}"
                 class="input input-bordered w-full"
                 placeholder="Nombre del responsable...">
        </div>
        <div>
          <label class="std-label" for="accion-${tipo}-${index}-fecha">Fecha límite</label>
          <input type="date" id="accion-${tipo}-${index}-fecha" value="${fecha}"
                 class="input input-bordered w-full">
        </div>
        <div class="select-wrapper">
          <label class="std-label" for="accion-${tipo}-${index}-prio">Prioridad</label>
          <select id="accion-${tipo}-${index}-prio" class="select select-bordered w-full">
            <option value="alta" ${prioridad === 'alta' ? 'selected' : ''}>Alta</option>
            <option value="media" ${prioridad === 'media' ? 'selected' : ''}>Media</option>
            <option value="baja" ${prioridad === 'baja' ? 'selected' : ''}>Baja</option>
          </select>
        </div>
      </div>
    </div>
  `;
}

/** Adds an action card to the DOM */
export function addAccionToDOM(tipo: string, accion: Partial<Accion> = {}, index: number | null = null): void {
  const container = document.getElementById(
    `acciones${tipo.charAt(0).toUpperCase() + tipo.slice(1)}s`
  );
  if (!container) return;
  const nextIndex = index === null ? container.children.length : index;
  container.insertAdjacentHTML('beforeend', buildAccionHTML(tipo, nextIndex, accion));
}

/** Adds a new action */
export function addAccion(tipo: string, persist: () => void): void {
  addAccionToDOM(tipo);
  persist();
}

/** Removes an action card */
export async function removeAccion(btn: HTMLElement, tipo: string, persist: () => void): Promise<void> {
  const confirmed = await confirmAction('¿Eliminar esta acción?');
  if (!confirmed) return;
  btn.closest('.accion-card')?.remove();
  persist();
}

/** Clears the action plan */
export function clearActionPlan(): void {
  const correctivas = document.getElementById('accionesCorrectivas');
  const preventivas = document.getElementById('accionesPreventivas');
  if (correctivas) correctivas.innerHTML = '';
  if (preventivas) preventivas.innerHTML = '';
}
