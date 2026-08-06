import { rcaData, savedRcaData, getCurrentCauseSummary, type RCAData } from '../state/store';
import { formatDateDDMMYYYY, splitTextValues } from '../utils/text';
import { saveBlob } from '../utils/download';
import { showToast } from '../utils/toast';
import { handleError } from '../utils/errorHandler';
import { createSimplifiedPareto, buildIndividualFilename, formatFechas, formatFechaLarga, formatTiempoParo } from './exportPDF';
import { recordRootCauseForPareto } from './pareto';
import { getAccumulatedParetoData } from './pareto';
import ExcelJS from 'exceljs';

/* ==========================================================================
   Excel Export — Premium Modern Design
   Same visual language as the PDF: navy bars, blue section headers,
   modern Spanish dates and readable stop-time. The Ishikawa diagram and
   the Pareto chart are embedded as IMAGES (rendered by the canvas
   renderers shared with the PDF) — no text tables for those sections.
   ========================================================================== */

const XL = {
  navy: 'FF1E3A5F', blue: 'FF2563EB',
  slate: 'FF64748B', slateDark: 'FF1E293B', white: 'FFFFFFFF',
  grayBg: 'FFF9FAFB', grayBorder: 'FFE5E7EB',
  green: 'FF16A34A', greenLight: 'FFDCFCE7', greenDark: 'FF166534',
  amber: 'FFD97706', red: 'FFDC2626',
};

function headerStyle(bg: string): Partial<ExcelJS.Style> {
  return {
    font: { bold: true, size: 11, name: 'Calibri', color: { argb: XL.white } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } },
    alignment: { vertical: 'middle', horizontal: 'center' },
    border: { top: { style: 'thin', color: { argb: bg } }, bottom: { style: 'thin', color: { argb: bg } }, left: { style: 'thin', color: { argb: bg } }, right: { style: 'thin', color: { argb: bg } } },
  };
}

function applyRowStyle(row: ExcelJS.Row, style: Partial<ExcelJS.Style>): void {
  row.eachCell((c) => { Object.assign(c, style); });
}

/* ==========================================================================
   Sheet Builder: horizontal table — field labels left-to-right in one navy
   header row, values in a single row below (modern dashboard look).
   The combined single-row table (Información + 5 Porqués + Causa raíz +
   Acciones pareadas) has 21 columns.
   ========================================================================== */

const INFO_WIDTHS = [28, 40, 30, 24, 24, 36, 22, 28, 28, 28, 28, 28, 40, 40, 24, 30, 16, 40, 24, 30, 16];

function addHorizontalSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  headers: string[],
  values: string[],
  opts?: { greenCol?: number },
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(name);
  INFO_WIDTHS.slice(0, headers.length).forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  const n = headers.length;

  // Title row (merged)
  const tRow = sheet.addRow([title, ...Array(Math.max(n - 1, 0)).fill('')]);
  applyRowStyle(tRow, headerStyle(XL.navy));
  tRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  tRow.height = 28;
  sheet.mergeCells(1, 1, 1, n);

  addHorizontalBlock(sheet, headers, values, opts);
  return sheet;
}

/** Adds a modern horizontal block inside a sheet: navy header row (labels
 *  left-to-right) + a single data row with the values. Optional green
 *  highlight column (e.g. Causa raíz — column 13 of the combined table). */
function addHorizontalBlock(
  sheet: ExcelJS.Worksheet,
  headers: string[],
  values: string[],
  opts?: { greenCol?: number },
): void {
  const n = headers.length;
  const hCells: string[] = [];
  const vCells: string[] = [];
  for (let i = 0; i < n; i++) {
    hCells.push(headers[i] || '');
    vCells.push(values[i] || '—'); // empty fields render as '—'
  }
  const hRow = sheet.addRow(hCells);
  applyRowStyle(hRow, headerStyle(XL.navy));
  hRow.height = 22;

  const dRow = sheet.addRow(vCells);
  dRow.eachCell((c) => {
    c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
    c.alignment = { vertical: 'top', wrapText: true };
    c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
  });

  if (opts?.greenCol && opts.greenCol >= 1 && opts.greenCol <= n) {
    const g = opts.greenCol;
    const dCell = dRow.getCell(g);
    dCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.greenLight } } as ExcelJS.Fill;
    dCell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: XL.greenDark } };
  }
}

