import { rcaData, savedRcaData, getCurrentCauseSummary, type ParetoItem, type RCAData } from '../state/store';
import { formatDateDDMMYYYY } from '../utils/text';
import { createIshikawaImage, roundRect } from './ishikawaRenderer';
import { showToast } from '../utils/toast';
import { handleError } from '../utils/errorHandler';
import { recordRootCauseForPareto, getAccumulatedParetoData } from './pareto';
import { getIshikawaHistory } from './ishikawaHistory';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { TDocumentDefinitions, Content, TableCell, TableLayout } from 'pdfmake/interfaces';

(pdfMake as unknown as { vfs: Record<string, string> }).vfs = pdfFonts as Record<string, string>;

/* ==========================================================================
   Constants
   ========================================================================== */

const C = {
  navy:      '#1e3a5f',
  blue:      '#2563eb',
  slate:     '#64748b',
  slateDark: '#1e293b',
  slateMid:  '#475569',
  grayBg:    '#f8fafc',
  grayLight: '#f1f5f9',
  grayBorder:'#e2e8f0',
  white:     '#ffffff',
  green:     '#16a34a',
  greenBg:   '#f0fdf4',
  amber:     '#d97706',
  red:       '#dc2626',
  slateLight:'#94a3b8',
};

const M: [number, number, number, number] = [22, 98, 22, 24];
const F = { body: 9, small: 7.5, tiny: 6.5 };
const S = {
  sectionGap: [2, 4, 0, 8] as [number, number, number, number],
  fieldGap: [0, 5, 0, 5] as [number, number, number, number],
  infoGap: [0, 4, 0, 4] as [number, number, number, number],
};
let _logoCache: string | null = null;

/* ==========================================================================
   Helpers
   ========================================================================== */

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_\-áéíóúñÁÉÍÓÚÑ\s]/g, '').trim().replace(/\s+/g, '_');
}

export function buildIndividualFilename(machine?: string, fechas?: string[], ext?: string): string {
  const p = ['Diagnóstico'];
  if (machine) p.push(sanitize(machine));
  if (fechas?.length) p.push(fechas.map(d => formatDateDDMMYYYY(d)).join('-'));
  return p.join('_') + '.' + ext;
}

function buildGeneralFilename(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, ext: string): string {
  const p = ['Diagnóstico_General', String(analyses.length) + '_análisis'];
  const dates: string[] = [];
  analyses.forEach(a => { a.data.captura?.fecha?.forEach(d => { if (d) dates.push(d); }); });
  if (dates.length) {
    const s = [...new Set(dates)].sort();
    const f = formatDateDDMMYYYY(s[0]);
    const l = s.length > 1 ? formatDateDDMMYYYY(s[s.length - 1]) : '';
    if (l && l !== f) p.push(f + '_a_' + l);
    else p.push(f);
  }
  return sanitize(p.join('_')) + '.' + ext;
}

function getRootCauseFromWhys(whys: any): string {
  if (!whys) return '';
  if (whys.causaRaiz) return whys.causaRaiz;
  for (let i = 5; i >= 1; i--) { const v = (whys[`why${i}`] as string) || ''; if (v.trim()) return v.trim(); }
  return '';
}

function recordRootCauseForExport(machine: string, rootCause: string): void {
  if (!machine || !rootCause) return;
  try {
    const h = JSON.parse(localStorage.getItem('paretoHistory') || '{}');
    if (!h[machine]) h[machine] = {};
    const k = rootCause.trim();
    h[machine][k] = (h[machine][k] || 0) + 1;
    localStorage.setItem('paretoHistory', JSON.stringify(h));
  } catch { /* ignore */ }
}

