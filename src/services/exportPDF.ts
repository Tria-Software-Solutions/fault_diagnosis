import { rcaData, savedRcaData, getCurrentCauseSummary, type ParetoItem, type RCAData } from '../state/store';
import { formatDateDDMMYYYY, splitTextValues } from '../utils/text';
import { createIshikawaImage, roundRect } from './ishikawaRenderer';
import { showToast } from '../utils/toast';
import { saveBlob } from '../utils/download';
import { handleError } from '../utils/errorHandler';
import { recordRootCauseForPareto } from './pareto';
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
  navyDark:  '#0f172a',
  blue:      '#2563eb',
  slate:     '#64748b',
  slateDark: '#1e293b',
  slateMid:  '#475569',
  grayBg:    '#f8fafc',
  grayLight: '#f1f5f9',
  grayBorder:'#e2e8f0',
  softGray: '#8899b4',
  white:     '#ffffff',
};

// [left, top, right, bottom] — top/bottom must stay larger than the
// full-bleed header/footer bars (pdfmake clips them if they overflow).
// Header bar ≈ 81pt tall with a single-line subtitle, but the long modern
// date strings can wrap the subtitle to 2 lines (≈ 90.8pt), so top 92 keeps
// the header fully framed on all sides without risking it being clipped.
const M: [number, number, number, number] = [22, 92, 22, 36];
// Body content uses a single font size — only header/section titles keep hierarchy.
const F = { body: 9 };
const S = {
  sectionGap: [2, 4, 0, 8] as [number, number, number, number],
  fieldGap: [0, 5, 0, 5] as [number, number, number, number],
};
let _logoCache: string | null = null;
let _boldFontLoaded = false;

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
  const p = ['Diagnóstico_General'];
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

/** Loads the true Roboto-Bold (700) webfont and registers it as the bold
 *  variant of the Roboto family. pdfmake's bundled vfs only ships
 *  Roboto-Medium (500) for bold, which renders too light for the labels.
 *  Idempotent — fetches once and registers once. */
async function loadBoldFont(): Promise<void> {
  if (_boldFontLoaded) return;
  try {
    const resp = await fetch('/Roboto-Bold.ttf');
    const blob = await resp.blob();
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1] || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
    if (!base64) return;
    // IMPORTANT: must use addVirtualFileSystem (not pm.vfs[key] = ...) — pdfmake
    // reads fonts from its internal VirtualFileSystem storage, and only this API
    // (or the vfs setter, which calls it) actually populates that storage.
    const pm = pdfMake as unknown as { addVirtualFileSystem: (vfs: Record<string, string>) => void; fonts: Record<string, Record<string, string>> };
    pm.addVirtualFileSystem({ 'Roboto-Bold.ttf': base64 });
    pm.fonts = {
      Roboto: {
        normal: 'Roboto-Regular.ttf',
        bold: 'Roboto-Bold.ttf',
        italics: 'Roboto-Italic.ttf',
        bolditalics: 'Roboto-MediumItalic.ttf',
      },
    };
    _boldFontLoaded = true;
  } catch { /* keep default Medium bold if the font can't be fetched */ }
}

/* ==========================================================================
   Premium Header & Footer — ZERO canvas elements (avoids pdfmake processCanvas bug)
   Full-bleed navy bars, clean and consistent: no accent strips. Inner padding
   is matched to the page margins so header/footer content aligns with the body.
   ========================================================================== */

/** Custom table layout for the full-bleed bars. CRITICAL: in pdfmake 0.3.11
 *  cell-level `padding` is IGNORED — only the layout's padding* functions are
 *  honored (verified empirically in the PDF content stream). The padding must
 *  therefore be expressed as layout functions, otherwise the header/footer
 *  framing silently disappears. */
function barLayout(padding: [number, number, number, number]): TableLayout {
  const [pt, pr, pb, pl] = padding; // [top, right, bottom, left]
  return {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    hLineColor: () => C.grayBorder,
    vLineColor: () => C.grayBorder,
    paddingLeft: () => pl,
    paddingRight: () => pr,
    paddingTop: () => pt,
    paddingBottom: () => pb,
  };
}

/** Full-width coloured bar (header/footer background) — explicit 4-side padding */
function bar(inner: Content, padding: [number, number, number, number]): Content {
  return {
    layout: barLayout(padding),
    table: {
      widths: ['*'],
      body: [[
        { stack: [inner], fillColor: C.navyDark } as TableCell,
      ]],
    },
    margin: [0, 0, 0, 0],
  };
}

