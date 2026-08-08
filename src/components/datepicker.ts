import { escapeHtml, getTodayISODate } from '../utils/text';

type DateMode = 'single' | 'multiple' | 'range';

export function renderDatepicker(
  containerId: string,
  value: string[],
  onChange: (val: string[]) => void
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  const mode = determineMode(value);
  const today = getTodayISODate();

  container.innerHTML = buildHTML(containerId, mode, value, today);
  attachListeners(container, onChange);
}

function determineMode(value: string[]): DateMode {
  if (value.length <= 1) return 'single';
  if (value.length === 2) return 'range';
  return 'multiple';
}

function getContainerId(container: HTMLElement): string {
  return container.id || 'fechaEvento-container';
}

function buildHTML(containerId: string, mode: DateMode, value: string[], today: string): string {
  const modeLabels: Record<DateMode, string> = { single: 'Una fecha', multiple: 'Varias', range: 'Rango' };

  return `
    <input type="hidden" id="${containerId}-value" value="${escapeHtml(value.join(','))}">
    <div class="dp-row">
      <div class="dp-mode-toggle">
        ${(['single', 'multiple', 'range'] as DateMode[]).map(m =>
          `<button type="button" class="dp-mode-btn${m === mode ? ' dp-active' : ''}" data-mode="${m}" title="${modeLabels[m]}">${modeLabels[m]}</button>`
        ).join('')}
      </div>
      <div class="dp-body" data-mode="${mode}">
        ${renderBody(mode, value, today)}
      </div>
    </div>`;
}

function renderBody(mode: DateMode, value: string[], today: string): string {
  switch (mode) {
    case 'single':
      return `
        <div class="dp-single-wrap">
          <input type="date" class="dp-date-input" value="${escapeHtml(value[0] || '')}" max="${today}">
          <button type="button" class="dp-cal-btn" title="Abrir calendario"><i class="fas fa-calendar-alt"></i></button>
        </div>`;
    case 'range':
      const fromVal = value[0] || '';
      const toVal = value[1] || '';
      return `
        <div class="dp-range-group">
          <div class="dp-range-field">
            <input type="date" class="dp-date-input dp-range-input dp-range-from" value="${escapeHtml(fromVal)}" max="${toVal || today}" title="Desde">
            <button type="button" class="dp-cal-btn" title="Abrir calendario"><i class="fas fa-calendar-alt"></i></button>
          </div>
          <div class="dp-range-divider"></div>
          <div class="dp-range-field">
            <input type="date" class="dp-date-input dp-range-input dp-range-to" value="${escapeHtml(toVal)}" min="${fromVal || ''}" max="${today}" title="Hasta">
            <button type="button" class="dp-cal-btn" title="Abrir calendario"><i class="fas fa-calendar-alt"></i></button>
          </div>
        </div>`;
    case 'multiple':
      const chips = value.map((d, i) =>
        `<span class="dp-chip">${escapeHtml(formatFullDate(d))}<button type="button" class="dp-chip-remove" data-index="${i}"><i class="fas fa-times"></i></button></span>`
      ).join('');
      return `
        <div class="dp-multi-wrap">
          <div class="dp-multi-add-row">
            <div class="dp-multi-input-wrap">
              <input type="date" class="dp-date-input dp-multi-input" max="${today}">
              <button type="button" class="dp-cal-btn" title="Abrir calendario"><i class="fas fa-calendar-alt"></i></button>
            </div>
            <button type="button" class="btn btn-primary btn-sm dp-add-btn" title="Agregar fecha"><i class="fas fa-plus"></i></button>
          </div>
          <div class="dp-chips${chips ? '' : ' empty'}">
            ${chips || '<span class="dp-chips-empty">Ninguna fecha seleccionada</span>'}
          </div>
        </div>`;
  }
}

function attachListeners(container: HTMLElement, onChange: (val: string[]) => void): void {
  const cid = getContainerId(container);

  const getValue = (): string[] => {
    const hidden = document.getElementById(`${cid}-value`) as HTMLInputElement | null;
    return hidden?.value ? hidden.value.split(',').filter(Boolean) : [];
  };

  const setValue = (val: string[]) => {
    const hidden = document.getElementById(`${cid}-value`) as HTMLInputElement | null;
    if (hidden) hidden.value = val.join(',');
    onChange(val);
  };

  const updateBody = (mode: DateMode, val: string[]) => {
    const body = container.querySelector('.dp-body') as HTMLElement | null;
    if (body) {
      body.dataset.mode = mode;
      body.innerHTML = renderBody(mode, val, getTodayISODate());
      attachBodyListeners(container, onChange);
    }
  };

  attachBodyListeners(container, onChange);

  container.querySelectorAll('.dp-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const newMode = (btn as HTMLElement).dataset.mode as DateMode;
      container.querySelectorAll('.dp-mode-btn').forEach(b => b.classList.remove('dp-active'));
      btn.classList.add('dp-active');
      const currentVal = getValue();
      if (newMode === 'single' && currentVal.length > 1) {
        setValue([currentVal[0]]);
        updateBody(newMode, [currentVal[0]]);
      } else {
        updateBody(newMode, currentVal);
      }
    });
  });
}