async function loadLogoBase64(): Promise<string | null> {
  if (_logoCache) return _logoCache;
  try {
    const resp = await fetch('/logo.png');
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => { _logoCache = reader.result as string; resolve(_logoCache); };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/* ==========================================================================
   Premium Header — ZERO canvas elements (avoids pdfmake processCanvas bug)
   Uses tables with fillColor for the navy bar and accent line.
   ========================================================================== */

/** Full-width coloured bar used as header background — explicit 4-side padding */
function headerBar(inner: Content, pl: number, pt: number, pr: number, pb: number): Content {
  // pdfmake padding order: [top, right, bottom, left]
  return {
    layout: 'noBorders',
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [inner],
          fillColor: '#0f172a',
          padding: [pt, pr, pb, pl] as [number, number, number, number],
        } as TableCell,
      ]],
    },
    margin: [0, 0, 0, 0],
  };
}

/** Thin accent line below the header — a blue glow effect without canvas */
function headerAccentLine(): Content {
  return {
    layout: 'noBorders',
    table: {
      widths: ['*'],
      body: [[
        { text: '', fillColor: '#2563eb', fontSize: 1, padding: [0, 0.8, 0, 0.8] } as any,
      ]],
    },
    margin: [0, 0, 0, 0],
  };
}

/** Builds the inner columns (logo + title + subtitle) shared by both headers */
function buildHeaderInner(titleText: string, subtitleText: string, logoData: string | null): Content {
  const titleStack: Content[] = [
    { text: titleText, color: C.white, bold: true, fontSize: 16 },
  ];
  if (subtitleText) {
    titleStack.push({ text: subtitleText, color: '#8899b4', fontSize: 8, margin: [0, 2, 0, 0] });
  }
  if (!logoData) {
    return { stack: titleStack } as any;
  }
  return {
    columns: [
      { image: logoData, width: 52, fit: [52, 36] as [number, number] },
      { text: '', width: 25 },
      { stack: titleStack },
    ],
    verticalAlignment: 'middle' as any,
  } as any;
}

function premiumHeader(title: string, subtitle: string, logoData: string | null): Content {
  return {
    stack: [
      headerBar(buildHeaderInner(title, subtitle, logoData), 36, 48, 36, 12),
      headerAccentLine(),
    ],
  } as any;
}

function premiumContinuationHeader(logoData: string | null, text: string): Content {
  const inner = buildHeaderInner(text, '', logoData);
  return {
    stack: [
      headerBar(inner, 36, 48, 36, 12),
      headerAccentLine(),
    ],
  } as any;
}

function premiumFooter(text: string): Content {
  return { text, color: C.slateLight, fontSize: 6, alignment: 'center', margin: [0, 4, 0, 4] };
}

/* ==========================================================================
   Layout Primitives
   ========================================================================== */

function sectionTitle(text: string): Content {
  return {
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [{ text, color: C.navy, bold: true, fontSize: 11.5 }],
          border: [false, false, false, true] as [boolean, boolean, boolean, boolean],
          borderColor: [C.white, C.white, C.white, C.blue] as [string, string, string, string],
          padding: [0, 0, 0, 5] as [number, number, number, number],
        } as TableCell,
      ]],
    },
    margin: S.sectionGap,
  };
}

function field(label: string, value: string): Content | null {
  if (!value) return null;
  return {
    stack: [
      { text: label.toUpperCase(), color: C.slateMid, fontSize: 7, bold: true, margin: [0, 0, 0, 2] },
      { text: value, color: C.slateDark, fontSize: F.body, leadingIndent: 0 },
    ],
    margin: S.fieldGap,
  };
}

function infoBlock(label: string, content: string, accentColor: string, opts?: { contentBold?: boolean }): Content | null {
  if (!content) return null;
  return {
    layout: 'noBorders',
    table: {
      widths: [4, '*'],
      body: [[
        { text: '', fillColor: accentColor },
        {
          stack: [
            { text: `  ${label}`, color: accentColor, bold: true, fontSize: 7.5, margin: [0, 3, 0, 1] },
            { text: content, color: C.slateDark, fontSize: F.body, bold: opts?.contentBold ?? false, margin: [8, 0, 5, 4] },
          ],
          fillColor: C.grayBg,
        },
      ]],
    },
    margin: S.infoGap,
  };
}