/** 8 paired action columns (Correctivas/Preventivas × descripción/responsable/
 *  fecha/prioridad) that extend the single-row table right after Causa raíz.
 *  Multiple actions of a type stack inside the same cell (one per line). */
function accRows(acc: { correctivas: any[]; preventivas: any[] }): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  const groups: Array<[string, any[]]> = [
    ['Correctivas', acc.correctivas || []],
    ['Preventivas', acc.preventivas || []],
  ];
  for (const [tipo, list] of groups) {
    rows.push({ label: `${tipo} · Descripción`, value: list.map(a => a.descripcion || '').filter(Boolean).join('\n') });
    rows.push({ label: `${tipo} · Responsable`, value: list.map(a => a.responsable || '').filter(Boolean).join('\n') });
    rows.push({ label: `${tipo} · Fecha`, value: list.map(a => (a.fecha ? formatFechaLarga(a.fecha, true) : '')).filter(Boolean).join('\n') });
    rows.push({ label: `${tipo} · Prioridad`, value: list.map(a => (a.prioridad ? prioLabels[a.prioridad] || '' : '')).filter(Boolean).join('\n') });
  }
  return rows;
}

/* ==========================================================================
   Image Helpers — embed the canvas-rendered diagrams (Ishikawa / Pareto)
   ========================================================================== */

/** Reserves vertical space under an image so following content doesn't overlap.
 *  Excel images are floating overlays; we give the spacer row enough height
 *  (points ≈ px × 0.75). */
function reserveImageSpace(sheet: ExcelJS.Worksheet, displayHeight: number, afterRow: number): void {
  const spacer = sheet.getRow(afterRow);
  spacer.height = Math.min(displayHeight * 0.75 + 5, 400);
}

/** Excel column width (in chars) that matches a pixel width so the header
 *  bar aligns with the embedded diagram. */
function excelColWidthForPx(px: number): number {
  return Math.min(255, Math.max(10, Math.round((px - 5) / 7)));
}

/** Creates a dedicated sheet: navy title bar with the tab name (width of the
 *  diagram) + blue section header ('Análisis #x — máquina') + embedded image
 *  directly below, with no empty rows in between. */
function addImageSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  img: { imgData: string; width: number; height: number } | null,
  emptyText: string,
  displayWidth: number,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(name);
  sheet.getColumn(1).width = excelColWidthForPx(displayWidth);

  const tRow = sheet.addRow([title]);
  applyRowStyle(tRow, headerStyle(XL.navy));
  tRow.height = 28;

  const sRow = sheet.addRow([subtitle]);
  applyRowStyle(sRow, headerStyle(XL.blue));
  sRow.height = 20;

  if (!img) {
    sheet.addRow([emptyText]);
    return sheet;
  }
  const displayHeight = Math.round((img.height / img.width) * displayWidth);
  const imageId = wb.addImage({ base64: img.imgData, extension: 'png' });
  sheet.addImage(imageId, { tl: { col: 0, row: 2 }, ext: { width: displayWidth, height: displayHeight } });
  reserveImageSpace(sheet, displayHeight, 3);
  return sheet;
}

/** Adds a blue section header (width of the diagram) + embedded image
 *  directly below, no empty rows in between. */
function addImageSection(
  sheet: ExcelJS.Worksheet,
  wb: ExcelJS.Workbook,
  title: string,
  img: { imgData: string; width: number; height: number } | null,
  emptyText: string,
  displayWidth: number,
): void {
  const hRow = sheet.addRow([title]);
  applyRowStyle(hRow, headerStyle(XL.blue));
  if (!img) {
    sheet.addRow([emptyText]);
    return;
  }
  const displayHeight = Math.round((img.height / img.width) * displayWidth);
  const imageId = wb.addImage({ base64: img.imgData, extension: 'png' });
  // Anchor at the first empty row after the header (tl.row is 0-based)
  sheet.addImage(imageId, { tl: { col: 0, row: sheet.rowCount }, ext: { width: displayWidth, height: displayHeight } });
  sheet.addRow([]); // spacer row to reserve the image's height
  reserveImageSpace(sheet, displayHeight, sheet.rowCount);
}

