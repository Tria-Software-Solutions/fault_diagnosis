import { rcaData, savedRcaData, CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, type ExportHistoryEntry, type RCAData } from '../state/store';
import { escapeHtml, formatDateDDMMYYYY } from '../utils/text';
import { showToast } from '../utils/toast';
import { handleError } from '../utils/errorHandler';
import { getCurrentCauseSummary } from '../state/store';
import { createSimplifiedIshikawa, createSimplifiedPareto, buildIndividualFilename } from './exportPDF';
import { recordRootCauseForPareto } from './pareto';
import { getIshikawaHistory, type IshikawaHistoryEntry } from './ishikawaHistory';
import { getAccumulatedParetoData } from './pareto';
import ExcelJS from 'exceljs';

/* ==========================================================================
   Excel Export Service
   Generates an .xlsx file with Report, Ishikawa, and Pareto sheets
   ========================================================================== */

/** Exports ALL sections (captura + ishikawa + 5whys + plan) as a single compact Excel file */
export async function exportSingleRowExcel(
  _section?: string,
  _tipo?: string,
  _index?: number
): Promise<void> {
  const data = savedRcaData;

  const workbook = new ExcelJS.Workbook();
  const colors = {
    navy: 'FF1E3A5F', blue: 'FF2563EB', sky: 'FFE0F2FE',
    slate: 'FF64748B', slateDark: 'FF1E293B', white: 'FFFFFFFF',
    grayBg: 'FFF9FAFB', grayBorder: 'FFE5E7EB',
    green: 'FF16A34A', amber: 'FFD97706', red: 'FFDC2626',
  };

  // ── SHEET 1: CAPTURA ──
  const capSheet = workbook.addWorksheet('Captura');
  capSheet.getColumn(1).width = 28;
  capSheet.getColumn(2).width = 55;

  const hRow = capSheet.addRow(['Captura del Problema', '']);
  hRow.eachCell(c => {
    c.font = { bold: true, size: 12, name: 'Calibri', color: { argb: colors.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  hRow.height = 28;
  capSheet.mergeCells(1, 1, 1, 2);

  function addStyledRow(sheet: ExcelJS.Worksheet, label: string, value: string): void {
    const row = sheet.addRow([label, value || '—']);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.sky } };
    row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.navy } };
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
    row.getCell(1).border = {
      top: { style: 'thin', color: { argb: colors.grayBorder } },
      bottom: { style: 'thin', color: { argb: colors.grayBorder } },
      left: { style: 'thin', color: { argb: colors.navy } },
      right: { style: 'thin', color: { argb: colors.grayBorder } },
    };
    row.getCell(2).font = { size: 10, name: 'Calibri', color: { argb: colors.slateDark } };
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    row.getCell(2).border = {
      top: { style: 'thin', color: { argb: colors.grayBorder } },
      bottom: { style: 'thin', color: { argb: colors.grayBorder } },
      left: { style: 'thin', color: { argb: colors.grayBorder } },
      right: { style: 'thin', color: { argb: colors.grayBorder } },
    };
  }

  const cap = data.captura || {};
  addStyledRow(capSheet, 'Máquina / Equipo', cap.maquina || '');
  addStyledRow(capSheet, 'Problema', cap.problema || '');
  addStyledRow(capSheet, 'Fecha', (cap.fecha || []).join(', '));
  addStyledRow(capSheet, 'Tiempo Paro', cap.tiempoParo || '');
  addStyledRow(capSheet, 'Indicador', cap.indicador || '');
  addStyledRow(capSheet, 'Síntomas', cap.sintomas || '');
  addStyledRow(capSheet, 'Responsable', cap.responsable || '');

  // ── SHEET 2: ISHIKAWA ──
  const ishSheet = workbook.addWorksheet('Ishikawa');
  ishSheet.getColumn(1).width = 28;
  ishSheet.getColumn(2).width = 55;
  const hRow2 = ishSheet.addRow(['Diagrama de Ishikawa', '']);
  hRow2.eachCell(c => {
    c.font = { bold: true, size: 12, name: 'Calibri', color: { argb: colors.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  hRow2.height = 28;
  ishSheet.mergeCells(1, 1, 1, 2);

  const ish = data.ishikawa || {};
  const icatLabels: Record<string, string> = {
    maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
    manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente'
  };
  ['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'].forEach(cat => {
    addStyledRow(ishSheet, icatLabels[cat], ish[cat] || '');
  });

  // ── SHEET 3: 5 PORQUÉS ──
  const whysSheet = workbook.addWorksheet('5 Porqués');
  whysSheet.getColumn(1).width = 28;
  whysSheet.getColumn(2).width = 55;
  const hRow3 = whysSheet.addRow(['Análisis de 5 Porqués', '']);
  hRow3.eachCell(c => {
    c.font = { bold: true, size: 12, name: 'Calibri', color: { argb: colors.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
    c.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  hRow3.height = 28;
  whysSheet.mergeCells(1, 1, 1, 2);

  const whys = data.whys || {};
  for (let i = 1; i <= 5; i++) {
    const val = (whys[`why${i}` as keyof typeof whys] as string) || '';
    addStyledRow(whysSheet, `Por qué #${i}`, val);
  }
  if (whys.causaRaiz) {
    whysSheet.addRow([]);
    const crRow = whysSheet.addRow(['Causa Raíz', whys.causaRaiz]);
    crRow.eachCell(c => {
      c.font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.white } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.green } };
      c.alignment = { vertical: 'top', wrapText: true };
    });
  }

  // ── SHEET 4: PLAN ──
  const planSheet = workbook.addWorksheet('Plan de Acción');
  const prioLabels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
  const acciones = data.acciones || { correctivas: [], preventivas: [] };

  const planHeaders = ['Tipo', 'Descripción', 'Responsable', 'Fecha', 'Prioridad'];
  const planHeaderRow = planSheet.addRow(planHeaders);
  planHeaderRow.eachCell(c => {
    c.font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.white } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = {
      top: { style: 'thin', color: { argb: colors.navy } },
      bottom: { style: 'thin', color: { argb: colors.navy } },
      left: { style: 'thin', color: { argb: colors.navy } },
      right: { style: 'thin', color: { argb: colors.navy } },
    };
  });
  planHeaderRow.height = 22;

  [...acciones.correctivas.map(a => ({ ...a, tipoLabel: 'Correctiva' })),
   ...acciones.preventivas.map(a => ({ ...a, tipoLabel: 'Preventiva' }))].forEach(a => {
    const row = planSheet.addRow([a.tipoLabel, a.descripcion || '', a.responsable || '', a.fecha || '', prioLabels[a.prioridad] || '']);
    row.eachCell(c => {
      c.alignment = { vertical: 'top', wrapText: true };
      c.border = {
        top: { style: 'thin', color: { argb: colors.grayBorder } },
        bottom: { style: 'thin', color: { argb: colors.grayBorder } },
        left: { style: 'thin', color: { argb: colors.grayBorder } },
        right: { style: 'thin', color: { argb: colors.grayBorder } },
      };
    });
  });

  planSheet.getColumn(1).width = 16;
  planSheet.getColumn(2).width = 40;
  planSheet.getColumn(3).width = 20;
  planSheet.getColumn(4).width = 16;
  planSheet.getColumn(5).width = 14;

  // ── SAVE ──
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = new Uint8Array(rawBuffer);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fName = buildIndividualFilename(data.captura?.maquina, data.captura?.fecha, 'xlsx');
  a.download = fName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Reporte exportado a Excel.', 'success');
}

/** Exports ALL saved analyses from the file as a single multi-sheet Excel workbook */
export async function exportAllExcel(analyses: Array<{ id: string; savedAt: string; data: RCAData }>): Promise<void> {
  if (!analyses || analyses.length === 0) {
    showToast('No hay análisis guardados para exportar.', 'warning');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  const colors = {
    navy: 'FF1E3A5F', blue: 'FF2563EB', sky: 'FFE0F2FE',
    slate: 'FF64748B', slateDark: 'FF1E293B', white: 'FFFFFFFF',
    grayBg: 'FFF9FAFB', grayBorder: 'FFE5E7EB',
    green: 'FF16A34A', amber: 'FFD97706', red: 'FFDC2626',
  };

  const prioLabels: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };

  for (let idx = 0; idx < analyses.length; idx++) {
    const analysis = analyses[idx];
    const data = analysis.data;
    const sheetName = `Análisis ${idx + 1}`.substring(0, 31);
    const sheet = workbook.addWorksheet(sheetName);

    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 60;
    sheet.getColumn(3).width = 20;
    sheet.getColumn(4).width = 16;
    sheet.getColumn(5).width = 14;

    function addStyledRow(label: string, value: string): void {
      const row = sheet.addRow([label, value || '—']);
      row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.sky } };
      row.getCell(1).font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.navy } };
      row.getCell(1).alignment = { vertical: 'top', wrapText: true };
      row.getCell(2).font = { size: 10, name: 'Calibri', color: { argb: colors.slateDark } };
      row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    }

    // ---- TITLE ----
    const maquinaTitle = data.captura?.maquina || '';
    const fechasTitle = (data.captura?.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');
    const titleParts = [`Análisis #${idx + 1}`];
    if (maquinaTitle) titleParts.push(maquinaTitle);
    if (fechasTitle) titleParts.push(fechasTitle);
    const titleRow = sheet.addRow([titleParts.join(' — '), `Guardado: ${analysis.savedAt ? formatDateDDMMYYYY(analysis.savedAt.split('T')[0]) : '—'}`, '', '', '']);
    titleRow.eachCell(c => {
      c.font = { bold: true, size: 12, name: 'Calibri', color: { argb: colors.white } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    titleRow.height = 28;
    sheet.mergeCells(1, 1, 1, 5);

    // ---- CAPTURA ----
    sheet.addRow([]);
    const cap = data.captura || {};
    addStyledRow('Máquina / Equipo', cap.maquina || '');
    addStyledRow('Problema', cap.problema || '');
    addStyledRow('Fecha', (cap.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', '));
    addStyledRow('Tiempo Paro', cap.tiempoParo || '');
    addStyledRow('Indicador', cap.indicador || '');
    addStyledRow('Síntomas', cap.sintomas || '');
    addStyledRow('Responsable', cap.responsable || '');

    // ---- ISHIKAWA ----
    if (data.ishikawa && Object.values(data.ishikawa).some(v => v)) {
      sheet.addRow([]);
      const ishHeader = sheet.addRow(['Diagrama de Ishikawa', '', '', '', '']);
      ishHeader.eachCell(c => {
        c.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.white } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.blue } };
      });
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);

      const icatLabels: Record<string, string> = {
        maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
        manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente'
      };
      ['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'].forEach(cat => {
        addStyledRow(icatLabels[cat], (data.ishikawa || {})[cat] || '');
      });
    }

    // ---- 5 WHYS ----
    const whys_data = data.whys || {};
    const hasWhys = whys_data.why1 || whys_data.why2 || whys_data.why3 || whys_data.why4 || whys_data.why5;
    if (hasWhys) {
      sheet.addRow([]);
      const whysHeader = sheet.addRow(['5 Porqués', '', '', '', '']);
      whysHeader.eachCell(c => {
        c.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.white } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.blue } };
      });
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);

      for (let i = 1; i <= 5; i++) {
        const val = (whys_data[`why${i}` as keyof typeof whys_data] as string) || '';
        addStyledRow(`Por qué #${i}`, val);
      }
      if (whys_data.causaRaiz) {
        sheet.addRow([]);
        const crRow = sheet.addRow(['Causa Raíz', whys_data.causaRaiz, '', '', '']);
        crRow.eachCell(c => {
          c.font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.white } };
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.green } };
          c.alignment = { vertical: 'top', wrapText: true };
        });
      }
    }

    // ---- PLAN DE ACCIÓN ----
    const acciones = data.acciones || { correctivas: [], preventivas: [] };
    const hasPlan = acciones.correctivas.length > 0 || acciones.preventivas.length > 0;
    if (hasPlan) {
      sheet.addRow([]);
      const planHeader = sheet.addRow(['Plan de Acción', '', '', '', '']);
      planHeader.eachCell(c => {
        c.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.white } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.blue } };
      });
      sheet.mergeCells(sheet.rowCount, 1, sheet.rowCount, 5);

      const row = sheet.addRow(['Tipo', 'Descripción', 'Responsable', 'Fecha', 'Prioridad']);
      row.eachCell(c => {
        c.font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.white } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      });

      [...acciones.correctivas.map(a => ({ ...a, tipoLabel: 'Correctiva' })),
       ...acciones.preventivas.map(a => ({ ...a, tipoLabel: 'Preventiva' }))].forEach(a => {
        const r = sheet.addRow([a.tipoLabel, a.descripcion || '', a.responsable || '', a.fecha || '', prioLabels[a.prioridad] || '']);
        r.eachCell(c => {
          c.alignment = { vertical: 'top', wrapText: true };
        });
      });
    }
  }

  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = new Uint8Array(rawBuffer);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const fileName = buildIndividualFilename(undefined, undefined, 'xlsx').replace('Diagnostico.', 'Diagnostico_General.');
  // Actually build a proper name
  const genName = (() => {
    const allDates: string[] = [];
    analyses.forEach(a => {
      const f = a.data.captura?.fecha;
      if (f) f.forEach(d => { if (d) allDates.push(d); });
    });
    const parts = ['Diagnostico_General', String(analyses.length) + '_analisis'];
    if (allDates.length > 0) {
      const sorted = [...new Set(allDates)].sort();
      const first = formatDateDDMMYYYY(sorted[0]);
      const last = sorted.length > 1 ? formatDateDDMMYYYY(sorted[sorted.length - 1]) : '';
      if (last && last !== first) parts.push(first + '_a_' + last);
      else parts.push(first);
    }
    return parts.join('_').replace(/[^a-zA-Z0-9_\-]/g, '') + '.xlsx';
  })();
  a.download = genName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`${analyses.length} análisis exportados a Excel.`, 'success');
}

