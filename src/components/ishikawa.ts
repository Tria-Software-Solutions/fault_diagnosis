import { rcaData, CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, type RCAIshikawa } from '../state/store';
import { splitTextValues, sanitizeKeywordEntries } from '../utils/text';
import { showToast } from '../utils/toast';

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
   Dynamic Ishikawa SVG Generator
   ========================================================================== */

// ── Layout Constants ─────────────────────────────────────
const SPINE_Y = 460;
const SPINE_START_X = 85;
const SPINE_END_X = 790;
const LABEL_H = 22;
const LABEL_GAP = 4;
const CONTENT_PAD = 6;
const BONE_OFFSET = 80;
const PAIR_CENTERS = [130, 400, 630];
const PROBLEM_X = 795;
const SVG_W = 1040;

// Upper categories (3) and lower categories (3)
const UPPER_CATS = ['maquina', 'metodo', 'materiales'];
const LOWER_CATS = ['manoObra', 'medicion', 'medioAmbiente'];

// ── Canvas text measurement ──────────────────────────────
let _measureCtx: CanvasRenderingContext2D | null = null;
function getCtx(): CanvasRenderingContext2D {
  if (!_measureCtx) {
    const c = document.createElement('canvas');
    _measureCtx = c.getContext('2d')!;
  }
  return _measureCtx;
}

function measureTextWidth(text: string, size: number = 12): number {
  const ctx = getCtx();
  ctx.font = `${size}px Inter, system-ui, sans-serif`;
  return ctx.measureText(text).width;
}

/** Wraps text into lines at a given maxWidth (in SVG coordinate units) */
function wrapText(text: string, maxWidth: number, fontSize: number = 12): string[] {
  if (!text) return [];
  const ctx = getCtx();
  ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth - 12) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

interface BoxDim {
  width: number;
  height: number;
}

function calcBoxDimensions(text: string, maxBoxWidth: number, fontSize: number = 12): BoxDim {
  if (!text) return { width: 160, height: 60 };

  // Split by comma for multi-cause entries, measure each item
  const items = text.split(',').map(s => s.trim()).filter(Boolean);
  if (items.length === 0) return { width: 160, height: 60 };

  // Find the longest item to determine box width
  let maxItemW = 0;
  for (const item of items) {
    const w = measureTextWidth(item, fontSize);
    if (w > maxItemW) maxItemW = w;
  }
  const boxW = Math.max(160, Math.min(maxItemW + 24, maxBoxWidth));

  // Wrap each item and count total lines
  let totalLines = 0;
  for (const item of items) {
    const wrapped = wrapText(item, boxW, fontSize);
    totalLines += wrapped.length;
  }
  const lineH = fontSize + 4; // ~16px per line
  const boxH = Math.max(60, totalLines * lineH + 16);

  return { width: boxW, height: boxH };
}

// ── SVG element builders ─────────────────────────────────