/** Builds the inner content (logo + title + subtitle) */
function buildHeaderInner(titleText: string, subtitleText: string, logoData: string | null): Content {
  const titleStack: Content[] = [
    { text: titleText, color: C.white, bold: true, fontSize: 17, characterSpacing: 0.3 },
  ];
  if (subtitleText) {
    titleStack.push({ text: subtitleText, color: C.softGray, fontSize: 8.5, margin: [0, 3, 0, 0] });
  }
  return logoData
    ? ({
        columns: [
          { image: logoData, width: 64, fit: [64, 44] as [number, number] },
          { text: '', width: 24 },
          { stack: titleStack },
        ],
        verticalAlignment: 'middle',
      } as any)
    : { stack: titleStack };
}

function premiumHeader(title: string, subtitle: string, logoData: string | null): Content {
  // Padding [top, right, bottom, left] — balanced on all 4 sides so the content
  // (logo + title + subtitle) is evenly framed inside the navy bar: left/right
  // 36pt keep the logo clear of the page edge and the title off the right edge,
  // top/bottom 24pt give vertical breathing room. Single-line bar ≈ 81pt, or
  // ≈ 90.8pt with a 2-line wrapped subtitle — both fit inside the 92pt
  // top-margin box (M[1]) so the header is never clipped on any side.
  return {
    stack: [
      bar(buildHeaderInner(title, subtitle, logoData), [24, 36, 24, 36]),
    ],
  } as any;
}

function premiumFooter(text: string): Content {
  // Single full-bleed navy bar that fills the ENTIRE bottom-margin box (M[3] =
  // 36pt), flush with the page's bottom edge. pdfmake anchors the footer
  // content at the top of that box (y = pageHeight - pageMargins.bottom) and
  // flows it downward, so bar height = paddingTop + one text line + paddingBottom
  // must equal M[3] exactly. Never exceed it: taller content would overflow the
  // unbreakable footer block (pdfmake would span 2 pages and break the footer).
  // Style matches the header: softGray 8.5pt text (same as the header subtitle),
  // 36pt lateral padding, and vertically centered text like the header's
  // verticalAlignment 'middle' (symmetric top/bottom padding).
  const TEXT_LINE_HEIGHT = 9.961; // Roboto-Regular lineHeight at fontSize 8.5 (ascender 927.73 − descender −244.14, /1000 × 8.5)
  const padV = Math.max(0, (M[3] - TEXT_LINE_HEIGHT) / 2);
  return {
    stack: [
      bar({ text, color: C.softGray, fontSize: 8.5, alignment: 'center' }, [padV, 36, padV, 36]),
    ],
  } as any;
}

/* ==========================================================================
   Layout Primitives
   ========================================================================== */

function sectionTitle(text: string): Content {
  // Same visual language as the info blocks used in the 5 Porqués section:
  // blue accent bar on the left + light gray background + bold navy text.
  return {
    layout: 'noBorders',
    table: {
      widths: [4, '*'],
      body: [[
        { text: '', fillColor: C.blue },
        {
          stack: [{ text: `  ${text}`, color: C.navy, bold: true, fontSize: 11.5, margin: [0, 3, 0, 3] }],
          fillColor: C.grayBg,
        },
      ]],
    },
    margin: S.sectionGap,
  };
}

function field(label: string, value: string): Content | null {
  if (!value) return null;
  // Bold label (no uppercase) + value, both on the same row (inline styles on one text node)
  return {
    text: [
      { text: `${label}: `, color: C.navy, fontSize: F.body, bold: true },
      { text: value, color: C.slateDark, fontSize: F.body },
    ],
    margin: S.fieldGap,
  } as any;
}

function noticeBlock(text: string): Content {
  return { text, fontSize: F.body, color: C.slate, italics: true, margin: [2, 4, 0, 4] };
}

