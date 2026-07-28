import { rcaData, savedRcaData, CATEGORY_ORDER, type ExportHistoryEntry, type RCAData } from '../state/store';
import { formatDateDDMMYYYY } from '../utils/text';
import { showToast } from '../utils/toast';
import { handleError } from '../utils/errorHandler';
import { getCurrentCauseSummary } from '../state/store';
import { createSimplifiedIshikawa, createSimplifiedPareto, buildIndividualFilename } from './exportPDF';
import { recordRootCauseForPareto } from './pareto';
import { getIshikawaHistory } from './ishikawaHistory';
import { getAccumulatedParetoData } from './pareto';
import ExcelJS from 'exceljs';

/* ==========================================================================
   Excel Export — Premium Modern Design
   Data goes LEFT TO RIGHT (horizontal rows)
   ========================================================================== */

const XL = {
  navy: 'FF1E3A5F', blue: 'FF2563EB', sky: 'FFE0F2FE',
  slate: 'FF64748B', slateDark: 'FF1E293B', white: 'FFFFFFFF',
  grayBg: 'FFF9FAFB', grayBorder: 'FFE5E7EB',
  green: 'FF16A34A', amber: 'FFD97706', red: 'FFDC2626',
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
   Sheet Builder: creates a horizontal table with labeled rows
   ========================================================================== */

function addHorizontalSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  rows: Array<{ label: string; value: string }>,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(name);    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 58;

  // Title row (merged)
  const tRow = sheet.addRow([title, '']);
  applyRowStyle(tRow, headerStyle(XL.navy));
  tRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
  tRow.height = 28;
  sheet.mergeCells(1, 1, 1, 2);

  // Data rows (label | value horizontally)
  rows.forEach((r, i) => {
    const row = sheet.addRow([r.label, r.value || '—']);
    const bg = i % 2 === 0 ? XL.grayBg : undefined;
    row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: XL.navy } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg || XL.sky } } as ExcelJS.Fill;
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
    row.getCell(1).border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.navy } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
    row.getCell(2).font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
    if (bg) {
      row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as ExcelJS.Fill;
    }
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    row.getCell(2).border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
  });

  return sheet;
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

  // ── Sheet 1: Resumen ──
  const cap = data.captura || {};
  const fechasStr = (cap.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');
  addHorizontalSheet(workbook, 'Información', 'Información del Problema', [
    { label: 'Máquina / Equipo', value: cap.maquina || '' },
    { label: 'Problema', value: cap.problema || '' },
    { label: 'Fecha(s)', value: fechasStr },
    { label: 'Tiempo de Paro (min)', value: cap.tiempoParo || '' },
    { label: 'Indicador Afectado', value: cap.indicador || '' },
    { label: 'Síntomas', value: cap.sintomas || '' },
    { label: 'Responsable', value: cap.responsable || '' },
  ]);

  // ── Sheet 2: Ishikawa ──
  const ish = data.ishikawa || {};
  const icatLabels: Record<string, string> = {
    maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
    manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente',
  };
  addHorizontalSheet(workbook, 'Ishikawa', 'Diagrama Causa-Efecto', [
    ...(['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'] as const).map(c => ({
      label: icatLabels[c],
      value: ish[c] || '',
    })),
  ]);

  // ── Sheet 3: 5 Porqués ──
  const whys = data.whys || {};
  const whysRows: Array<{ label: string; value: string }> = [];
  for (let i = 1; i <= 5; i++) {
    const val = (whys as unknown as Record<string, string>)[`why${i}`] || '';
    whysRows.push({ label: `¿Por qué? #${i}`, value: val });
  }
  const whysSheet = addHorizontalSheet(workbook, '5 Porqués', 'Análisis de Causa Raíz', whysRows);
  if (whys.causaRaiz) {
    whysSheet.addRow([]);
    const crRow = whysSheet.addRow(['Causa Raíz', whys.causaRaiz]);
    applyRowStyle(crRow, { font: { bold: true, size: 10, name: 'Calibri', color: { argb: XL.white } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.green } }, alignment: { vertical: 'top', wrapText: true } });
  }

  // ── Sheet 4: Plan de Acción ──
  const acciones = data.acciones || { correctivas: [], preventivas: [] };
  const planSheet = workbook.addWorksheet('Plan de Acción');
  const planHeaders = ['Tipo', 'Descripción', 'Responsable', 'Fecha', 'Prioridad'];
  const phRow = planSheet.addRow(planHeaders);
  applyRowStyle(phRow, headerStyle(XL.navy));
  phRow.height = 22;

  // Column widths
  planSheet.getColumn(1).width = 16;
  planSheet.getColumn(2).width = 40;
  planSheet.getColumn(3).width = 22;
  planSheet.getColumn(4).width = 16;
  planSheet.getColumn(5).width = 14;

  const allActions = [
    ...acciones.correctivas.map(a => ({ ...a, tipoLabel: 'Correctiva' })),
    ...acciones.preventivas.map(a => ({ ...a, tipoLabel: 'Preventiva' })),
  ];
  allActions.forEach((a, i) => {
    const row = planSheet.addRow([a.tipoLabel, a.descripcion || '', a.responsable || '', a.fecha || '', prioLabels[a.prioridad] || '']);
    const bg = i % 2 === 0 ? undefined : XL.grayBg;
    row.eachCell((c, j) => {
      c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
      if (bg) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as ExcelJS.Fill;
      }
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };

    });
  });

  // ── Sheet 5: Pareto ──
  const paretoSheet = workbook.addWorksheet('Pareto');
  const maqName = data.captura?.maquina || '';
  const paretoItems = getAccumulatedParetoData(maqName);
  if (paretoItems.length > 0) {
    const pHeaders = ['#', 'Causa', 'Frecuencia', '% del Total', '% Acumulado'];
    const phRow = paretoSheet.addRow(pHeaders);
    applyRowStyle(phRow, headerStyle(XL.navy));
    phRow.height = 22;
    paretoSheet.getColumn(1).width = 6;
    paretoSheet.getColumn(2).width = 40;
    paretoSheet.getColumn(3).width = 16;
    paretoSheet.getColumn(4).width = 16;
    paretoSheet.getColumn(5).width = 16;

    const totalFreq = paretoItems.reduce((s, i) => s + i.frecuencia, 0);
    let cum = 0;
    paretoItems.forEach((item, i) => {
      cum += item.frecuencia;
      const pct = ((item.frecuencia / totalFreq) * 100).toFixed(1);
      const cumPct = ((cum / totalFreq) * 100).toFixed(1);
      const row = paretoSheet.addRow([String(i + 1), item.causa || '', item.frecuencia, `${pct}%`, `${cumPct}%`]);
      const bg = i % 2 === 0 ? undefined : XL.grayBg;
      row.eachCell((c) => {
        c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
        if (bg) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as ExcelJS.Fill; }
        c.alignment = { vertical: 'top', wrapText: true };
        c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
      });
    });
  } else {
    paretoSheet.addRow(['No hay datos de Pareto disponibles.']);
  }

  // ── Download ──
  await downloadWorkbook(workbook, buildIndividualFilename(data.captura?.maquina, data.captura?.fecha, 'xlsx'));
}