function el(tag: string, attrs: Record<string, string>, children: string = ''): string {
  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`)
    .join(' ');
  return `<${tag} ${attrStr}>${children}</${tag}>`;
}

function rect(attrs: Record<string, string>): string {
  return el('rect', attrs);
}

function line(attrs: Record<string, string>): string {
  return el('line', attrs);
}

function fo(attrs: Record<string, string>, html: string): string {
  return el('foreignObject', attrs, html);
}

function g(attrs: Record<string, string>, children: string): string {
  return el('g', attrs, children);
}

function path(d: string, attrs: Record<string, string> = {}): string {
  return el('path', { d, ...attrs });
}

function text(attrs: Record<string, string>, content: string): string {
  return el('text', attrs, escapeHtml(content));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Main dynamic SVG generation ──────────────────────────

// Category background colors (matching canvas version)
const CAT_COLORS: Record<string, string> = {
  maquina: '#dbeafe', metodo: '#dcfce7', materiales: '#fef3c7',
  manoObra: '#fce7f3', medicion: '#ede9fe', medioAmbiente: '#ccfbf1'
};
const CAT_STROKE: Record<string, string> = {
  maquina: '#93c5fd', metodo: '#86efac', materiales: '#fde68a',
  manoObra: '#f9a8d4', medicion: '#c4b5fd', medioAmbiente: '#5eead4'
};

function generateDynamicSVG(src?: { ishikawa: Record<string, string | undefined>; problema: string }): { content: string; height: number; minY: number } {
  const problema = src?.problema ?? ((document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() || '');

  // ── 1. Calculate box dimensions for each category ──
  const dims: Record<string, BoxDim> = {};
  const texts: Record<string, string> = {};

  CATEGORY_ORDER.forEach(key => {
    let value: string;
    if (src?.ishikawa && src.ishikawa[key] !== undefined) {
      value = (src.ishikawa[key] || '').trim();
    } else {
      value = (document.getElementById(`ishikawa-${key}`) as HTMLTextAreaElement)?.value?.trim() || '';
    }
    texts[key] = value;
    const maxW = 240;
    dims[key] = calcBoxDimensions(value, maxW);
  });

  // ── 2. Symmetric layout — dynamic bone length based on tallest box ──
  const maxUpperTotal = Math.max(...UPPER_CATS.map(c =>
    dims[c].height + LABEL_H + LABEL_GAP + 14
  ));
  const maxLowerTotal = Math.max(...LOWER_CATS.map(c =>
    dims[c].height + LABEL_H + LABEL_GAP + 14
  ));
  const BONE_LENGTH = Math.max(200, maxUpperTotal, maxLowerTotal);

  const upperBoneY1 = SPINE_Y - BONE_LENGTH;
  const lowerBoneY1 = SPINE_Y + BONE_LENGTH;

  const lowerLabelY = lowerBoneY1 + 12;
  const lowerContentY = lowerLabelY + LABEL_H + LABEL_GAP;

  const maxLowerBoxH = Math.max(...LOWER_CATS.map(c => dims[c].height));

  // Problem box
  const problemBoxH = Math.max(90, calcBoxDimensions(problema || 'No definido', 280).height);
  const problemY = SPINE_Y - problemBoxH / 2;

  // ── 2b. Content bounds for viewBox ──
  const upperContentBottom = upperBoneY1 - 14;
  let contentMinY = SPINE_Y - 60;
  let contentMaxY = SPINE_Y + 60;

  for (const cat of UPPER_CATS) {
    const bh = dims[cat].height;
    const uContentY = upperContentBottom - bh;
    const uLabelY = uContentY - LABEL_H - LABEL_GAP;
    if (uLabelY < contentMinY) contentMinY = uLabelY;
  }

  const lowerBoxBottom = lowerContentY + maxLowerBoxH;
  if (lowerBoxBottom > contentMaxY) contentMaxY = lowerBoxBottom;
  if (problemY < contentMinY) contentMinY = problemY;
  if (problemY + problemBoxH > contentMaxY) contentMaxY = problemY + problemBoxH;

  const padding = 30;
  const svgMinY = contentMinY - padding;
  const svgH = Math.max(420, contentMaxY - svgMinY + padding);

  // ── 3. Build SVG ──
  const parts: string[] = [];

  // ── Defs ──
  parts.push(`<defs>
    <filter id="ish-shadow" x="-6" y="-6" width="150%" height="150%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="rgba(0,0,0,0.10)"/>
    </filter>
    <filter id="ish-problem-shadow" x="-6" y="-6" width="150%" height="150%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="rgba(30,58,95,0.25)"/>
    </filter>
    <linearGradient id="ish-problem-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e3a5f"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <marker id="ish-arrow" markerWidth="12" markerHeight="8" refX="11" refY="4" orient="auto">
      <polygon points="0 0, 12 4, 0 8" fill="#2563eb"/>
    </marker>
  </defs>`);

  // ── Background card ──
  parts.push(rect({ x: String(SVG_W * 0.01), y: String(svgMinY), width: String(SVG_W * 0.98), height: String(svgH), rx: '16', fill: 'white', opacity: '0.5' }));

  // ── Fish tail (navy, slightly larger) ──
  const tailTip = SPINE_START_X - 55;
  parts.push(path(
    `M ${SPINE_START_X} ${SPINE_Y} L ${tailTip} ${SPINE_Y - 55} L ${tailTip} ${SPINE_Y + 55} Z`,
    { fill: '#1e3a5f', opacity: '0.85' }
  ));
  // Tail edge lines
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y), x2: String(tailTip), y2: String(SPINE_Y + 55), stroke: '#1e3a5f', 'stroke-width': '4', 'stroke-linecap': 'round' }));
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y), x2: String(tailTip), y2: String(SPINE_Y - 55), stroke: '#1e3a5f', 'stroke-width': '4', 'stroke-linecap': 'round' }));

  // ── Spine (navy thick) ──
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y), x2: String(SPINE_END_X), y2: String(SPINE_Y), stroke: '#1e3a5f', 'stroke-width': '6', 'stroke-linecap': 'round', 'marker-end': 'url(#ish-arrow)' }));
  // Blue accent line above spine
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y - 1), x2: String(SPINE_END_X), y2: String(SPINE_Y - 1), stroke: '#3b82f6', 'stroke-width': '2', 'stroke-linecap': 'round', opacity: '0.4' }));

  // ── Spine contact marks ──
  for (const cx of PAIR_CENTERS) {
    const scx = cx + BONE_OFFSET;
    parts.push(line({ x1: String(scx), y1: String(SPINE_Y - 10), x2: String(scx), y2: String(SPINE_Y + 10), stroke: '#1e3a5f', 'stroke-width': '2.5' }));
  }

  // ── Upper branches ──
  for (let pi = 0; pi < 3; pi++) {
    const cat = UPPER_CATS[pi];
    const cx = PAIR_CENTERS[pi];
    const bw = dims[cat].width;
    const bh = dims[cat].height;
    const bx = cx - bw / 2;

    const uContentY = upperContentBottom - bh;
    const uLabelY = uContentY - LABEL_H - LABEL_GAP;
    const uLabelTop = Math.max(uLabelY, 8);
    const uContentTop = Math.max(uContentY, 8 + LABEL_H + LABEL_GAP);

    // Rounded box background with shadow
    const boxBottom = uContentTop + bh;
    const boxTop = uLabelTop;
    const boxH = boxBottom - boxTop;
    parts.push(rect({
      x: String(bx), y: String(boxTop),
      width: String(bw), height: String(boxH),
      rx: '8', fill: CAT_COLORS[cat] || '#f1f5f9',
      filter: 'url(#ish-shadow)'
    }));
    // Separator line
    const sepY = uLabelTop + LABEL_H + 4;
    parts.push(line({
      x1: String(bx + 10), y1: String(sepY),
      x2: String(bx + bw - 10), y2: String(sepY),
      stroke: CAT_STROKE[cat] || '#e2e8f0', 'stroke-width': '1'
    }));

    // Label
    const labelHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-label"><i class="${ISHIKAWA_CATEGORY_CONFIG[cat].icon}"></i> ${ISHIKAWA_CATEGORY_CONFIG[cat].label}</div>`;
    parts.push(fo({ x: String(bx + 4), y: String(uLabelTop), width: String(bw - 8), height: String(LABEL_H), onclick: `window.__editCategory('${cat}')` }, labelHtml));

    // Content
    const items = (texts[cat] || '').split(',').map(s => s.trim()).filter(Boolean);
    const contentLines: string[] = [];
    for (const item of items) {
      const wrapped = wrapText(item, bw - 12);
      contentLines.push(...wrapped);
    }
    const contentHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-content">${contentLines.map(l => escapeHtml(l)).join('<br>')}</div>`;
    parts.push(fo({ x: String(bx + 6), y: String(uContentTop), width: String(bw - 12), height: String(bh), onclick: `window.__editCategory('${cat}')` }, contentHtml));

    // Blue branch
    const scx = cx + BONE_OFFSET;
    parts.push(line({
      id: `ishikawa-branch-${cat}`,
      x1: String(cx), y1: String(upperBoneY1),
      x2: String(scx), y2: String(SPINE_Y),
      stroke: '#3b82f6', 'stroke-width': '3', 'stroke-linecap': 'round'
    }));
  }

  // ── Lower branches ──
  for (let pi = 0; pi < 3; pi++) {
    const cat = LOWER_CATS[pi];
    const cx = PAIR_CENTERS[pi];
    const bw = dims[cat].width;
    const bh = dims[cat].height;
    const bx = cx - bw / 2;

    const boxH = lowerContentY + bh - lowerLabelY;
    parts.push(rect({
      x: String(bx), y: String(lowerLabelY),
      width: String(bw), height: String(boxH),
      rx: '8', fill: CAT_COLORS[cat] || '#f1f5f9',
      filter: 'url(#ish-shadow)'
    }));
    const sepY = lowerLabelY + LABEL_H + 4;
    parts.push(line({
      x1: String(bx + 10), y1: String(sepY),
      x2: String(bx + bw - 10), y2: String(sepY),
      stroke: CAT_STROKE[cat] || '#e2e8f0', 'stroke-width': '1'
    }));

    const labelHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-label"><i class="${ISHIKAWA_CATEGORY_CONFIG[cat].icon}"></i> ${ISHIKAWA_CATEGORY_CONFIG[cat].label}</div>`;
    parts.push(fo({ x: String(bx + 4), y: String(lowerLabelY), width: String(bw - 8), height: String(LABEL_H), onclick: `window.__editCategory('${cat}')` }, labelHtml));

    const items = (texts[cat] || '').split(',').map(s => s.trim()).filter(Boolean);
    const contentLines: string[] = [];
    for (const item of items) {
      const wrapped = wrapText(item, bw - 12);
      contentLines.push(...wrapped);
    }
    const contentHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-content">${contentLines.map(l => escapeHtml(l)).join('<br>')}</div>`;
    parts.push(fo({ x: String(bx + 6), y: String(lowerContentY), width: String(bw - 12), height: String(bh), onclick: `window.__editCategory('${cat}')` }, contentHtml));

    const scx = cx + BONE_OFFSET;
    parts.push(line({
      id: `ishikawa-branch-${cat}`,
      x1: String(scx), y1: String(SPINE_Y),
      x2: String(cx), y2: String(lowerBoneY1),
      stroke: '#3b82f6', 'stroke-width': '3', 'stroke-linecap': 'round'
    }));
  }

  // ── Problem box (navy gradient with shadow) ──
  const problemText = problema || 'No definido';
  // Shadow rect
  parts.push(rect({
    x: String(PROBLEM_X), y: String(problemY),
    width: '240', height: String(problemBoxH),
    rx: '14', fill: 'url(#ish-problem-grad)',
    filter: 'url(#ish-problem-shadow)'
  }));
  // Inner glow
  parts.push(rect({
    x: String(PROBLEM_X), y: String(problemY),
    width: '240', height: String(problemBoxH),
    rx: '14', fill: 'url(#ish-problem-grad)'
  }));
  const problemHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-problem-box" style="height:${problemBoxH}px">
    <div class="ish-problem-label" style="color:rgba(255,255,255,0.9);font-size:12px;letter-spacing:1.5px">PROBLEMA</div>
    <div class="ish-problem-divider" style="background:rgba(255,255,255,0.15)"></div>
    <div class="ish-problem-text" style="color:#93c5fd;font-size:14px;text-align:left;padding:0 8px">${escapeHtml(problemText)}</div>
  </div>`;
  parts.push(fo({ x: String(PROBLEM_X), y: String(problemY), width: '240', height: String(problemBoxH) }, problemHtml));

  return { content: parts.join('\n'), height: svgH, minY: svgMinY };
}

/** Refreshes the SVG diagram with current data (fully dynamic generation) */
export function refreshIshikawaDiagram(): void {
  const diagram = document.getElementById('ishikawa-diagram');
  if (!diagram) return;

  const filledEntries = getFilledIshikawaEntries();
  if (filledEntries.length === 0) {
    diagram.classList.add('hidden');
    return;
  }
  diagram.classList.remove('hidden');

  let svg = diagram.querySelector('svg') as SVGSVGElement | null;
  if (!svg) {
    // Create SVG element if it doesn't exist
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('ishikawa-svg');
    diagram.appendChild(svg);
  }

  // Generate dynamic SVG content with tight viewBox
  const result = generateDynamicSVG();
  svg.setAttribute('viewBox', `0 ${result.minY} ${SVG_W} ${result.height}`);
  svg.innerHTML = result.content;
}

/** Generates SVG preview from saved data (for the "Todos los datos" view) */
export function generateIshikawaPreview(
  ishikawa: Record<string, string | undefined>,
  problema: string
): { svgContent: string; viewBox: string; isEmpty: boolean } {
  const hasData = Object.values(ishikawa).some(v => v && String(v).trim());
  if (!hasData) {
    return { svgContent: '', viewBox: '', isEmpty: true };
  }
  const result = generateDynamicSVG({ ishikawa, problema });
  return {
    svgContent: result.content,
    viewBox: `0 ${result.minY} ${SVG_W} ${result.height}`,
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