function priorityBadge(p: string): Content {
  const labels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  return { text: labels[p] || p.toUpperCase(), color: C.slateMid, fontSize: F.body, alignment: 'center', italics: true };
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
  const blocks: Content[] = [{ text: label, bold: true, fontSize: F.body, color: C.navy, margin: [0, 5, 0, 2] }];
  if (!list.length) { blocks.push(noticeBlock('No se registraron acciones.')); return blocks; }
  // Header cells never wrap — every label stays on a single row (noWrap: true).
  // The Prioridad column is 'auto' so it sizes to fit the header text instead of
  // squeezing it into a fixed 30pt box (which forced 'Prioridad' to wrap).
  const body: TableCell[][] = [[
    { text: '#', color: C.navy, bold: true, fontSize: F.body, noWrap: true },
    { text: 'Descripción', color: C.navy, bold: true, fontSize: F.body, noWrap: true },
    { text: 'Responsable', color: C.navy, bold: true, fontSize: F.body, noWrap: true },
    { text: 'Fecha', color: C.navy, bold: true, fontSize: F.body, noWrap: true },
    { text: 'Prioridad', color: C.navy, bold: true, fontSize: F.body, noWrap: true },
  ]];
  list.forEach((a, i) => {
    body.push([
      { text: String(i + 1), fontSize: F.body, color: C.slate, alignment: 'center' },
      { text: a.descripcion || '', fontSize: F.body, color: C.slateDark },
      { text: a.responsable || '', fontSize: F.body, color: C.slate },
      // Same modern Spanish format as 'Información del Problema' (e.g. "lunes 23 de agosto de 2026")
      { text: formatFechaLarga(a.fecha || '', true), fontSize: F.body, color: C.slate },
      priorityBadge(a.prioridad || ''),
    ]);
  });
  // Fixed column widths (only Descripción is flexible) so 'Acciones Correctivas'
  // and 'Acciones Preventivas' render with IDENTICAL column widths regardless of
  // each table's content — 'auto' columns used to size per-table and made them
  // look different. Widths fit the longest header/value: Responsable ~70,
  // Fecha ~180 (bulletproof for the longest modern date "miércoles 29 de septiembre de 2026"
  //  ≈ 165-175pt text + 10pt padding, so it never wraps on one line),
  // Prioridad ~60 (header + badges).
  blocks.push({ layout: actionTableLayout, table: { headerRows: 1, widths: [16, '*', 70, 180, 60], body }, margin: [0, 0, 0, 3] });
  return blocks;
}

/* ==========================================================================
   Content Builders
   ========================================================================== */

/* ==========================================================================
   Modern Spanish date formatting — "lunes 23 de agosto - jueves 26 de agosto de 2026"
   ========================================================================== */

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Formatea una fecha ISO como "lunes 23 de agosto" (+ "de 2026" si includeYear) */
export function formatFechaLarga(iso: string, includeYear: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  const dia = DIAS_ES[new Date(y, m - 1, d).getDay()] || '';
  const base = `${dia} ${d} de ${MESES_ES[m - 1]}`;
  return includeYear ? `${base} de ${y}` : base;
}

/** Formatea una lista de fechas ISO en español moderno:
 *  - 1 fecha:        "lunes 23 de agosto de 2026"
 *  - mismo año:      "lunes 23 de agosto - jueves 26 de agosto de 2026"
 *  - años distintos: "lunes 29 de diciembre de 2025 - jueves 2 de enero de 2026" */
export function formatFechas(fechas: string[] | string | undefined): string {
  const list = (Array.isArray(fechas) ? fechas : []).filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return formatFechaLarga(list[0], true);
  const mismoAnio = new Set(list.map(f => f.split('-')[0])).size === 1;
  const joined = list.map(f => formatFechaLarga(f, !mismoAnio)).join(' - ');
  return mismoAnio ? `${joined} de ${list[0].split('-')[0]}` : joined;
}

function buildSintomasList(sintomas: string): Content | null {
  if (!sintomas) return null;
  const items = splitTextValues(sintomas);
  if (!items.length) return null;
  return {
    stack: [
      { text: 'Síntomas:', color: C.navy, fontSize: F.body, bold: true, margin: S.fieldGap },
      {
        ul: items.map(i => ({ text: i, color: C.slateDark, fontSize: F.body })),
        type: 'square',
        markerColor: C.blue,
        margin: [0, 2, 0, 4],
      },
    ],
  } as any;
}

/** Formatea minutos como duración en español moderno con palabras:
 *  45  → "45 minutos" · 60 → "1 hora" · 98 → "1 hora y 38 minutos"
 *  125 → "2 horas y 5 minutos" · 0 → "0 minutos" */
export function formatTiempoParo(minutes: string): string {
  if (!minutes) return '';
  const total = parseInt(minutes, 10);
  if (isNaN(total) || total < 0) return minutes;
  const hrs = Math.floor(total / 60);
  const mins = total % 60;
  const hora = hrs === 1 ? 'hora' : 'horas';
  const min = mins === 1 ? 'minuto' : 'minutos';
  if (hrs === 0) return `${mins} ${min}`;
  if (mins === 0) return `${hrs} ${hora}`;
  return `${hrs} ${hora} y ${mins} ${min}`;
}