function noticeBlock(text: string): Content {
  return { text, fontSize: F.body, color: C.slate, italics: true, margin: [2, 4, 0, 4] };
}

function priorityBadge(p: string): Content {
  const labels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  return { text: labels[p] || p.toUpperCase(), color: C.slateMid, fontSize: F.small, alignment: 'center', italics: true };
}

const actionTableLayout: TableLayout = {
  fillColor: (i: number) => i % 2 === 1 ? C.grayBg : null,
  hLineWidth: () => 0.4,
  vLineWidth: () => 0.4,
  hLineColor: () => C.grayBorder,
  vLineColor: () => C.grayBorder,
  paddingLeft: () => 5,
  paddingRight: () => 5,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

function actionsTable(list: Array<{ descripcion?: string; responsable?: string; fecha?: string; prioridad?: string }>, label: string): Content[] {
  const blocks: Content[] = [{ text: label, bold: true, fontSize: 8, color: C.navy, margin: [0, 5, 0, 2] }];
  if (!list.length) { blocks.push(noticeBlock('No se registraron acciones.')); return blocks; }
  const body: TableCell[][] = [[
    { text: '#', color: C.navy, bold: true, fontSize: F.tiny },
    { text: 'Descripción', color: C.navy, bold: true, fontSize: F.tiny },
    { text: 'Responsable', color: C.navy, bold: true, fontSize: F.tiny },
    { text: 'Fecha', color: C.navy, bold: true, fontSize: F.tiny },
    { text: 'Prioridad', color: C.navy, bold: true, fontSize: F.tiny },
  ]];
  list.forEach((a, i) => {
    body.push([
      { text: String(i + 1), fontSize: F.small, color: C.slate, alignment: 'center' },
      { text: a.descripcion || '', fontSize: F.small, color: C.slateDark },
      { text: a.responsable || '', fontSize: F.small, color: C.slate },
      { text: a.fecha || '', fontSize: F.small, color: C.slate },
      priorityBadge(a.prioridad || ''),
    ]);
  });
  blocks.push({ layout: actionTableLayout, table: { headerRows: 1, widths: [16, '*', 'auto', 'auto', 30], body }, margin: [0, 0, 0, 3] });
  return blocks;
}

/* ==========================================================================
   Content Builders
   ========================================================================== */

function buildCapturaContent(cap: any, fechasStr: string): Content[] {
  return [
    field('Máquina / Equipo', cap.maquina || ''),
    field('Fecha(s)', fechasStr),
    field('Tiempo de paro (min)', cap.tiempoParo || ''),
    field('Indicador afectado', cap.indicador || ''),
    field('Responsable', cap.responsable || ''),
    { text: '', margin: [0, 2, 0, 0] },
    infoBlock('PROBLEMA', cap.problema || '', C.blue, { contentBold: true }),
    infoBlock('SÍNTOMAS', cap.sintomas || '', C.slate),
  ].filter(Boolean) as Content[];
}

function buildIshikawaContent(ish: Record<string, string | undefined>, problema: string): Content[] {
  const labels: Record<string, string> = {
    maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
    manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente',
  };
  const cats: Content[] = (['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'] as const)
    .map(c => field(labels[c], ish[c] || '')).filter(Boolean) as Content[];

  const hasData = Object.values(ish).some(v => v && String(v).trim());
  if (hasData) {
    const img = createIshikawaImage(ish, problema, 4);
    if (img?.imgData) {
      const iw = 470;
      cats.push({ image: img.imgData, width: iw, height: (img.height / img.width) * iw, alignment: 'center', margin: [0, 6, 0, 0] });
    }
  } else {
    cats.push(noticeBlock('No se registraron datos en el diagrama de Ishikawa.'));
  }
  return cats;
}

function buildWhysContent(whys: any): Content[] {
  const blocks: Content[] = [];
  for (let i = 1; i <= 5; i++) {
    const val = (whys[`why${i}`] as string) || '';
    const ib = infoBlock(`POR QUÉ #${i}`, val, C.blue);
    if (ib) blocks.push(ib);
  }
  const cr = whys.causaRaiz || getCurrentCauseSummary();
  if (cr) blocks.push(infoBlock('CAUSA RAÍZ', cr, C.green, { contentBold: true })!);
  return blocks;
}

function buildParetoContent(maquina: string, causeSummary?: string): Content[] {
  if (!maquina) return [noticeBlock('No se pudo identificar la máquina para el análisis de Pareto.')];
  if (causeSummary) recordRootCauseForExport(maquina, causeSummary);
  const items = getAccumulatedParetoData(maquina);
  if (!items.length) return [noticeBlock('No hay datos acumulados de Pareto para esta máquina.')];
  const img = createSimplifiedPareto(items);
  if (img?.imgData) return [{ image: img.imgData, width: 500, height: (img.height / img.width) * 500, alignment: 'center', margin: [0, 5, 0, 0] }];
  return [];
}

function buildAccionesContent(acciones: { correctivas: any[]; preventivas: any[] }): Content[] {
  return [
    ...actionsTable(acciones.correctivas, 'Acciones Correctivas'),
    ...actionsTable(acciones.preventivas, 'Acciones Preventivas'),
  ];
}

function buildIshikawaHistoryContent(): Content[] {
  const hist = getIshikawaHistory();
  if (!Object.keys(hist).length) return [noticeBlock('No hay historial de diagramas Ishikawa guardados.')];
  const blocks: Content[] = [];
  Object.entries(hist).forEach(([machine, entry]) => {
    if (!Object.values(entry.ishikawa || {}).some(v => v)) return;
    blocks.push({ text: `Máquina: ${machine}`, fontSize: F.body, bold: true, color: C.blue, margin: [0, 4, 0, 2] });
    const img = createIshikawaImage(entry.ishikawa, entry.problema, 4);
    if (img?.imgData) blocks.push({ image: img.imgData, width: 470, height: (img.height / img.width) * 470, alignment: 'center', margin: [0, 0, 0, 4] });
  });
  return blocks;
}

/* ==========================================================================
   Section Group — prevents orphaned section titles
   Wraps sectionTitle + first N content items in an unbreakable stack,
   so the title never appears alone at the bottom of a page.
   ========================================================================== */

function sectionGroup(title: string, items: Content[], keepTogether = 1): Content[] {
  const first = items.slice(0, keepTogether).filter(Boolean);
  const rest = items.slice(keepTogether).filter(Boolean);
  const st = sectionTitle(title);
  if (first.length === 0) {
    return [st, ...rest];
  }
  return [
    { stack: [st, ...first], unbreakable: true },
    ...rest,
  ];
}

/* ==========================================================================
   Document Builder
   ========================================================================== */

function buildDoc(content: Content[], opts: {
  title: string; subtitle: string; logoData: string | null;
  footerText: string; filename: string;
}): TDocumentDefinitions {
  return {
    pageSize: 'A4', pageMargins: M,
    info: { title: opts.filename.replace('.pdf', ''), author: 'Herramienta de Diagnóstico de Fallas' },
    content,
    header: (p: number) => p === 1
      ? premiumHeader(opts.title, opts.subtitle, opts.logoData)
      : premiumContinuationHeader(opts.logoData, opts.title),
    footer: () => premiumFooter(opts.footerText),
    defaultStyle: { font: 'Roboto', fontSize: F.body, color: C.slate },
  };
}

/* ==========================================================================
   Export: Single Row
   ========================================================================== */

export async function exportSingleRowPDF(_section?: string, _tipo?: string, _index?: number): Promise<void> {
  const data = savedRcaData;
  const maquina = data.captura?.maquina || '';
  const fechasStr = (data.captura?.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');
  const todayStr = formatDateDDMMYYYY(new Date().toISOString().split('T')[0]);
  const subtitle = `Diagnóstico: ${maquina || 'Fallas'}  •  ${fechasStr ? `Fecha: ${fechasStr}  •  ` : ''}Generado: ${todayStr}`;
  const filename = buildIndividualFilename(data.captura?.maquina, data.captura?.fecha, 'pdf');

  const content: Content[] = [
    ...sectionGroup('Información del Problema', buildCapturaContent(data.captura || {}, fechasStr), 3),
    ...sectionGroup('Diagrama de Ishikawa', buildIshikawaContent(data.ishikawa || {}, data.captura?.problema || ''), 2),
    ...sectionGroup('Análisis de 5 Porqués', buildWhysContent(data.whys || {}), 2),
    ...sectionGroup('Plan de Acción', buildAccionesContent(data.acciones || { correctivas: [], preventivas: [] }), 1),
    ...(maquina ? sectionGroup('Análisis de Pareto', buildParetoContent(maquina, getRootCauseFromWhys(data.whys)), 1) : []),
  ];

  const pdfDoc = pdfMake.createPdf(buildDoc(content, {
    title: 'Herramienta de Diagnóstico de Fallas', subtitle,
    logoData: null, footerText: 'Herramienta de Diagnóstico de Fallas — Reporte Individual', filename,
  }));
  (pdfDoc.download as (f: string, cb?: () => void) => void)(filename, () => showToast('PDF exportado correctamente.', 'success'));
}

/* ==========================================================================
   Export: All Analyses
   ========================================================================== */

export async function exportAllPDF(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, useGeneralName = true): Promise<void> {
  if (!analyses?.length) { showToast('No hay análisis guardados para exportar.', 'warning'); return; }
  const logoData = await loadLogoBase64();
  const content: Content[] = [];

  analyses.forEach((analysis, idx) => {
    if (idx > 0) content.push({ text: '', pageBreak: 'before' });
    const data = analysis.data;
    const maquina = data.captura?.maquina || '';
    const fechasStr = (data.captura?.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');
    const savedDate = analysis.savedAt ? formatDateDDMMYYYY(analysis.savedAt.split('T')[0]) : '';
    const subtitle = [`Diagnóstico #${idx + 1}${maquina ? `: ${maquina}` : ''}`, fechasStr ? `Fecha: ${fechasStr}` : '', savedDate ? `Guardado: ${savedDate}` : ''].filter(Boolean).join('  •  ');

    content.push(
      ...sectionGroup('Información del Problema', buildCapturaContent(data.captura || {}, fechasStr), 3),
      ...sectionGroup('Diagrama de Ishikawa', buildIshikawaContent(data.ishikawa || {}, data.captura?.problema || ''), 2),
      ...sectionGroup('Análisis de 5 Porqués', buildWhysContent(data.whys || {}), 2),
      ...sectionGroup('Plan de Acción', buildAccionesContent(data.acciones || { correctivas: [], preventivas: [] }), 1),
      ...(maquina ? sectionGroup('Análisis de Pareto', buildParetoContent(maquina, getRootCauseFromWhys(data.whys)), 1) : []),
    );
  });

  const todayStr = formatDateDDMMYYYY(new Date().toISOString().split('T')[0]);
  const filename = useGeneralName ? buildGeneralFilename(analyses, 'pdf') : buildIndividualFilename(analyses[0].data.captura?.maquina, analyses[0].data.captura?.fecha, 'pdf');

  const pdfDoc = pdfMake.createPdf(buildDoc(content, {
    title: 'Herramienta de Diagnóstico de Fallas',
    subtitle: `${analyses.length} análisis  •  Generado: ${todayStr}`,
    logoData, footerText: 'Herramienta de Diagnóstico de Fallas — Reporte General', filename,
  }));
  (pdfDoc.download as (f: string, cb?: () => void) => void)(filename, () => showToast('PDF exportado correctamente.', 'success'));
}

/* ==========================================================================
   Export: Premium (from wizard)
   ========================================================================== */

export function handlePDFExport(updateIshikawaForMachine: (machine: string, data: any, problem: string) => void): void {
  exportPDF(updateIshikawaForMachine).catch(error => handleError(error, 'generar el PDF'));
}

async function exportPDF(updateIshikawaForMachine: (machine: string, data: any, problem: string) => void): Promise<void> {
  try {
    recordRootCauseForPareto(getCurrentCauseSummary);
    const mIsh = rcaData.captura?.maquina || '';
    const pIsh = rcaData.captura?.problema || '';
    if (mIsh && pIsh && rcaData.ishikawa) updateIshikawaForMachine(mIsh, rcaData.ishikawa, pIsh);

    const logoData = await loadLogoBase64();
    const captura = rcaData.captura || {};
    const rawFechas = captura.fecha || [];
    let fechaStr = '';
    if (rawFechas.length === 1) fechaStr = formatDateDDMMYYYY(rawFechas[0]);
    else if (rawFechas.length >= 2) fechaStr = rawFechas.map(d => formatDateDDMMYYYY(d)).join(' — ');
    const todayStr = formatDateDDMMYYYY(new Date().toISOString().split('T')[0]);
    const filename = buildIndividualFilename(rcaData.captura?.maquina, rcaData.captura?.fecha, 'pdf');

    const content: Content[] = [
      ...sectionGroup('Información del Problema', buildCapturaContent(captura, fechaStr), 3),
      ...sectionGroup('Análisis de 5 Porqués', buildWhysContent(rcaData.whys || {}), 2),
      ...sectionGroup('Diagrama de Ishikawa', buildIshikawaContent(rcaData.ishikawa || {}, captura.problema || ''), 2),
      ...sectionGroup('Plan de Acción', buildAccionesContent(rcaData.acciones || { correctivas: [], preventivas: [] }), 1),
      ...sectionGroup('Análisis de Pareto', buildParetoContent(captura.maquina || ''), 1),
      ...sectionGroup('Historial de Diagramas Ishikawa', buildIshikawaHistoryContent(), 1),
    ];

    const pdfDoc = pdfMake.createPdf(buildDoc(content, {
      title: 'Herramienta de Diagnóstico de Fallas',
      subtitle: `Identifica y soluciona problemas de raíz  •  Generado: ${todayStr}`,
      logoData, footerText: 'Herramienta de Diagnóstico de Fallas — Análisis de Causa Raíz', filename,
    }));
    (pdfDoc.download as (f: string, cb?: () => void) => void)(filename, () => showToast('PDF exportado correctamente.', 'success'));
  } catch (error: any) {
    handleError(error, 'generar el PDF');
  }
}

/* ==========================================================================
   Chart exports
   ========================================================================== */

export { createIshikawaImage as createSimplifiedIshikawa } from './ishikawaRenderer';

interface IshikawaImageResult { imgData: string; width: number; height: number }

export function createSimplifiedPareto(paretoItems?: ParetoItem[]): IshikawaImageResult | null {
  const items = (paretoItems || []).slice().sort((a, b) => b.frecuencia - a.frecuencia);
  if (!items.length) {
    const c = document.createElement('canvas'); c.width = 500; c.height = 300;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 500, 300);
    ctx.fillStyle = '#64748b'; ctx.font = 'bold 14px Inter, Arial, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('No hay datos de Pareto disponibles', 250, 150);
    return { imgData: c.toDataURL('image/png'), width: 500, height: 300 };
  }

  const W = 700, H = 420;
  const P = { top: 60, right: 48, bottom: 90, left: 52 };
  const CW = W - P.left - P.right, CH = H - P.top - P.bottom;
  const total = items.reduce((s, i) => s + i.frecuencia, 0);
  const maxFreq = items[0].frecuencia;

  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) return null;

  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1e3a5f'; ctx.font = 'bold 15px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Análisis de Pareto', W / 2, 24);
  ctx.fillStyle = '#64748b'; ctx.font = '10px Inter, Arial, sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText(`${items.length} causas  ·  Total: ${total} ocurrencias`, W / 2, 28);

  const ySteps = 5;
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= ySteps; i++) {
    const y = P.top + CH - (CH / ySteps) * i;
    ctx.beginPath(); ctx.moveTo(P.left, y); ctx.lineTo(P.left + CW, y); ctx.stroke();
  }

  ctx.fillStyle = '#94a3b8'; ctx.font = '8px Inter, Arial, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= ySteps; i++) {
    const val = Math.round((maxFreq / ySteps) * i);
    ctx.fillText(String(val), P.left - 6, P.top + CH - (CH / ySteps) * i);
  }
  ctx.fillStyle = '#94a3b8'; ctx.font = '6.5px Inter, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('Frecuencia', P.left - 2, P.top - 4);

  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#94a3b8'; ctx.font = '8px Inter, Arial, sans-serif';
  for (let i = 0; i <= 5; i++) ctx.fillText(`${i * 20}%`, P.left + CW + 6, P.top + CH - (CH / 5) * i);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText('% Acumulado', P.left + CW + 2, P.top - 4);

  const refY = P.top + CH * 0.2;
  ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(P.left, refY); ctx.lineTo(P.left + CW, refY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#d97706'; ctx.font = 'bold 8px Inter, Arial, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText('80%', P.left + CW + 4, refY - 2);

  const n = items.length;
  const gap = 4;
  const rawW = Math.min(48, (CW - gap * (n - 1)) / n);
  const barW = rawW > 12 ? rawW : Math.max(8, (CW - 2 * (n - 1)) / n);
  const useGap = barW <= 14 ? 2 : gap;
  const totalW = n * barW + (n - 1) * useGap;
  const startX = P.left + (CW - totalW) / 2;

  const barColors = items.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    return `rgb(${Math.round(12 + 40 * t)},${Math.round(58 + 110 * t)},${Math.round(95 + 155 * t)})`;
  });

  let cum = 0;
  const pts: Array<{ x: number; y: number }> = [];

  items.forEach((item, i) => {
    cum += item.frecuencia;
    const cumPct = cum / total;
    const barH = (item.frecuencia / maxFreq) * CH;
    const x = startX + i * (barW + useGap);
    const y = P.top + CH - barH;

    ctx.fillStyle = barColors[i];
    roundRect(ctx, x, y, barW, barH, 2);
    ctx.fill();

    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 8px Inter, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(String(item.frecuencia), x + barW / 2, y - 3);

    const label = item.causa || '';
    ctx.fillStyle = '#475569'; ctx.font = '7px Inter, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const maxLW = barW + useGap;
    if (ctx.measureText(label).width > maxLW && label.length > 4) {
      const half = Math.ceil(label.length / 2);
      ctx.fillText(label.substring(0, half), x + barW / 2, P.top + CH + 5);
      ctx.fillText(label.substring(half), x + barW / 2, P.top + CH + 15);
    } else ctx.fillText(label, x + barW / 2, P.top + CH + 5);

    pts.push({ x: x + barW / 2, y: P.top + CH - cumPct * CH });
  });

  if (pts.length > 0) {
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    pts.forEach(p => {
      ctx.fillStyle = '#dc2626';
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(P.left, P.top + CH); ctx.lineTo(P.left + CW, P.top + CH); ctx.stroke();

  return { imgData: canvas.toDataURL('image/png'), width: W, height: H };
}