function attachBodyListeners(container: HTMLElement, onChange: (val: string[]) => void): void {
  const cid = getContainerId(container);

  const getValue = (): string[] => {
    const hidden = document.getElementById(`${cid}-value`) as HTMLInputElement | null;
    return hidden?.value ? hidden.value.split(',').filter(Boolean) : [];
  };

  const setValue = (val: string[]) => {
    const hidden = document.getElementById(`${cid}-value`) as HTMLInputElement | null;
    if (hidden) hidden.value = val.join(',');
    onChange(val);
  };

  container.querySelectorAll('.dp-date-input').forEach(input => {
    input.removeEventListener('change', handleDateChange);
    input.addEventListener('change', handleDateChange);
  });

  container.querySelectorAll('.dp-add-btn').forEach(btn => {
    btn.removeEventListener('click', handleAddClick);
    btn.addEventListener('click', handleAddClick);
  });

  container.querySelectorAll('.dp-cal-btn').forEach(btn => {
    btn.removeEventListener('click', handleCalendarClick);
    btn.addEventListener('click', handleCalendarClick);
  });

  container.querySelectorAll('.dp-chip-remove').forEach(btn => {
    btn.removeEventListener('click', handleRemoveClick);
    btn.addEventListener('click', handleRemoveClick);
  });

  function handleDateChange(this: HTMLElement) {
    const body = container.querySelector('.dp-body') as HTMLElement | null;
    const mode = body?.dataset.mode as DateMode | undefined;
    const val = getValue();
    if (mode === 'single') {
      const input = this as HTMLInputElement;
      setValue(input.value ? [input.value] : []);
    } else if (mode === 'range') {
      const fromInput = container.querySelector('.dp-range-from') as HTMLInputElement | null;
      const toInput = container.querySelector('.dp-range-to') as HTMLInputElement | null;
      let from = fromInput?.value || '';
      let to = toInput?.value || '';
      // Validate: if both are set and from > to, swap them
      if (from && to && from > to) {
        [from, to] = [to, from];
        if (fromInput) fromInput.value = from;
        if (toInput) toInput.value = to;
    // Update min/max constraints
    fromInput?.setAttribute('max', to || '');
    toInput?.setAttribute('min', from || '');
      } else {
        // Update constraints based on what changed (or clear them)
        if (from) toInput?.setAttribute('min', from);
        else toInput?.removeAttribute('min');
        if (to) fromInput?.setAttribute('max', to);
        else fromInput?.removeAttribute('max');
      }
      const newVal: string[] = [];
      if (from) newVal.push(from);
      if (to) newVal.push(to);
      setValue(newVal);
    }
  }

  function handleCalendarClick(this: HTMLElement) {
    const field = (this as HTMLElement).closest('.dp-single-wrap, .dp-range-field, .dp-multi-input-wrap') as HTMLElement | null;
    const input = field?.querySelector('input[type="date"]') as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.focus();
    }
  }

  function handleAddClick() {
    const input = container.querySelector('.dp-multi-input') as HTMLInputElement | null;
    if (!input || !input.value) return;
    const val = getValue();
    if (val.includes(input.value)) return;
    const newVal = [...val, input.value];
    setValue(newVal);
    input.value = '';
    const body = container.querySelector('.dp-body') as HTMLElement | null;
    const mode = body?.dataset.mode as DateMode;
    if (body) body.innerHTML = renderBody(mode, newVal, getTodayISODate());
    attachBodyListeners(container, onChange);
  }

  function handleRemoveClick(this: HTMLElement) {
    const index = parseInt((this as HTMLElement).dataset.index || '-1', 10);
    if (index < 0) return;
    const val = getValue();
    const newVal = val.filter((_, i) => i !== index);
    setValue(newVal);
    const body = container.querySelector('.dp-body') as HTMLElement | null;
    const mode = body?.dataset.mode as DateMode;
    if (body) body.innerHTML = renderBody(mode, newVal, getTodayISODate());
    attachBodyListeners(container, onChange);
  }
}

let calDelegateInitialized = false;

export function initDelegatedCalendarButtons(): void {
  if (calDelegateInitialized) return;
  calDelegateInitialized = true;
  document.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    if (!target?.closest) return;
    const btn = target.closest('.dp-cal-btn') as HTMLElement | null;
    const targetId = btn?.dataset.calFor;
    if (!btn || !targetId) return;
    ev.stopPropagation();
    const input = document.getElementById(targetId) as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      input.showPicker();
    } else {
      input.focus();
    }
  });
}

export function getDatepickerValue(containerId: string): string[] {
  const hidden = document.getElementById(`${containerId}-value`) as HTMLInputElement | null;
  return hidden?.value ? hidden.value.split(',').filter(Boolean) : [];
}

export function setDatepickerValue(containerId: string, value: string[]): void {
  const hidden = document.getElementById(`${containerId}-value`) as HTMLInputElement | null;
  if (hidden) hidden.value = value.join(',');
  const body = document.querySelector(`#${CSS.escape(containerId)} .dp-body`) as HTMLElement | null;
  if (body) {
    const mode = determineMode(value);
    body.dataset.mode = mode;
    body.innerHTML = renderBody(mode, value, getTodayISODate());
    const container = document.getElementById(containerId);
    if (container) {
      container.querySelectorAll('.dp-mode-btn').forEach(b => {
        b.classList.toggle('dp-active', b.getAttribute('data-mode') === mode);
      });
      attachBodyListeners(container, () => {});
    }
  }
}

function formatFullDate(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const day = parseInt(parts[2], 10);
  const month = months[parseInt(parts[1], 10) - 1];
  return `${day} de ${month} de ${parts[0]}`;
}

export function formatShortDate(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}`;
}