function buildCapturaContent(cap: any): Content[] {
  return [
    field('Máquina / Equipo', cap.maquina || ''),
    field('Fecha(s)', formatFechas(cap.fecha)),
    field('Tiempo de paro', formatTiempoParo(cap.tiempoParo || '')),
    field('Indicador(es) afectados', cap.indicador || ''),
    field('Responsable', cap.responsable || ''),
    field('Problema', cap.problema || ''),
    buildSintomasList(cap.sintomas || ''),
  ].filter(Boolean) as Content[];
}

function buildIshikawaContent(ish: Record<string, string | undefined>, problema: string): Content[] {
  // Only the diagram — category texts are not repeated in the PDF.
  const cats: Content[] = [];
  const hasData = Object.values(ish).some(v => v && String(v).trim());
  if (hasData) {
    const img = createIshikawaImage(ish, problema, 4);
    if (img?.imgData) {
      const iw = 470;
      cats.push({ image: img.imgData, width: iw, height: (img.height / img.width) * iw, alignment: 'center', margin: [0, 6, 0, 0] });
    } else {
      cats.push(noticeBlock('No se pudo generar el diagrama de Ishikawa.'));
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
    const f = field(`Por qué #${i}`, val);
    if (f) blocks.push(f);
  }
  const cr = whys.causaRaiz || getCurrentCauseSummary();
  const cf = field('Causa raíz', cr);
  if (cf) blocks.push(cf);
  return blocks;
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

/** Adds a bottom margin to a content item, preserving any existing margin.
 *  NOTE: content-node margins use [left, top, right, bottom] order (unlike
 *  table-cell padding, which is [top, right, bottom, left]). */
function withBottomMargin(item: Content, bottom: number): Content {
  if (typeof item !== 'object' || item === null) return item;
  const o = item as { margin?: number | [number, number] | [number, number, number, number] };
  const m = o.margin;
  let left = 0, top = 0, right = 0;
  if (typeof m === 'number') { left = m; top = m; right = m; }
  else if (Array.isArray(m)) {
    if (m.length === 2) { left = m[0]; top = m[1]; right = m[0]; }
    else if (m.length >= 4) { left = m[0]; top = m[1]; right = m[2]; }
  }
  return { ...o, margin: [left, top, right, bottom] } as Content;
}

function sectionGroup(title: string, items: Content[], keepTogether = 1): Content[] {
  const first = items.slice(0, keepTogether).filter(Boolean);
  const rest = items.slice(keepTogether).filter(Boolean);
  const st = sectionTitle(title);
  const out: Content[] = first.length === 0
    ? [st, ...rest]
    : [{ stack: [st, ...first], unbreakable: true }, ...rest];
  // Generous breathing room after each section (before the next section title)
  return out.map((item, i) => (i === out.length - 1 ? withBottomMargin(item, 30) : item));
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
    info: { title: opts.filename.replace('.pdf', ''), author: 'Reporte de Diagnóstico de Fallas' },
    content,
    header: () => premiumHeader(opts.title, opts.subtitle, opts.logoData),
    footer: () => premiumFooter(opts.footerText),
    defaultStyle: { font: 'Roboto', fontSize: F.body, color: C.slate },
  };
}

/* ==========================================================================
   Download helper — success toast only after the user accepts the save dialog
   ========================================================================== */

async function downloadPdf(pdfDoc: { getBlob: () => Promise<Blob> }, filename: string): Promise<void> {
  const blob = await pdfDoc.getBlob();
  const result = await saveBlob(blob, filename, 'application/pdf');
  if (result === 'saved' || result === 'fallback') showToast('PDF exportado correctamente.', 'success');
  else if (result === 'cancelled') showToast('Exportación cancelada.', 'warning');
}

/* ==========================================================================
   Export: Single Row
   ========================================================================== */

export async function exportSingleRowPDF(_section?: string, _tipo?: string, _index?: number): Promise<void> {
  const data = savedRcaData;
  const maquina = data.captura?.maquina || '';
  const fechasStr = formatFechas(data.captura?.fecha);
  const todayStr = formatFechaLarga(new Date().toISOString().split('T')[0], true);
  const subtitle = `Diagnóstico: ${maquina || 'Fallas'}  •  ${fechasStr ? `Fecha: ${fechasStr}  •  ` : ''}Generado: ${todayStr}`;
  const filename = buildIndividualFilename(data.captura?.maquina, data.captura?.fecha, 'pdf');
  const logoData = await loadLogoBase64();
  await loadBoldFont();

  const content: Content[] = [
    ...sectionGroup('Información del Problema', buildCapturaContent(data.captura || {}), 3),
    ...sectionGroup('Diagrama de Ishikawa', buildIshikawaContent(data.ishikawa || {}, data.captura?.problema || ''), 2),
    ...sectionGroup('Análisis de 5 Porqués', buildWhysContent(data.whys || {}), 2),
    ...sectionGroup('Plan de Acción', buildAccionesContent(data.acciones || { correctivas: [], preventivas: [] }), 1),
  ];

  const pdfDoc = pdfMake.createPdf(buildDoc(content, {
    title: 'Reporte de Diagnóstico de Fallas', subtitle,
    logoData, footerText: maquina ? `Reporte de ${maquina}` : 'Reporte Individual', filename,
  }));
  await downloadPdf(pdfDoc, filename);
}

/* ==========================================================================
   Export: All Analyses
   ========================================================================== */

export async function exportAllPDF(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, useGeneralName = true): Promise<void> {
  if (!analyses?.length) { showToast('No hay análisis guardados para exportar.', 'warning'); return; }
  const logoData = await loadLogoBase64();
  await loadBoldFont();
  const content: Content[] = [];

  analyses.forEach((analysis, idx) => {
    if (idx > 0) content.push({ text: '', pageBreak: 'before' });
    const data = analysis.data;
    const maquina = data.captura?.maquina || '';
    const fechasStr = formatFechas(data.captura?.fecha);
    const savedDate = analysis.savedAt ? formatFechaLarga(analysis.savedAt.split('T')[0], true) : '';
    const subtitle = [`Diagnóstico #${idx + 1}${maquina ? `: ${maquina}` : ''}`, fechasStr ? `Fecha: ${fechasStr}` : '', savedDate ? `Guardado: ${savedDate}` : ''].filter(Boolean).join('  •  ');

    content.push(
      ...sectionGroup('Información del Problema', buildCapturaContent(data.captura || {}), 3),
      ...sectionGroup('Diagrama de Ishikawa', buildIshikawaContent(data.ishikawa || {}, data.captura?.problema || ''), 2),
      ...sectionGroup('Análisis de 5 Porqués', buildWhysContent(data.whys || {}), 2),
      ...sectionGroup('Plan de Acción', buildAccionesContent(data.acciones || { correctivas: [], preventivas: [] }), 1),
    );
  });

  const todayStr = formatFechaLarga(new Date().toISOString().split('T')[0], true);
  const filename = useGeneralName ? buildGeneralFilename(analyses, 'pdf') : buildIndividualFilename(analyses[0].data.captura?.maquina, analyses[0].data.captura?.fecha, 'pdf');
  // Footer must match the report type: general exports say 'Reporte General',
  // but single-analysis exports (useGeneralName=false, e.g. the table's per-row
  // PDF button) must say 'Reporte de {máquina}' like the other specific flows.
  const firstMaquina = analyses[0]?.data.captura?.maquina || '';
  const footerText = useGeneralName
    ? 'Reporte General'
    : (firstMaquina ? `Reporte de ${firstMaquina}` : 'Reporte Individual');

  const pdfDoc = pdfMake.createPdf(buildDoc(content, {
    title: 'Reporte de Diagnóstico de Fallas',
    subtitle: `Generado: ${todayStr}`,
    logoData, footerText, filename,
  }));
  await downloadPdf(pdfDoc, filename);
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
    await loadBoldFont();
    const captura = rcaData.captura || {};
    const todayStr = formatFechaLarga(new Date().toISOString().split('T')[0], true);
    const filename = buildIndividualFilename(rcaData.captura?.maquina, rcaData.captura?.fecha, 'pdf');

    const content: Content[] = [
      ...sectionGroup('Información del Problema', buildCapturaContent(captura), 3),
      ...sectionGroup('Análisis de 5 Porqués', buildWhysContent(rcaData.whys || {}), 2),
      ...sectionGroup('Diagrama de Ishikawa', buildIshikawaContent(rcaData.ishikawa || {}, captura.problema || ''), 2),
      ...sectionGroup('Plan de Acción', buildAccionesContent(rcaData.acciones || { correctivas: [], preventivas: [] }), 1),
      ...sectionGroup('Historial de Diagramas Ishikawa', buildIshikawaHistoryContent(), 1),
    ];

    const pdfDoc = pdfMake.createPdf(buildDoc(content, {
      title: 'Reporte de Diagnóstico de Fallas',
      subtitle: `Identifica y soluciona problemas de raíz  •  Generado: ${todayStr}`,
      logoData, footerText: rcaData.captura?.maquina ? `Reporte de ${rcaData.captura.maquina}` : 'Análisis de Causa Raíz', filename,
    }));
    await downloadPdf(pdfDoc, filename);
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