/* ==========================================================================
   Export: All Analyses
   ========================================================================== */

export async function exportAllExcel(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, useGeneralName = true): Promise<void> {
  if (!analyses?.length) { showToast('No hay análisis guardados para exportar.', 'warning'); return; }
  const workbook = new ExcelJS.Workbook();

  // ── Dashboard — tabla resumen vertical ──
  const dashSheet = workbook.addWorksheet('Dashboard');
  const dashHeaders = ['#', 'Máquina', 'Problema', 'Tiempo Paro (min)', 'Indicador', 'Causa Raíz', 'Fecha(s)'];
  const dhRow = dashSheet.addRow(dashHeaders);
  applyRowStyle(dhRow, headerStyle(XL.navy));
  dhRow.height = 22;
  [6, 20, 30, 14, 16, 30, 22].forEach((w, i) => { dashSheet.getColumn(i + 1).width = w; });

  analyses.forEach((analysis, idx) => {
    const d = analysis.data;
    const wCast = (d.whys || {}) as unknown as Record<string, string>;
    let causaRaiz = wCast.causaRaiz || '';
    for (let i = 5; i >= 1; i--) { if (!causaRaiz && wCast[`why${i}`]) causaRaiz = wCast[`why${i}`]; }
    const fechasStr = (d.captura?.fecha || []).map(f => formatDateDDMMYYYY(f)).join(', ');
    const row = dashSheet.addRow([
      String(idx + 1),
      d.captura?.maquina || '',
      d.captura?.problema || '',
      d.captura?.tiempoParo || '',
      d.captura?.indicador || '',
      causaRaiz,
      fechasStr,
    ]);
    const bg = idx % 2 === 0 ? undefined : XL.grayBg;
    row.eachCell((c) => {
      c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
      if (bg) { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as ExcelJS.Fill; }
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
    });
  });

  for (let idx = 0; idx < analyses.length; idx++) {
    const data = analyses[idx].data;
    const sheetName = `Análisis ${idx + 1}`.substring(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    // Title row
    const maquinaTitle = data.captura?.maquina || '';
    const fechasTitle = (data.captura?.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');
    const titleText = [`Análisis #${idx + 1}`, maquinaTitle, fechasTitle].filter(Boolean).join(' — ');
    const tRow = sheet.addRow([titleText, '', '', '', '']);
    applyRowStyle(tRow, headerStyle(XL.navy));
    tRow.height = 28;
    sheet.mergeCells(1, 1, 1, 5);

    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 55;
    sheet.getColumn(3).width = 22;
    sheet.getColumn(4).width = 18;
    sheet.getColumn(5).width = 16;

    // Helper for horizontal rows
    function addHR(label: string, value: string): void {
      const row = sheet.addRow([label, value || '—', '', '', '']);
      row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: XL.navy } };
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.sky } };
      row.getCell(1).alignment = { vertical: 'top', wrapText: true };
      row.getCell(1).border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.navy } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
      row.getCell(2).font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
      row.getCell(2).alignment = { vertical: 'top', wrapText: true };
      row.getCell(2).border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
    }

    // Captura
    sheet.addRow([]);
    const hRowCap = sheet.addRow(['Información del Problema', '', '', '', '']);
    applyRowStyle(hRowCap, headerStyle(XL.blue));
    sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);
    const cap = data.captura || {};
    addHR('Máquina / Equipo', cap.maquina || '');
    addHR('Problema', cap.problema || '');
    addHR('Fecha', (cap.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', '));
    addHR('Tiempo Paro (min)', cap.tiempoParo || '');
    addHR('Indicador', cap.indicador || '');
    addHR('Síntomas', cap.sintomas || '');
    addHR('Responsable', cap.responsable || '');

    // Ishikawa
    if (data.ishikawa && Object.values(data.ishikawa).some(v => v)) {
      sheet.addRow([]);
      const hRow = sheet.addRow(['Diagrama Causa-Efecto', '', '', '', '']);
      applyRowStyle(hRow, headerStyle(XL.blue));
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);

      const icat: Record<string, string> = {
        maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
        manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente',
      };
      (['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'] as const).forEach(c => addHR(icat[c], (data.ishikawa || {})[c] || ''));
    }

    // 5 Whys
    const whys = data.whys || {};
    const wCast = whys as unknown as Record<string, string>;
    const hasWhys = [1, 2, 3, 4, 5].some(i => wCast[`why${i}`]);
    if (hasWhys) {
      sheet.addRow([]);
      const hRow = sheet.addRow(['5 Porqués', '', '', '', '']);
      applyRowStyle(hRow, headerStyle(XL.blue));
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);

      const w = whys as unknown as Record<string, string>;
      for (let i = 1; i <= 5; i++) addHR(`¿Por qué? #${i}`, w[`why${i}`] || '');
      if (whys.causaRaiz) {
        sheet.addRow([]);
        const crRow = sheet.addRow(['Causa Raíz', whys.causaRaiz, '', '', '']);
        applyRowStyle(crRow, { font: { bold: true, size: 10, name: 'Calibri', color: { argb: XL.white } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.green } }, alignment: { vertical: 'top', wrapText: true } });
      }
    }

    // Plan de Acción
    const acc = data.acciones || { correctivas: [], preventivas: [] };
    const hasPlan = acc.correctivas.length > 0 || acc.preventivas.length > 0;
    if (hasPlan) {
      sheet.addRow([]);
      const hRow = sheet.addRow(['Plan de Acción', '', '', '', '']);
      applyRowStyle(hRow, headerStyle(XL.blue));
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);

      const phRow = sheet.addRow(['Tipo', 'Descripción', 'Responsable', 'Fecha', 'Prioridad']);
      applyRowStyle(phRow, headerStyle(XL.navy));

      const allActs = [
        ...acc.correctivas.map(a => ({ ...a, tipoLabel: 'Correctiva' })),
        ...acc.preventivas.map(a => ({ ...a, tipoLabel: 'Preventiva' })),
      ];
      allActs.forEach((a, i) => {
        const row = sheet.addRow([a.tipoLabel, a.descripcion || '', a.responsable || '', a.fecha || '', prioLabels[a.prioridad] || '']);
      const bg = i % 2 === 0 ? undefined : XL.grayBg;
      row.eachCell((c, j) => {
        c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
        if (bg) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as ExcelJS.Fill;
        }
          c.alignment = { vertical: 'top', wrapText: true };
          c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
        });
      });
    }
  }

  const fName = useGeneralName ? buildGeneralName(analyses, 'xlsx') : buildIndividualFilename(analyses[0].data.captura?.maquina, analyses[0].data.captura?.fecha, 'xlsx');
  await downloadWorkbook(workbook, fName);
}

