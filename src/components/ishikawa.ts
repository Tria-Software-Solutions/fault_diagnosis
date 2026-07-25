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

// Category → pair index mapping
const CATEGORY_PAIR: Record<string, number> = {
  maquina: 0, metodo: 1, materiales: 2,
  manoObra: 0, medicion: 1, medioAmbiente: 2
};

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
    // Max box width: must leave ≥20px gap between adjacent pair centers (min gap = 230px)
    const maxW = 210;
    dims[key] = calcBoxDimensions(value, maxW);
  });

  // ── 2. Symmetric layout — dynamic bone length based on tallest box ──
  const maxUpperTotal = Math.max(...UPPER_CATS.map(c =>
    dims[c].height + LABEL_H + LABEL_GAP + 10
  ));
  const maxLowerTotal = Math.max(...LOWER_CATS.map(c =>
    dims[c].height + LABEL_H + LABEL_GAP + 10
  ));
  const BONE_LENGTH = Math.max(180, maxUpperTotal, maxLowerTotal);

  // Fixed bone connection points (same for ALL upper/lower bones)
  const upperBoneY1 = SPINE_Y - BONE_LENGTH;
  const lowerBoneY1 = SPINE_Y + BONE_LENGTH;

  // Lower boxes: below the lower bone end
  const lowerLabelY = lowerBoneY1 + 10;  // = 650
  const lowerContentY = lowerLabelY + LABEL_H + LABEL_GAP; // = 676

  // Max lower box height for bounds calculation
  const maxLowerBoxH = Math.max(...LOWER_CATS.map(c => dims[c].height));

  // Problem box dimensions — dynamically sized, no cap
  const problemBoxH = Math.max(80, calcBoxDimensions(problema || 'No definido', 240).height);
  const problemY = SPINE_Y - problemBoxH / 2;

  // ── 2b. Calculate tight content bounds for viewBox ──
  const upperContentBottom = upperBoneY1 - 10; // 10px gap between content box bottom and bone start
  let contentMinY = SPINE_Y - 50; // fish tail top
  let contentMaxY = SPINE_Y + 50; // fish tail bottom

  // Upper boxes may extend above the fish tail
  for (const cat of UPPER_CATS) {
    const bh = dims[cat].height;
    const uContentY = upperContentBottom - bh;
    const uLabelY = uContentY - LABEL_H - LABEL_GAP;
    const topY = Math.max(uLabelY, 8);
    if (topY < contentMinY) contentMinY = topY;
  }

  // Lower boxes bottom
  const lowerBoxBottom = lowerContentY + maxLowerBoxH;
  if (lowerBoxBottom > contentMaxY) contentMaxY = lowerBoxBottom;

  // Problem box top and bottom
  if (problemY < contentMinY) contentMinY = problemY;
  const problemBoxBottom = problemY + problemBoxH;
  if (problemBoxBottom > contentMaxY) contentMaxY = problemBoxBottom;

  // Contact marks
  if (SPINE_Y + 8 > contentMaxY) contentMaxY = SPINE_Y + 8;

  const padding = 30;
  const svgMinY = contentMinY - padding;
  const svgH = Math.max(400, contentMaxY - svgMinY + padding);

  // ── 3. Build SVG elements ──
  const parts: string[] = [];

  // ── Defs ──
  parts.push(`<defs>
    <filter id="ish-shadow" x="-4" y="-4" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.08)"/>
    </filter>
    <filter id="ish-shadow-box" x="-4" y="-4" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="rgba(37,99,235,0.12)"/>
    </filter>
    <linearGradient id="ish-problem-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e3a5f"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <marker id="ish-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
      <polygon points="0 0, 10 3.5, 0 7" fill="#1e3a5f"/>
    </marker>
  </defs>`);

  // ── Background card (aligned with viewBox) ──
  parts.push(rect({ x: String(SVG_W * 0.01), y: String(svgMinY), width: String(SVG_W * 0.98), height: String(svgH), rx: '16', fill: 'white', opacity: '0.5' }));

  // ── Fish tail ──
  const tailTip = SPINE_START_X - 45;
  parts.push(path(
    `M ${SPINE_START_X} ${SPINE_Y} L ${tailTip} ${SPINE_Y - 50} L ${tailTip} ${SPINE_Y + 50} Z`,
    { fill: '#1e3a5f', opacity: '0.85' }
  ));
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y), x2: String(tailTip), y2: String(SPINE_Y + 50), stroke: '#1e3a5f', 'stroke-width': '3', 'stroke-linecap': 'round' }));
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y), x2: String(tailTip), y2: String(SPINE_Y - 50), stroke: '#1e3a5f', 'stroke-width': '3', 'stroke-linecap': 'round' }));

  // ── Spine ──
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y), x2: String(SPINE_END_X), y2: String(SPINE_Y), stroke: '#1e3a5f', 'stroke-width': '5', 'stroke-linecap': 'round', 'marker-end': 'url(#ish-arrow)' }));
  parts.push(line({ x1: String(SPINE_START_X), y1: String(SPINE_Y - 1), x2: String(SPINE_END_X), y2: String(SPINE_Y - 1), stroke: '#2563eb', 'stroke-width': '1.5', 'stroke-linecap': 'round', opacity: '0.3' }));

  // ── Spine contact marks ──
  for (const cx of PAIR_CENTERS) {
    const scx = cx + BONE_OFFSET;
    parts.push(line({ x1: String(scx), y1: String(SPINE_Y - 8), x2: String(scx), y2: String(SPINE_Y + 8), stroke: '#1e3a5f', 'stroke-width': '2' }));
  }

  // ── Upper branches ──
  for (let pi = 0; pi < 3; pi++) {
    const cat = UPPER_CATS[pi];
    const cx = PAIR_CENTERS[pi];
    const bw = dims[cat].width;
    const bh = dims[cat].height;
    const bx = cx - bw / 2;

    // Box sits just above the bone end — position depends on box height
    const uContentY = upperContentBottom - bh;
    const uLabelY = uContentY - LABEL_H - LABEL_GAP;

    const labelHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-label"><i class="${ISHIKAWA_CATEGORY_CONFIG[cat].icon}"></i> ${ISHIKAWA_CATEGORY_CONFIG[cat].label}</div>`;
    parts.push(fo({ x: String(bx), y: String(Math.max(uLabelY, 8)), width: String(bw), height: String(LABEL_H), onclick: `window.__editCategory('${cat}')` }, labelHtml));

    const items = (texts[cat] || '').split(',').map(s => s.trim()).filter(Boolean);
    const contentLines: string[] = [];
    for (const item of items) {
      const wrapped = wrapText(item, bw);
      contentLines.push(...wrapped);
    }
    const contentHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-content" style="overflow-y:auto">${contentLines.map(l => escapeHtml(l)).join('<br>')}</div>`;
    parts.push(fo({ x: String(bx), y: String(Math.max(uContentY, 8 + LABEL_H + LABEL_GAP)), width: String(bw), height: String(bh), onclick: `window.__editCategory('${cat}')` }, contentHtml));

    // Bone — from fixed upper end DOWN to spine (same angle for all)
    const scx = cx + BONE_OFFSET;
    parts.push(line({
      id: `ishikawa-branch-${cat}`,
      x1: String(cx), y1: String(upperBoneY1),
      x2: String(scx), y2: String(SPINE_Y),
      stroke: '#475569', 'stroke-width': '3', 'stroke-linecap': 'round'
    }));
  }

  // ── Lower branches ──
  for (let pi = 0; pi < 3; pi++) {
    const cat = LOWER_CATS[pi];
    const cx = PAIR_CENTERS[pi];
    const bw = dims[cat].width;
    const bh = dims[cat].height;
    const bx = cx - bw / 2;

    // Label + Content foreignObjects
    const labelHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-label"><i class="${ISHIKAWA_CATEGORY_CONFIG[cat].icon}"></i> ${ISHIKAWA_CATEGORY_CONFIG[cat].label}</div>`;
    parts.push(fo({ x: String(bx), y: String(lowerLabelY), width: String(bw), height: String(LABEL_H), onclick: `window.__editCategory('${cat}')` }, labelHtml));

    const items = (texts[cat] || '').split(',').map(s => s.trim()).filter(Boolean);
    const contentLines: string[] = [];
    for (const item of items) {
      const wrapped = wrapText(item, bw);
      contentLines.push(...wrapped);
    }
    const contentHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-bone-content" style="overflow-y:auto">${contentLines.map(l => escapeHtml(l)).join('<br>')}</div>`;
    parts.push(fo({ x: String(bx), y: String(lowerContentY), width: String(bw), height: String(bh), onclick: `window.__editCategory('${cat}')` }, contentHtml));

    // Bone — from spine DOWN to fixed lower end (same angle for all)
    const scx = cx + BONE_OFFSET;
    parts.push(line({
      id: `ishikawa-branch-${cat}`,
      x1: String(scx), y1: String(SPINE_Y),
      x2: String(cx), y2: String(lowerBoneY1),
      stroke: '#475569', 'stroke-width': '3', 'stroke-linecap': 'round'
    }));
  }

  // ── Problem box (uses problemBoxH & problemY from above) ──
  const problemText = problema || 'No definido';
  parts.push(rect({
    x: String(PROBLEM_X), y: String(problemY),
    width: '220', height: String(problemBoxH),
    rx: '12', fill: 'white', stroke: '#2563eb', 'stroke-width': '1.5', filter: 'url(#ish-shadow)'
  }));
  const problemHtml = `<div xmlns="http://www.w3.org/1999/xhtml" class="ish-problem-box" style="height:${problemBoxH}px">
    <div class="ish-problem-label">PROBLEMA</div>
    <div class="ish-problem-divider"></div>
    <div class="ish-problem-text">${escapeHtml(problemText)}</div>
  </div>`;
  parts.push(fo({ x: String(PROBLEM_X), y: String(problemY), width: '220', height: String(problemBoxH) }, problemHtml));

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