/* ==========================================================================
   Shared: Información del Problema rows (PDF-consistent labels + formats)
   ========================================================================== */

function capturaRows(cap: any): Array<{ label: string; value: string }> {
  return [
    { label: 'Máquina / Equipo', value: cap.maquina || '' },
    { label: 'Fecha(s)', value: formatFechas(cap.fecha) },
    { label: 'Tiempo de paro', value: formatTiempoParo(cap.tiempoParo || '') },
    { label: 'Indicador(es) afectados', value: cap.indicador || '' },
    { label: 'Problema', value: cap.problema || '' },
    { label: 'Síntomas', value: splitTextValues(cap.sintomas || '').join('\n') },
    { label: 'Responsable', value: cap.responsable || '' },
  ];
}

function whysRows(whys: any): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  for (let i = 1; i <= 5; i++) {
    rows.push({ label: `Por qué #${i}`, value: (whys as unknown as Record<string, string>)[`why${i}`] || '' });
  }
  return rows;
}

/** Causa raíz — matches the web app / PDF exactly. The web app never persists
 *  a causaRaiz field: it computes it as the deepest 'Por qué' with content
 *  (getCurrentCauseSummary). We reproduce that per-analysis so each saved
 *  analysis shows the same root cause it shows in the UI. */
function getCausaRaiz(whys: any): string {
  if (!whys) return '';
  if (whys.causaRaiz) return whys.causaRaiz;
  for (let i = 5; i >= 1; i--) {
    const v = whys[`why${i}`];
    if (v && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** Combined 'todo en un solo row' headers/values: Información (7) + 5 Porqués (5)
 *  + Causa raíz (1) + Acciones pareadas (8) = 21 columns. */
function infoHeaders(cap: any, whys: any, acc: { correctivas: any[]; preventivas: any[] }): string[] {
  return [...capturaRows(cap).map(r => r.label), ...whysRows(whys).map(r => r.label), 'Causa raíz', ...accRows(acc).map(r => r.label)];
}

function infoValues(cap: any, whys: any, acc: { correctivas: any[]; preventivas: any[] }): string[] {
  return [...capturaRows(cap).map(r => r.value), ...whysRows(whys).map(r => r.value), getCausaRaiz(whys), ...accRows(acc).map(r => r.value)];
}


/* ==========================================================================
   Export: Single Row
   ========================================================================== */

export async function exportSingleRowExcel(
  _section?: string,
  _tipo?: string,
  _index?: number
): Promise<void> {
  const data = savedRcaData;
  const workbook = new ExcelJS.Workbook();

  // ── Sheet 1: Información — TODO en un solo row (Información + 5 Porqués + Acciones) ──
  const accI = data.acciones || { correctivas: [], preventivas: [] };
  addHorizontalSheet(workbook, 'Información', 'Información del Diagnóstico',
    infoHeaders(data.captura || {}, data.whys || {}, accI),
    infoValues(data.captura || {}, data.whys || {}, accI),
    { greenCol: 13 });

  // ── Sheet 2: Pareto (imagen) ──
  const maqName = data.captura?.maquina || '';
  const paretoImg = createSimplifiedPareto(getAccumulatedParetoData(maqName));
  addImageSheet(workbook, 'Pareto', 'Pareto', `Análisis #1 — ${data.captura?.maquina || 'Sin máquina'}`, paretoImg, 'No hay datos de Pareto disponibles.', 620);

  // ── Download ──
  await downloadWorkbook(workbook, buildIndividualFilename(data.captura?.maquina, data.captura?.fecha, 'xlsx'));
}

/* ==========================================================================
   Export: All Analyses
   ========================================================================== */

export async function exportAllExcel(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, useGeneralName = true): Promise<void> {
  if (!analyses?.length) { showToast('No hay análisis guardados para exportar.', 'warning'); return; }
  const workbook = new ExcelJS.Workbook();

  // ── Agrupar análisis por máquina ──
  const machines = new Map<string, Array<{ num: number; data: RCAData }>>();
  analyses.forEach((analysis, idx) => {
    const m = (analysis.data.captura?.maquina || '').trim() || 'Sin máquina';
    if (!machines.has(m)) machines.set(m, []);
    machines.get(m)!.push({ num: idx + 1, data: analysis.data });
  });

  // ── Sheet: Información — TODO el texto (sin resumen duplicado), agrupado por máquina ──
  const infoSheet = workbook.addWorksheet('Información');
  INFO_WIDTHS.forEach((w, i) => { infoSheet.getColumn(i + 1).width = w; });

  const infoTitleRow = infoSheet.addRow(['Información de Diagnósticos', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  applyRowStyle(infoTitleRow, headerStyle(XL.navy));
  infoTitleRow.height = 28;
  infoSheet.mergeCells(1, 1, 1, 21);

  machines.forEach((entries, machine) => {
    entries.forEach(({ num, data }) => {
      // Información + 5 Porqués + Acciones — un solo header (tipo + máquina) + labels por columna + un solo row de datos
      const hRow = infoSheet.addRow([`Análisis #${num} — Información, 5 Porqués y Acciones · ${machine}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
      applyRowStyle(hRow, headerStyle(XL.blue));
      infoSheet.mergeCells(infoSheet.rowCount, 1, infoSheet.rowCount, 21);
      const whys = data.whys || {};
      const acc = data.acciones || { correctivas: [], preventivas: [] };
      addHorizontalBlock(infoSheet, infoHeaders(data.captura || {}, whys, acc), infoValues(data.captura || {}, whys, acc), { greenCol: 13 });
    });
  });

  // ── Sheet: Pareto — una gráfica por análisis (datos acumulados por máquina) ──
  const paretoSheet = workbook.addWorksheet('Pareto');
  paretoSheet.getColumn(1).width = excelColWidthForPx(620);
  const paretoTitleRow = paretoSheet.addRow(['Pareto']);
  applyRowStyle(paretoTitleRow, headerStyle(XL.navy));
  paretoTitleRow.height = 28;

  machines.forEach((entries, machine) => {
    const realName = machine === 'Sin máquina' ? '' : machine;
    entries.forEach(({ num }) => {
      const paretoImg = createSimplifiedPareto(getAccumulatedParetoData(realName));
      addImageSection(paretoSheet, workbook, `Análisis #${num} — ${machine}`, paretoImg, 'No hay datos de Pareto disponibles.', 620);
    });
  });

  const fName = useGeneralName ? buildGeneralName(analyses, 'xlsx') : buildIndividualFilename(analyses[0].data.captura?.maquina, analyses[0].data.captura?.fecha, 'xlsx');
  await downloadWorkbook(workbook, fName);
}

/* ==========================================================================
   Export: Flat Tables (Todos los Datos view)
   One plain sheet per section (Captura / 5 Porqués / Plan) — a single
   header row and one row per record, matching the table rows on screen.
   ========================================================================== */

export interface FlatSheetTable {
  name: string;
  headers: string[];
  rows: string[][];
}

export async function exportFlatSheets(
  sheets: FlatSheetTable[],
  filterLabel: string,
  analyses: Array<{ id: string; savedAt: string; data: RCAData }>,
): Promise<void> {
  if (!sheets.length) { showToast('No hay datos para exportar.', 'warning'); return; }
  const workbook = new ExcelJS.Workbook();

  sheets.forEach(table => {
    const ws = workbook.addWorksheet(table.name);
    const n = table.headers.length;
    INFO_WIDTHS.slice(0, n).forEach((w, i) => { ws.getColumn(i + 1).width = w; });

    // Title row (merged) with the applied filter info
    const title = filterLabel
      ? `Todos los Datos — ${table.rows.length} registro${table.rows.length === 1 ? '' : 's'} · ${filterLabel}`
      : `Todos los Datos — ${table.rows.length} registro${table.rows.length === 1 ? '' : 's'}`;
    const tRow = ws.addRow([title, ...Array(Math.max(n - 1, 0)).fill('')]);
    applyRowStyle(tRow, headerStyle(XL.navy));
    tRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
    tRow.height = 28;
    ws.mergeCells(1, 1, 1, n);

    // Column headers row
    const hRow = ws.addRow(table.headers);
    applyRowStyle(hRow, headerStyle(XL.blue));
    hRow.height = 22;

    // Data rows (zebra striping + wrap text)
    table.rows.forEach((r, idx) => {
      const dRow = ws.addRow(r);
      dRow.eachCell((c) => {
        c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
        c.alignment = { vertical: 'top', wrapText: true };
        c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
        if (idx % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.grayBg } } as ExcelJS.Fill;
      });
    });

    // Freeze the title + header rows so the header stays visible while scrolling
    ws.views = [{ state: 'frozen', ySplit: 2 }];
  });

  await downloadWorkbook(workbook, buildGeneralName(analyses, 'xlsx'));
}

/* ==========================================================================
   Export: Premium (from wizard) — mirrors the PDF wizard structure
   ========================================================================== */

export async function exportExcel(updateIshikawaForMachine: (machine: string, data: any, problem: string) => void): Promise<void> {
  try {
    recordRootCauseForPareto(getCurrentCauseSummary);
    const machineIshikawa = (document.getElementById('maquina') as HTMLSelectElement)?.value?.trim() || '';
    const problemIshikawa = (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() || '';
    if (machineIshikawa && problemIshikawa && rcaData.ishikawa) {
      updateIshikawaForMachine(machineIshikawa, rcaData.ishikawa, problemIshikawa);
    }

    const workbook = new ExcelJS.Workbook();

    // ── Sheet 1: Información — TODO en un solo row (Información + 5 Porqués + Acciones) ──
    addHorizontalSheet(workbook, 'Información', 'Información del Diagnóstico',
      infoHeaders(rcaData.captura || {}, rcaData.whys || {}, rcaData.acciones || { correctivas: [], preventivas: [] }),
      infoValues(rcaData.captura || {}, rcaData.whys || {}, rcaData.acciones || { correctivas: [], preventivas: [] }),
      { greenCol: 13 });

    // ── Sheet 2: Pareto (imagen) ──
    const maqName = rcaData.captura?.maquina || '';
    const paretoImg = createSimplifiedPareto(getAccumulatedParetoData(maqName));
    addImageSheet(workbook, 'Pareto', 'Pareto', `Análisis #1 — ${rcaData.captura?.maquina || 'Sin máquina'}`, paretoImg, 'No hay datos de Pareto disponibles.', 620);

    await downloadWorkbook(workbook, buildIndividualFilename(rcaData.captura?.maquina, rcaData.captura?.fecha, 'xlsx'));
  } catch (error: any) {
    handleError(error, 'generar el Excel');
  }
}

/* ==========================================================================
   Helpers
   ========================================================================== */

const prioLabels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };

function buildGeneralName(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, ext: string): string {
  const dates: string[] = [];
  analyses.forEach(a => { a.data.captura?.fecha?.forEach(d => { if (d) dates.push(d); }); });
  const parts = ['Diagnóstico_General', String(analyses.length) + '_análisis'];
  if (dates.length > 0) {
    const sorted = [...new Set(dates)].sort();
    const first = formatDateDDMMYYYY(sorted[0]);
    const last = sorted.length > 1 ? formatDateDDMMYYYY(sorted[sorted.length - 1]) : '';
    if (last && last !== first) parts.push(first + '_a_' + last);
    else parts.push(first);
  }
  return parts.join('_').replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ]/g, '') + '.' + ext;
}

async function downloadWorkbook(workbook: ExcelJS.Workbook, filename: string): Promise<void> {
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = new Uint8Array(rawBuffer);
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const result = await saveBlob(blob, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (result === 'saved' || result === 'fallback') showToast('Excel exportado correctamente.', 'success');
  else if (result === 'cancelled') showToast('Exportación cancelada.', 'warning');
}