/* ==========================================================================
   Export: Premium (from wizard)
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

    // ── Sheet 1: Dashboard ──
    const dashSheet = workbook.addWorksheet('Dashboard', { views: [{ state: 'frozen', ySplit: 1 }] });
    const dashHeaders = ['Fecha', 'Máquina', 'Problema', 'Indicador', 'Tipo', 'Acción Correctiva', 'Acción Preventiva', 'Status', 'Responsable', 'Fecha Fin', 'Causa Raíz'];
    const dhRow = dashSheet.addRow(dashHeaders);
    applyRowStyle(dhRow, headerStyle(XL.navy));
    dhRow.height = 22;

    dashHeaders.forEach((_, i) => {
      dashSheet.getColumn(i + 1).width = i === 0 ? 16 : i === 1 ? 18 : i === 2 ? 30 : i === 5 || i === 6 ? 30 : 16;
    });

    const accionesCorrectivas = rcaData.acciones?.correctivas || [];
    const accionesPreventivas = rcaData.acciones?.preventivas || [];
    const todasAcciones = [
      ...accionesCorrectivas.map(a => ({ ...a, tipo: 'Correctivo' })),
      ...accionesPreventivas.map(a => ({ ...a, tipo: 'Preventivo' })),
    ];
    const causaRaiz = rcaData.whys.why5 || rcaData.whys.why4 || rcaData.whys.why3 || rcaData.whys.why2 || rcaData.whys.why1 || '';

    const fechasFormatted = rcaData.captura.fecha?.map(f => formatDateDDMMYYYY(f)).filter(Boolean).join(', ') || '';
    const fechasFinFormatted = todasAcciones.map(a => a.fecha ? formatDateDDMMYYYY(a.fecha) : '').filter(Boolean).join(', ');
    const correctivoText = todasAcciones.filter(a => a.tipo === 'Correctivo').map(a => a.descripcion).filter(Boolean).join('\n');
    const preventivoText = todasAcciones.filter(a => a.tipo === 'Preventivo').map(a => a.descripcion).filter(Boolean).join('\n');
    const responsables = [...new Set(todasAcciones.map(a => a.responsable).filter(Boolean))].join(', ');

    const currentEntry: ExportHistoryEntry = {
      fecha: fechasFormatted,
      maquina: rcaData.captura.maquina || '',
      problema: rcaData.captura.problema || '',
      indicador: rcaData.captura.indicador || '',
      tipoAccion: 'Correctivo',
      correctivoText,
      preventivoText,
      status: 'Pendiente',
      responsable: (todasAcciones.length > 0 ? responsables : '') || rcaData.captura.responsable || '',
      fechaFin: fechasFinFormatted,
      causaRaiz,
      ishikawa: CATEGORY_ORDER.reduce((acc, key) => {
        acc[key] = (document.getElementById(`ishikawa-${key}`) as HTMLTextAreaElement)?.value?.trim() || '';
        return acc;
      }, {} as Record<string, string>),
    };

    const exportHistory: ExportHistoryEntry[] = JSON.parse(localStorage.getItem('exportHistory') || '[]');
    exportHistory.push(currentEntry);
    localStorage.setItem('exportHistory', JSON.stringify(exportHistory));

    exportHistory.forEach((entry, i) => {
      const row = dashSheet.addRow([
        entry.fecha, entry.maquina, entry.problema, entry.indicador || '', entry.tipoAccion,
        entry.correctivoText, entry.preventivoText, entry.status || 'Pendiente',
        entry.responsable, entry.fechaFin, entry.causaRaiz,
      ]);
      const bg = i % 2 === 0 ? undefined : XL.grayBg;
      row.eachCell((c) => {
        c.font = { size: 9.5, name: 'Calibri', color: { argb: XL.slateDark } };
        if (bg) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } } as ExcelJS.Fill;
      }
        c.alignment = { vertical: 'top', wrapText: true };
        c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
      });
    });

    // ── Sheet 2: Ishikawa ──
    const ish = rcaData.ishikawa || {};
    const icatLabels: Record<string, string> = {
      maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
      manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente',
    };
    addHorizontalSheet(workbook, 'Ishikawa', 'Diagrama Causa-Efecto', (['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'] as const).map(c => ({
      label: icatLabels[c],
      value: ish[c] || '',
    })));

    // ── Sheet 3: 5 Porqués ──
    const whys = rcaData.whys || {};
    const whysData: Array<{ label: string; value: string }> = [];
    const w2 = whys as unknown as Record<string, string>;
  for (let i = 1; i <= 5; i++) whysData.push({ label: `¿Por qué? #${i}`, value: w2[`why${i}`] || '' });
    const whysSheet2 = addHorizontalSheet(workbook, '5 Porqués', 'Análisis de Causa Raíz', whysData);
    if (whys.causaRaiz) {
      whysSheet2.addRow([]);
      const crRow2 = whysSheet2.addRow(['Causa Raíz', whys.causaRaiz]);
      applyRowStyle(crRow2, { font: { bold: true, size: 10, name: 'Calibri', color: { argb: XL.white } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.green } }, alignment: { vertical: 'top', wrapText: true } });
    }

    // ── Sheet 4: Pareto ──
    const paretoSheet = workbook.addWorksheet('Pareto');
    const maqName = rcaData.captura?.maquina || '';
    const paretoItems = getAccumulatedParetoData(maqName);
    if (paretoItems.length > 0) {
      const pHeaders = ['#', 'Causa', 'Frecuencia', '% del Total', '% Acumulado'];
      const phRow2 = paretoSheet.addRow(pHeaders);
      applyRowStyle(phRow2, headerStyle(XL.navy));
      phRow2.height = 22;
      paretoSheet.getColumn(1).width = 6;
      paretoSheet.getColumn(2).width = 40;
      paretoSheet.getColumn(3).width = 16;
      paretoSheet.getColumn(4).width = 16;
      paretoSheet.getColumn(5).width = 16;

      const totalFreq = paretoItems.reduce((s, i) => s + i.frecuencia, 0);
      let cum = 0;
      paretoItems.forEach((item, i) => {
        cum += item.frecuencia;
        const pct = ((item.frecuencia / totalFreq) * 100).toFixed(1);
        const cumPct = ((cum / totalFreq) * 100).toFixed(1);
        const row = paretoSheet.addRow([String(i + 1), item.causa || '', item.frecuencia, `${pct}%`, `${cumPct}%`]);
    const bg2 = i % 2 === 0 ? undefined : XL.grayBg;
    row.eachCell((c) => {
      c.font = { size: 10, name: 'Calibri', color: { argb: XL.slateDark } };
      if (bg2) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg2 } } as ExcelJS.Fill;
      }
          c.alignment = { vertical: 'top', wrapText: true };
          c.border = { top: { style: 'thin', color: { argb: XL.grayBorder } }, bottom: { style: 'thin', color: { argb: XL.grayBorder } }, left: { style: 'thin', color: { argb: XL.grayBorder } }, right: { style: 'thin', color: { argb: XL.grayBorder } } };
        });
      });
    } else {
      paretoSheet.addRow(['No hay datos de Pareto disponibles.']);
    }

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
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Excel exportado correctamente.', 'success');
}