export async function exportExcel(
  updateIshikawaForMachine: (machine: string, data: any, problem: string) => void
): Promise<void> {
  try {
    recordRootCauseForPareto(getCurrentCauseSummary);
    const machineIshikawa = (document.getElementById('maquina') as HTMLSelectElement)?.value?.trim() || '';
    const problemIshikawa = (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() || '';
    if (machineIshikawa && problemIshikawa && rcaData.ishikawa) {
      updateIshikawaForMachine(machineIshikawa, rcaData.ishikawa, problemIshikawa);
    }

    const accionesCorrectivas = rcaData.acciones?.correctivas || [];
    const accionesPreventivas = rcaData.acciones?.preventivas || [];
    const todasAcciones = [
      ...accionesCorrectivas.map(a => ({ ...a, tipo: 'Correctivo' })),
      ...accionesPreventivas.map(a => ({ ...a, tipo: 'Preventivo' }))
    ];

    const causaRaiz =
      rcaData.whys.why5 || rcaData.whys.why4 || rcaData.whys.why3 ||
      rcaData.whys.why2 || rcaData.whys.why1 || '';

    const workbook = new ExcelJS.Workbook();
    const colors = {
      navy: 'FF1E3A5F', blue: 'FF2563EB', sky: 'FFE0F2FE',
      slate: 'FF64748B', slateDark: 'FF1E293B', white: 'FFFFFFFF',
      grayBg: 'FFF9FAFB', grayBorder: 'FFE5E7EB',
      green: 'FF16A34A', amber: 'FFD97706', red: 'FFDC2626',
    };

    // ============ SHEET 1: FAULT REPORT ============
    const reporteSheet = workbook.addWorksheet('Reporte de Fallas', {
      views: [{ state: 'frozen', ySplit: 1 }]
    });

    const headers = [
      'Fecha', 'Máquina', 'Problema', 'Indicador', 'Tipo de Mantenimiento',
      'Plan de Acción Correctivo', 'Plan de Acción Preventivo',
      'Status del Plan', 'Responsable', 'Fecha de Finalización', 'Causa Raíz'
    ];

    const headerRow = reporteSheet.addRow(headers);
    headerRow.eachCell((cell: any) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
      cell.font = { bold: true, size: 10, name: 'Calibri', color: { argb: colors.white } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: colors.navy } },
        bottom: { style: 'thin', color: { argb: colors.navy } },
        left: { style: 'thin', color: { argb: colors.navy } },
        right: { style: 'thin', color: { argb: colors.navy } },
      };
    });
    headerRow.height = 22;

    const correctivas = todasAcciones.filter(a => a.tipo === 'Correctivo');
    const preventivas = todasAcciones.filter(a => a.tipo === 'Preventivo');
    const tipoAccion = 'Correctivo';
    const correctivoText = correctivas.map(a => a.descripcion).filter(Boolean).join('\n');
    const preventivoText = preventivas.map(a => a.descripcion).filter(Boolean).join('\n');
    const responsables = [...new Set(todasAcciones.map(a => a.responsable).filter(Boolean))].join(', ');
    const fechasFin = todasAcciones.map(a => a.fecha).filter(Boolean).join(', ');

    const fechasFormatted = rcaData.captura.fecha?.map(f => formatDateDDMMYYYY(f)).filter(Boolean).join(', ') || '';
    const fechasFinFormatted = todasAcciones.map(a => a.fecha ? formatDateDDMMYYYY(a.fecha) : '').filter(Boolean).join(', ');

    const currentEntry: ExportHistoryEntry = {
      fecha: fechasFormatted,
      maquina: rcaData.captura.maquina || '',
      problema: rcaData.captura.problema || '',
      indicador: rcaData.captura.indicador || '',
      tipoAccion,
      correctivoText: todasAcciones.length > 0 ? correctivoText : '',
      preventivoText: todasAcciones.length > 0 ? preventivoText : '',
      status: 'Pendiente',
      responsable: (todasAcciones.length > 0 ? responsables : '') || rcaData.captura.responsable || '',
      fechaFin: fechasFinFormatted,
      causaRaiz,
      ishikawa: CATEGORY_ORDER.reduce((acc, key) => {
        acc[key] = (document.getElementById(`ishikawa-${key}`) as HTMLTextAreaElement)?.value?.trim() || '';
        return acc;
      }, {} as Record<string, string>)
    };

    const exportHistory: ExportHistoryEntry[] = JSON.parse(localStorage.getItem('exportHistory') || '[]');
    exportHistory.push(currentEntry);
    localStorage.setItem('exportHistory', JSON.stringify(exportHistory));

    exportHistory.forEach((entry, i) => {
      const row = reporteSheet.addRow([
        entry.fecha, entry.maquina, entry.problema, entry.indicador || '', entry.tipoAccion,
        entry.correctivoText, entry.preventivoText, entry.status || 'Pendiente',
        entry.responsable, entry.fechaFin, entry.causaRaiz
      ]);
      row.alignment = { vertical: 'top', wrapText: true };
      row.eachCell((cell: any, colIdx: number) => {
        // Alternating rows
        cell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: i % 2 === 0 ? colors.white : colors.grayBg }
        };
        cell.font = { size: 9.5, name: 'Calibri', color: { argb: colors.slateDark } };
        cell.border = {
          top: { style: 'thin', color: { argb: colors.grayBorder } },
          bottom: { style: 'thin', color: { argb: colors.grayBorder } },
          left: { style: 'thin', color: { argb: colors.grayBorder } },
          right: { style: 'thin', color: { argb: colors.grayBorder } },
        };
        // Center narrow columns
        if ([1, 5, 8].includes(colIdx)) {
          cell.alignment = { vertical: 'top', horizontal: 'center', wrapText: true };
        }
      });
    });

    const lastRow = exportHistory.length + 1;
    reporteSheet.autoFilter = {
      from: { row: 1, column: 1 }, to: { row: lastRow, column: 11 }
    };

    const maxWidths = [14, 22, 55, 14, 20, 70, 70, 16, 28, 18, 55];
    reporteSheet.columns.forEach((col: any, i: number) => {
      let maxLen = 0;
      col.eachCell((cell: any) => {
        const text = cell.value ? String(cell.value) : '';
        text.split('\n').forEach((line: string) => {
          maxLen = Math.max(maxLen, line.length);
        });
      });
      col.width = Math.min(Math.max(maxLen + 3, 10), maxWidths[i] || 55);
    });

    // ============ SHEET 2: ISHIKAWA ============
    const ishikawaSheet = workbook.addWorksheet('Ishikawa');
    const ishikawaHistoryData = getIshikawaHistory();
    const ishikawaMachines = Object.keys(ishikawaHistoryData).filter(m => {
      const entry = ishikawaHistoryData[m];
      return entry && entry.ishikawa && Object.values(entry.ishikawa).some(v => v);
    });

    if (ishikawaMachines.length === 0) {
      ishikawaSheet.getCell('A1').value = 'No hay diagramas Ishikawa guardados.';
      ishikawaSheet.getCell('A1').font = { italic: true, size: 11, name: 'Calibri', color: { argb: colors.slate } };
    } else {
      const hCell = ishikawaSheet.getCell('A1');
      hCell.value = 'Máquina';
      hCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.white } };
      hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
      hCell.alignment = { vertical: 'middle', horizontal: 'center' };
      hCell.border = {
        top: { style: 'thin', color: { argb: colors.navy } },
        bottom: { style: 'thin', color: { argb: colors.navy } },
        left: { style: 'thin', color: { argb: colors.navy } },
        right: { style: 'thin', color: { argb: colors.navy } },
      };

      let ishikawaRow = 1;
      ishikawaMachines.forEach(machine => {
        const entry = ishikawaHistoryData[machine];
        const ishikawaData = entry.ishikawa || {};
        if (!Object.values(ishikawaData).some(v => v)) return;

        ishikawaRow++;
        const mCell = ishikawaSheet.getCell(`A${ishikawaRow}`);
        mCell.value = machine;
        mCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.blue } };
        mCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.sky } };

        const imgData = createSimplifiedIshikawa(ishikawaData, entry.problema);
        const hasImage = imgData && imgData.imgData;

        for (let r = ishikawaRow; r <= ishikawaRow + 30; r++) {
          ishikawaSheet.getCell(`A${r}`).value = machine;
        }

        if (hasImage) {
          const base64Data = imgData!.imgData.split(',')[1];
          const imgId = workbook.addImage({ base64: base64Data, extension: 'png' });
          ishikawaSheet.addImage(imgId, {
            tl: { col: 0.125, row: ishikawaRow + 0.125 } as any,
            br: { col: 14.875, row: ishikawaRow + 29.875 } as any
          });
        }
        ishikawaRow += 31;
      });

      if (ishikawaRow > 2) {
        ishikawaSheet.autoFilter = {
          from: { row: 1, column: 1 }, to: { row: ishikawaRow - 1, column: 1 }
        };
      }
    }
    ishikawaSheet.getColumn(1).width = 30;

    // ============ SHEET 3: PARETO ============
    const paretoSheet = workbook.addWorksheet('Pareto');
    const allParetoData = JSON.parse(localStorage.getItem('paretoHistory') || '{}');
    const machines = Object.keys(allParetoData).filter(m => {
      const data = allParetoData[m];
      return data && Object.keys(data).length > 0;
    });

    if (machines.length === 0) {
      paretoSheet.getCell('A1').value = 'No hay datos de Pareto acumulados.';
      paretoSheet.getCell('A1').font = { italic: true, size: 11, name: 'Calibri', color: { argb: colors.slate } };
    } else {
      const hCell = paretoSheet.getCell('A1');
      hCell.value = 'Máquina';
      hCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.white } };
      hCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.navy } };
      hCell.alignment = { vertical: 'middle', horizontal: 'center' };
      hCell.border = {
        top: { style: 'thin', color: { argb: colors.navy } },
        bottom: { style: 'thin', color: { argb: colors.navy } },
        left: { style: 'thin', color: { argb: colors.navy } },
        right: { style: 'thin', color: { argb: colors.navy } },
      };

      let paretoRow = 1;
      machines.forEach(machine => {
        const paretoItems = getAccumulatedParetoData(machine);
        if (paretoItems.length === 0) return;

        paretoRow++;
        const mCell = paretoSheet.getCell(`A${paretoRow}`);
        mCell.value = machine;
        mCell.font = { bold: true, size: 11, name: 'Calibri', color: { argb: colors.blue } };
        mCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.sky } };

        const sorted = [...paretoItems].sort((a, b) => b.frecuencia - a.frecuencia);
        const imgData = createSimplifiedPareto(sorted);
        const hasImage = imgData && imgData.imgData;

        for (let r = paretoRow; r <= paretoRow + 30; r++) {
          paretoSheet.getCell(`A${r}`).value = machine;
        }

        if (hasImage) {
          const base64Data = imgData!.imgData.split(',')[1];
          const imgId = workbook.addImage({ base64: base64Data, extension: 'png' });
          paretoSheet.addImage(imgId, {
            tl: { col: 0.125, row: paretoRow + 0.125 } as any,
            br: { col: 14.875, row: paretoRow + 29.875 } as any
          });
        }
        paretoRow += 31;
      });

      paretoSheet.autoFilter = {
        from: { row: 1, column: 1 }, to: { row: paretoRow - 1, column: 1 }
      };
    }
    paretoSheet.getColumn(1).width = 30;

    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = new Uint8Array(rawBuffer);
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fName = buildIndividualFilename(rcaData.captura?.maquina, rcaData.captura?.fecha, 'xlsx');
    a.download = fName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

  } catch (error: any) {
    handleError(error, 'exportar a Excel');
  }
}
