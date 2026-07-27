import { rcaData, savedRcaData, CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, formatDate, type RCAIshikawa, type ParetoItem, type RCAData } from '../state/store';
import { roundRect, upscaleCanvas } from '../utils/dom';
import { escapeHtml, formatDateDDMMYYYY } from '../utils/text';
import { showToast } from '../utils/toast';
import { handleError } from '../utils/errorHandler';
import { getCurrentCauseSummary } from '../state/store';
import { recordRootCauseForPareto, getAccumulatedParetoData } from './pareto';
import { getIshikawaHistory } from './ishikawaHistory';
import { jsPDF } from 'jspdf';

/* ==========================================================================
   PDF Export Service
   Generates a professional report with all analysis data
   ========================================================================== */

/** Builds a descriptive filename for individual exports: Diagnostico_{maquina}_{fechas}.{ext} */
export function buildIndividualFilename(

  machine: string | undefined,
  fechas: string[] | undefined,
  ext: string
): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
  const parts = ['Diagnostico'];
  if (machine) parts.push(sanitize(machine));
  if (fechas && fechas.length > 0) {
    const dateStr = fechas.map(d => formatDateDDMMYYYY(d)).join('-');
    parts.push(dateStr);
  }
  return parts.join('_') + '.' + ext;
}

/** Exports ALL sections (captura + ishikawa + 5whys + plan) as a single compact PDF */
export async function exportSingleRowPDF(
  _section?: string,
  _tipo?: string,
  _index?: number
): Promise<void> {
  const data = savedRcaData;

  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const m = 15;
  const cw = pw - 2 * m;
  let y = m;

  const colors = {
    navy: [30, 58, 95] as const,
    blue: [37, 99, 235] as const,
    sky: [224, 242, 254] as const,
    slate: [100, 116, 139] as const,
    slateDark: [30, 41, 59] as const,
    grayBorder: [229, 231, 235] as const,
    white: [255, 255, 255] as const,
    green: [22, 163, 74] as const,
    amber: [217, 119, 6] as const,
    red: [220, 38, 38] as const,
  };

  const maquina = data.captura?.maquina || '';
  const fechasArr = data.captura?.fecha || [];
  const fechasStr = fechasArr.map(d => formatDateDDMMYYYY(d)).join(', ');

  // Header with máquina + fechas
  doc.setFillColor(...colors.navy);
  doc.rect(0, 0, pw, 26, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  const headerTitle = maquina
    ? `Diagnóstico — ${maquina}`
    : 'Diagnóstico de Fallas — Reporte Completo';
  doc.text(headerTitle, m, 11);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  const metaParts: string[] = [];
  if (fechasStr) metaParts.push(`Fecha: ${fechasStr}`);
  const todayISO = new Date().toISOString().split('T')[0];
  metaParts.push(`Generado: ${formatDateDDMMYYYY(todayISO)}`);
  doc.text(metaParts.join('  |  '), m, 19);
  doc.setDrawColor(...colors.blue);
  doc.setLineWidth(0.6);
  doc.line(0, 26, pw, 26);
  y = 34;

  function checkPageBreak(h: number) {
    if (y + h > ph - 15) {
      doc.addPage();
      y = m;
      doc.setFillColor(...colors.navy);
      doc.rect(0, 0, pw, 14, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(maquina ? `Diagnóstico — ${maquina} (cont.)` : 'Diagnóstico (cont.)', m, 9);
      y = 18;
    }
  }

  function addSectionTitle(t: string) {
    checkPageBreak(16);
    doc.setFillColor(...colors.blue);
    doc.rect(m, y, 3, 10, 'F');
    doc.setFillColor(...colors.sky);
    doc.roundedRect(m + 3, y, cw - 3, 10, 2, 2, 'F');
    doc.setTextColor(...colors.navy);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(t, m + 10, y + 7);
    y += 14;
  }

  function addField(label: string, value: string) {
    if (!value) return;
    checkPageBreak(7);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.slateDark);
    const lw = doc.getTextWidth(label);
    doc.text(label, m + 4, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.slate);
    const remaining = cw - 8 - lw - 4;
    if (doc.getTextWidth(value) > remaining) {
      const lines = doc.splitTextToSize(value, remaining);
      lines.forEach((line: string) => {
        doc.text(line, m + 4 + lw + 4, y);
        y += 4.5;
      });
      y -= 1;
    } else {
      doc.text(value, m + 4 + lw + 4, y);
    }
    y += 4;
  }

  // ── 1. CAPTURA ──
  addSectionTitle('1. Información del Problema');
  const cap = data.captura || {};
  addField('Máquina / Equipo:', cap.maquina || '');
  addField('Problema:', cap.problema || '');
  addField('Fecha(s):', fechasStr);
  addField('Tiempo de paro:', cap.tiempoParo || '');
  addField('Indicador afectado:', cap.indicador || '');
  addField('Síntomas:', cap.sintomas || '');
  addField('Responsable:', cap.responsable || '');

  // ── 2. ISHIKAWA ──
  addSectionTitle('2. Diagrama de Ishikawa');
  const ish = data.ishikawa || {};
  const icats = ['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'];
  const icatLabels: Record<string, string> = {
    maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
    manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente'
  };
  icats.forEach(cat => {
    addField(icatLabels[cat] + ':', ish[cat] || '');
  });

  const hasIshikawa = Object.values(ish).some(v => v && String(v).trim());
  if (hasIshikawa) {
    checkPageBreak(170);
    const img = createSimplifiedIshikawa(ish, data.captura?.problema || '');
    if (img && img.imgData) {const iw = 190;
        const ih = (img.height / img.width) * iw;
        doc.addImage(img.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
        y += ih + 6;
      }
    }

    // ── 3. 5 WHYS ──
    addSectionTitle('3. Análisis de 5 Porqués');
    const whys = data.whys || {};
    for (let i = 1; i <= 5; i++) {
      const val = (whys[`why${i}` as keyof typeof whys] as string) || '';
      if (val) addField(`¿Por qué #${i}?:`, val);
  }
  const causaRaiz = whys.causaRaiz;
  if (causaRaiz) {
    checkPageBreak(10);
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(m + 4, y, cw - 8, 10, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.green);
    doc.text('Causa Raíz:', m + 10, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...colors.slateDark);
    doc.text(causaRaiz, m + 10 + doc.getTextWidth('Causa Raíz:') + 2, y + 7);
    y += 14;
  }

  // ── 4. PLAN DE ACCIÓN ──
  addSectionTitle('4. Plan de Acción');
  const acciones = data.acciones || { correctivas: [], preventivas: [] };

  function renderActions(list: typeof acciones.correctivas, label: string, labelColor: readonly [number, number, number]) {
    checkPageBreak(10);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...labelColor);
    doc.text(label, m + 4, y);
    y += 6;

    if (list.length === 0) {
      return;
    }

    list.forEach((accion, i) => {
      checkPageBreak(22);
      doc.setFillColor(...colors.white);
      doc.setDrawColor(...colors.grayBorder);
      doc.roundedRect(m + 4, y, cw - 8, 16, 3, 3, 'FD');
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.slateDark);
      const desc = `${i + 1}. ${accion.descripcion || ''}`;
      doc.text(desc, m + 10, y + 6);
      let dx = m + 10;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...colors.slate);
      doc.setFontSize(7.5);
      if (accion.responsable) {
        const rtxt = `Resp: ${accion.responsable}`;
        doc.text(rtxt, dx, y + 12);
        dx += doc.getTextWidth(rtxt) + 8;
      }
      if (accion.fecha) {
        doc.text(`Fecha: ${accion.fecha}`, dx, y + 12);
      }
      if (accion.prioridad) {
        drawPriorityBadge(m + cw - 24, y + 8, accion.prioridad);
      }
      y += 20;
    });
  }

  function drawPriorityBadge(x: number, cy: number, prioridad: string) {
    const map: Record<string, readonly [number, number, number]> = { alta: colors.red, media: colors.amber, baja: colors.green };
    const c = map[prioridad] || colors.slate;
    doc.setFillColor(...c);
    doc.roundedRect(x, cy - 2.5, 14, 6, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(5.5);
    doc.setFont('helvetica', 'bold');
    doc.text(prioridad.toUpperCase(), x + 7, cy + 0.5, { align: 'center' });
  }

  renderActions(acciones.correctivas, 'Acciones Correctivas', colors.green);
  renderActions(acciones.preventivas, 'Acciones Preventivas', colors.blue);

  // ── 5. PARETO ──
  if (maquina) {
    const paretoItems = getAccumulatedParetoData(maquina);
    if (paretoItems.length > 0) {
      addSectionTitle('5. Análisis de Pareto');
      checkPageBreak(170);
      const paretoImg = createSimplifiedPareto(paretoItems);
      if (paretoImg && paretoImg.imgData) {
        const iw = 190;
        const ih = (paretoImg.height / paretoImg.width) * iw;
        doc.addImage(paretoImg.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
        y += ih + 6;
      }
    }
  }

  // Footer
  const fy = ph - 10;
  doc.setFillColor(...colors.navy);
  doc.rect(0, fy, pw, 10, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.text('Herramienta de Diagnóstico de Fallas — Reporte Completo', pw / 2, fy + 6, { align: 'center' });

  const machine = data.captura?.maquina;
  const fechas = data.captura?.fecha;
  const filename = buildIndividualFilename(machine, fechas, 'pdf');
  doc.save(filename);
}

/** Builds a descriptive filename for general exports: Diagnostico_General_{count}_{date_range}.{ext} */
function buildGeneralFilename(analyses: Array<{ id: string; savedAt: string; data: RCAData }>, ext: string): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
  const parts = ['Diagnostico_General'];
  parts.push(String(analyses.length) + '_analisis');
  const dates: string[] = [];
  analyses.forEach(a => {
    const capFecha = a.data.captura?.fecha;
    if (capFecha && capFecha.length > 0) {
      capFecha.forEach(d => {
        if (d) dates.push(d);
      });
    }
  });
  if (dates.length > 0) {
    const sorted = [...new Set(dates)].sort();
    const first = formatDateDDMMYYYY(sorted[0]);
    const last = sorted.length > 1 ? formatDateDDMMYYYY(sorted[sorted.length - 1]) : '';
    if (last && last !== first) {
      parts.push(first + '_a_' + last);
    } else {
      parts.push(first);
    }
  }
  return sanitize(parts.join('_')) + '.' + ext;
}

/** Exports ALL saved analyses from the file as a single multi-page PDF */
export async function exportAllPDF(analyses: Array<{ id: string; savedAt: string; data: RCAData }>): Promise<void> {
  if (!analyses || analyses.length === 0) {
    showToast('No hay análisis guardados para exportar.', 'warning');
    return;
  }

  const doc = new jsPDF('p', 'mm', 'a4');
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const m = 15;
  const cw = pw - 2 * m;

  const colors = {
    navy: [30, 58, 95] as const,
    blue: [37, 99, 235] as const,
    sky: [224, 242, 254] as const,
    slate: [100, 116, 139] as const,
    slateDark: [30, 41, 59] as const,
    grayBorder: [229, 231, 235] as const,
    white: [255, 255, 255] as const,
    green: [22, 163, 74] as const,
    amber: [217, 119, 6] as const,
    red: [220, 38, 38] as const,
  };

  for (let idx = 0; idx < analyses.length; idx++) {
    if (idx > 0) doc.addPage();

    const analysis = analyses[idx];
    const data = analysis.data;
    let y = m;
    const maquina = data.captura?.maquina || '';
    const fechasStr = (data.captura?.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');

    // Page header — shows máquina + fechas inline
    doc.setFillColor(...colors.navy);
    doc.rect(0, 0, pw, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    const headerTitle = maquina
      ? `Diagnóstico #${idx + 1} — ${maquina}`
      : `Diagnóstico #${idx + 1} — Reporte Completo`;
    doc.text(headerTitle, m, 11);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    const metaParts: string[] = [];
    if (fechasStr) metaParts.push(`Fecha: ${fechasStr}`);
    if (analysis.savedAt) metaParts.push(`Guardado: ${formatDateDDMMYYYY(analysis.savedAt.split('T')[0])}`);
    doc.text(metaParts.join('  |  '), m, 19);
    // Blue accent line
    doc.setDrawColor(...colors.blue);
    doc.setLineWidth(0.6);
    doc.line(0, 26, pw, 26);
    y = 34;

    function checkPageBreak(h: number) {
      if (y + h > ph - 15) {
        doc.addPage();
        y = m;
        // Re-draw slim header on new page
        doc.setFillColor(...colors.navy);
        doc.rect(0, 0, pw, 14, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        const contTitle = maquina
          ? `Diagnóstico #${idx + 1} — ${maquina} (cont.)`
          : `Diagnóstico #${idx + 1} (cont.)`;
        doc.text(contTitle, m, 9);
        y = 18;
      }
    }

    function addSectionTitle(t: string) {
      checkPageBreak(16);
      doc.setFillColor(...colors.blue);
      doc.rect(m, y, 3, 10, 'F');
      doc.setFillColor(...colors.sky);
      doc.roundedRect(m + 3, y, cw - 3, 10, 2, 2, 'F');
      doc.setTextColor(...colors.navy);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(t, m + 10, y + 7);
      y += 14;
    }

    function addTextBlock(text: string, fontSize = 9, fontStyle: 'normal' | 'bold' | 'italic' = 'normal', textColor: readonly [number, number, number] = colors.slate) {
      if (!text) return;
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', fontStyle);
      doc.setTextColor(...textColor);
      const lines = doc.splitTextToSize(text, cw - 8);
      const lh = fontSize * 0.38;
      checkPageBreak(lines.length * lh + 4);
      lines.forEach((line: string) => {
        doc.text(line, m + 4, y);
        y += lh;
      });
      y += 1;
    }

    function addField(label: string, value: string) {
      if (!value) return;
      checkPageBreak(7);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.slateDark);
      const lw = doc.getTextWidth(label);
      doc.text(label, m + 4, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...colors.slate);
      const remaining = cw - 8 - lw - 4;
      if (doc.getTextWidth(value) > remaining) {
        const lines = doc.splitTextToSize(value, remaining);
        lines.forEach((line: string) => {
          doc.text(line, m + 4 + lw + 4, y);
          y += 4.5;
        });
        y -= 1;
      } else {
        doc.text(value, m + 4 + lw + 4, y);
      }
      y += 4;
    }

    function drawPriorityBadge(x: number, cy: number, prioridad: string) {
      const map: Record<string, readonly [number, number, number]> = { alta: colors.red, media: colors.amber, baja: colors.green };
      const c = map[prioridad] || colors.slate;
      doc.setFillColor(...c);
      doc.roundedRect(x, cy - 2.5, 14, 6, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'bold');
      doc.text(prioridad.toUpperCase(), x + 7, cy + 0.5, { align: 'center' });
    }

    // ── 1. CAPTURA ──
    addSectionTitle('1. Información del Problema');
    const cap = data.captura || {};
    addField('Máquina / Equipo:', cap.maquina || '');
    addField('Problema:', cap.problema || '');
    const fechas = (cap.fecha || []).map(d => formatDateDDMMYYYY(d)).join(', ');
    addField('Fecha(s):', fechas);
    addField('Tiempo de paro:', cap.tiempoParo || '');
    addField('Indicador afectado:', cap.indicador || '');
    addField('Síntomas:', cap.sintomas || '');
    addField('Responsable:', cap.responsable || '');

    // ── 2. ISHIKAWA ──
    addSectionTitle('2. Diagrama de Ishikawa');
    const ish = data.ishikawa || {};
    const icats = ['maquina', 'metodo', 'materiales', 'manoObra', 'medicion', 'medioAmbiente'];
    const icatLabels: Record<string, string> = {
      maquina: 'Máquina', metodo: 'Método', materiales: 'Materiales',
      manoObra: 'Mano de obra', medicion: 'Medición', medioAmbiente: 'Medio ambiente'
    };
    icats.forEach(cat => {
      addField(icatLabels[cat] + ':', ish[cat] || '');
    });

    // Ishikawa diagram image
    const hasIshikawa = Object.values(ish).some(v => v && String(v).trim());
    if (hasIshikawa) {
      checkPageBreak(170);
      const img = createSimplifiedIshikawa(ish, data.captura?.problema || '');
      if (img && img.imgData) {
        const iw = 190;
        const ih = (img.height / img.width) * iw;
        doc.addImage(img.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
        y += ih + 6;
      }
    }

    // ── 3. 5 WHYS ──
    addSectionTitle('3. Análisis de 5 Porqués');
    const whys_data = data.whys || {};
    for (let i = 1; i <= 5; i++) {
      const val = (whys_data[`why${i}` as keyof typeof whys_data] as string) || '';
      if (val) addField(`¿Por qué #${i}?:`, val);
    }
    const causaRaiz = whys_data.causaRaiz;
    if (causaRaiz) {
      checkPageBreak(10);
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(m + 4, y, cw - 8, 10, 3, 3, 'F');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.green);
      doc.text('Causa Raíz:', m + 10, y + 7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...colors.slateDark);
      doc.text(causaRaiz, m + 10 + doc.getTextWidth('Causa Raíz:') + 2, y + 7);
      y += 14;
    }

    // ── 4. PLAN DE ACCIÓN ──
    addSectionTitle('4. Plan de Acción');
    const acciones = data.acciones || { correctivas: [], preventivas: [] };

    function renderActions(list: typeof acciones.correctivas, label: string, labelColor: readonly [number, number, number]) {
      checkPageBreak(10);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...labelColor);
      doc.text(label, m + 4, y);
      y += 6;

      if (list.length === 0) {
        return;
      }

      list.forEach((accion, i) => {
        checkPageBreak(22);
        doc.setFillColor(...colors.white);
        doc.setDrawColor(...colors.grayBorder);
        doc.roundedRect(m + 4, y, cw - 8, 16, 3, 3, 'FD');
        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.slateDark);
        const desc = `${i + 1}. ${accion.descripcion || ''}`;
        doc.text(desc, m + 10, y + 6);
        let dx = m + 10;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...colors.slate);
        doc.setFontSize(7.5);
        if (accion.responsable) {
          const rtxt = `Resp: ${accion.responsable}`;
          doc.text(rtxt, dx, y + 12);
          dx += doc.getTextWidth(rtxt) + 8;
        }
        if (accion.fecha) {
          doc.text(`Fecha: ${accion.fecha}`, dx, y + 12);
        }
        if (accion.prioridad) {
          drawPriorityBadge(m + cw - 24, y + 8, accion.prioridad);
        }
        y += 20;
      });
    }

    renderActions(acciones.correctivas, 'Acciones Correctivas', colors.green);
    renderActions(acciones.preventivas, 'Acciones Preventivas', colors.blue);

    // ── 5. PARETO ──
    if (maquina) {
      const paretoItems = getAccumulatedParetoData(maquina);
      if (paretoItems.length > 0) {
        addSectionTitle('5. Análisis de Pareto');
        checkPageBreak(170);
        const paretoImg = createSimplifiedPareto(paretoItems);
        if (paretoImg && paretoImg.imgData) {
          const iw = 190;
          const ih = (paretoImg.height / paretoImg.width) * iw;
          doc.addImage(paretoImg.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
          y += ih + 6;
        }
      }
    }

    // Page footer
    const fy = ph - 10;
    doc.setFillColor(...colors.navy);
    doc.rect(0, fy, pw, 10, 'F');
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'normal');
    doc.text(`Diagnóstico #${idx + 1} de ${analyses.length} — Herramienta de Diagnóstico de Fallas`, pw / 2, fy + 6, { align: 'center' });
  }

  const filename = buildGeneralFilename(analyses, 'pdf');
  doc.save(filename);
  showToast(`${analyses.length} análisis exportados a PDF.`, 'success');
}

export function handlePDFExport(
  updateIshikawaForMachine: (machine: string, data: any, problem: string) => void
): void {
  exportPDF(updateIshikawaForMachine).catch(error => {
    handleError(error, 'generar el PDF');
  });
}

async function loadLogoBase64(): Promise<string | null> {
  try {
    const resp = await fetch('/logo.png');
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function exportPDF(
  updateIshikawaForMachine: (machine: string, data: any, problem: string) => void
): Promise<void> {
  try {
    recordRootCauseForPareto(getCurrentCauseSummary);
    const machineIshikawaPdf = rcaData.captura?.maquina || '';
    const problemIshikawaPdf = rcaData.captura?.problema || '';
    if (machineIshikawaPdf && problemIshikawaPdf && rcaData.ishikawa) {
      updateIshikawaForMachine(machineIshikawaPdf, rcaData.ishikawa, problemIshikawaPdf);
    }

    const doc = new jsPDF('p', 'mm', 'a4');

    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    const m = 15;
    const cw = pw - 2 * m;
    let y = m;

    const colors = {
      navy: [30, 58, 95] as const,
      blue: [37, 99, 235] as const,
      sky: [224, 242, 254] as const,
      slate: [100, 116, 139] as const,
      slateDark: [30, 41, 59] as const,
      grayBg: [249, 250, 251] as const,
      grayBorder: [229, 231, 235] as const,
      white: [255, 255, 255] as const,
      green: [22, 163, 74] as const,
      amber: [217, 119, 6] as const,
      red: [220, 38, 38] as const,
    };

        const logoData = await loadLogoBase64();

    function addHeader() {
      doc.setFillColor(...colors.navy);
      doc.rect(0, 0, pw, 28, 'F');
      if (logoData) {
        doc.addImage(logoData, 'PNG', m, 4, 24, 15);
      }
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      const tx = logoData ? m + 28 : m;
      doc.text('Reporte de Diagnóstico de Fallas', tx, 11);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184);
      const today = new Date();
      const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      doc.text(`Generado: ${formatDateDDMMYYYY(todayISO)}`, tx, 19);
      doc.setDrawColor(...colors.blue);
      doc.setLineWidth(0.6);
      doc.line(0, 28, pw, 28);
      y = 36;
    }

    function addFooter() {
      const fy = ph - 10;
      doc.setFillColor(...colors.navy);
      doc.rect(0, fy, pw, 10, 'F');
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(6);
      doc.setFont('helvetica', 'normal');
      doc.text('Herramienta de Diagnóstico de Fallas — Análisis de Causa Raíz', pw / 2, fy + 6, { align: 'center' });
    }

    function checkPageBreak(h: number) {
      if (y + h > ph - 18) {
        addFooter();
        doc.addPage();
        addHeader();
      }
    }

    /** Section title with min bar + color badge, then content starts immediately below */
    function addSectionTitle(title: string) {
      checkPageBreak(16);
      doc.setFillColor(...colors.blue);
      doc.rect(m, y, 3, 12, 'F');
      doc.setFillColor(...colors.sky);
      doc.roundedRect(m + 3, y, cw - 3, 12, 2, 2, 'F');
      doc.setTextColor(...colors.navy);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(title, m + 10, y + 8.5);
      y += 16;
    }

    /** Two-column label/value pairs — always shown, empty values get a placeholder */
    function addField(label: string, value: string, emptyPlaceholder = '—') {
      checkPageBreak(7);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.slateDark);
      const lw = doc.getTextWidth(label);
      doc.text(label, m + 4, y);
      doc.setFont('helvetica', 'normal');
      if (value) {
        doc.setTextColor(...colors.slate);
        doc.text(value, m + 4 + lw + 2, y);
      } else {
        doc.setTextColor(148, 163, 184);
        doc.setFont('helvetica', 'italic');
        doc.text(emptyPlaceholder, m + 4 + lw + 2, y);
        doc.setFont('helvetica', 'normal');
      }
      y += 5;
    }

    /** Text block with word-wrap */
    function addTextBlock(
      text: string,
      fontSize = 9,
      fontStyle: 'normal' | 'bold' | 'italic' = 'normal',
      textColor: readonly [number, number, number] = colors.slate
    ) {
      if (!text) return;
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', fontStyle);
      doc.setTextColor(...textColor);
      const lines = doc.splitTextToSize(text, cw - 8);
      const lh = fontSize * 0.38;
      checkPageBreak(lines.length * lh + 4);
      lines.forEach((line: string) => {
        doc.text(line, m + 4, y);
        y += lh;
      });
      y += 1;
    }

    /** Light horizontal rule */
    function addHR() {
      checkPageBreak(5);
      y += 1;
      doc.setDrawColor(...colors.grayBorder);
      doc.setLineWidth(0.4);
      doc.line(m + 4, y, m + cw - 4, y);
      y += 4;
    }

    /** Priority badge */
    function drawPriorityBadge(x: number, cy: number, prioridad: string) {
      const map: Record<string, readonly [number, number, number]> = { alta: colors.red, media: colors.amber, baja: colors.green };
      const c = map[prioridad] || colors.slate;
      doc.setFillColor(...c);
      doc.roundedRect(x, cy - 2.5, 14, 6, 2, 2, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(5.5);
      doc.setFont('helvetica', 'bold');
      doc.text(prioridad.toUpperCase(), x + 7, cy + 0.5, { align: 'center' });
    }

    /* ═══════════ BUILD REPORT ═══════════ */

    addHeader();

    // ── 1. PROBLEM INFO ──
    addSectionTitle('1. Información del Problema');

    const captura = rcaData.captura || {};
    const rawFechas = captura.fecha || [];
    let fechaStr = 'No especificada';
    if (rawFechas.length === 1) {
      fechaStr = formatDateDDMMYYYY(rawFechas[0]);
    } else if (rawFechas.length >= 2) {
      fechaStr = rawFechas.map(d => formatDateDDMMYYYY(d)).join(' — ');
    }

    addField('Fecha del evento:', fechaStr === 'No especificada' ? '' : fechaStr);
    addField('Máquina / Equipo:', captura.maquina || '');
    addField('Tiempo de paro:', captura.tiempoParo ? `${captura.tiempoParo} minutos` : '');
    addField('Indicador afectado:', captura.indicador || '');
    addField('Responsable:', captura.responsable || '');

    if (captura.problema) {
      addHR();
      addTextBlock(captura.problema, 9, 'bold', colors.navy);
    }
    if (captura.sintomas) {
      addHR();
      addTextBlock(captura.sintomas);
    }
    y += 3;

    // ── 2. 5 WHYS ──
    addSectionTitle('2. Análisis de 5 Porqués');

    const whys = rcaData.whys || {};
    for (let i = 1; i <= 5; i++) {
      const wt = whys[`why${i}` as keyof typeof whys];
      checkPageBreak(6);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...colors.blue);
      doc.text(`¿Por qué #${i}?`, m + 4, y);
      y += 4.5;
      addTextBlock(String(wt || ''));
    }

    // Causa Raíz — always show
    const causaRaiz = whys.causaRaiz || '';
    const causaRaizDisplay = causaRaiz || getCurrentCauseSummary();
    addHR();
    checkPageBreak(10);
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(m + 4, y, cw - 8, 10, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...colors.green);
    doc.text('Causa Raíz:', m + 10, y + 7);
    doc.setFont('helvetica', 'normal');
    if (causaRaizDisplay) {
      doc.setTextColor(...colors.slateDark);
      doc.text(causaRaizDisplay, m + 10 + doc.getTextWidth('Causa Raíz:') + 2, y + 7);
    } else {
      doc.setTextColor(148, 163, 184);
      doc.setFont('helvetica', 'italic');
      doc.text('No definida', m + 10 + doc.getTextWidth('Causa Raíz:') + 2, y + 7);
      doc.setFont('helvetica', 'normal');
    }
    y += 14;
    y += 2;

    // ── 3. ISHIKAWA ──
    addSectionTitle('3. Diagrama de Ishikawa');

    const ishikawa = rcaData.ishikawa || {};
    const hasIshikawa = CATEGORY_ORDER.some(cat => ishikawa[cat]?.trim());
    if (hasIshikawa) {
      checkPageBreak(170);
      const problema = captura.problema || '';
      const img = createSimplifiedIshikawa(ishikawa, problema);
      if (img && img.imgData) {
        const iw = 190;
        const ih = (img.height / img.width) * iw;
        doc.addImage(img.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
        y += ih + 6;
      }
    } else {
      addTextBlock('No se registraron datos en el diagrama de Ishikawa.');
    }
    y += 3;

    // ── 4. ACTION PLAN ──
    addSectionTitle('4. Plan de Acción');

    const acciones = rcaData.acciones || { correctivas: [], preventivas: [] };

    function renderActions(list: typeof acciones.correctivas, label: string, labelColor: readonly [number, number, number]) {
      checkPageBreak(10);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...labelColor);
      doc.text(label, m + 4, y);
      y += 7;

      if (list.length === 0) {
        addTextBlock('No se registraron acciones.');
        y += 2;
        return;
      }

      list.forEach((accion, i) => {
        checkPageBreak(22);
        doc.setFillColor(...colors.white);
        doc.setDrawColor(...colors.grayBorder);
        doc.roundedRect(m + 4, y, cw - 8, 18, 3, 3, 'FD');

        doc.setFontSize(8.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.slateDark);
        const desc = `${i + 1}. ${accion.descripcion || ''}`;
        doc.text(desc, m + 10, y + 6);

        let dx = m + 10;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...colors.slate);
        doc.setFontSize(7.5);
        if (accion.responsable) {
          const rtxt = `Resp: ${accion.responsable}`;
          doc.text(rtxt, dx, y + 13);
          dx += doc.getTextWidth(rtxt) + 8;
        }
        if (accion.fecha) {
          doc.text(`Fecha: ${accion.fecha}`, dx, y + 13);
        }
        if (accion.prioridad) {
          drawPriorityBadge(m + cw - 24, y + 9, accion.prioridad);
        }
        y += 22;
      });
      y += 2;
    }

    renderActions(acciones.correctivas, 'Acciones Correctivas', colors.green);
    renderActions(acciones.preventivas, 'Acciones Preventivas', colors.blue);

    // ── 5. PARETO CHART ──
    addSectionTitle('5. Análisis de Pareto');

    const currentMachine = captura.maquina || '';
    if (currentMachine) {
      const paretoItems = getAccumulatedParetoData(currentMachine);
      if (paretoItems.length > 0) {
        checkPageBreak(170);
        const paretoImg = createSimplifiedPareto(paretoItems);
        if (paretoImg && paretoImg.imgData) {
          const iw = 190;
          const ih = (paretoImg.height / paretoImg.width) * iw;
          doc.addImage(paretoImg.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
          y += ih + 6;
        }
      } else {
        addTextBlock('No hay datos acumulados de Pareto para esta máquina.');
      }
    } else {
      addTextBlock('No se pudo identificar la máquina para el análisis de Pareto.');
    }
    y += 3;

    // ── 6. ISHIKAWA HISTORICAL ──
    addSectionTitle('6. Historial de Diagramas Ishikawa');

    const ishikawaHistoryData = getIshikawaHistory();
    const hasHistory = Object.keys(ishikawaHistoryData).length > 0;
    if (hasHistory) {
      Object.entries(ishikawaHistoryData).forEach(([machine, entry]) => {
        if (!Object.values(entry.ishikawa || {}).some(v => v)) return;
        checkPageBreak(16);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.blue);
        doc.text(`Máquina: ${machine}`, m + 4, y);
        y += 5;
        const histImg = createSimplifiedIshikawa(entry.ishikawa, entry.problema);
        if (histImg && histImg.imgData) {
          checkPageBreak(170);
          const iw = 190;
          const ih = (histImg.height / histImg.width) * iw;
          doc.addImage(histImg.imgData, 'PNG', (pw - iw) / 2, y, iw, ih);
          y += ih + 8;
        }
      });
    } else {
      addTextBlock('No hay historial de diagramas Ishikawa guardados.');
    }

    addFooter();
    const machineF = rcaData.captura?.maquina;
    const fechasF = rcaData.captura?.fecha;
    const filename = buildIndividualFilename(machineF, fechasF, 'pdf');
    doc.save(filename);

  } catch (error: any) {
    handleError(error, 'generar el PDF');
  }
}

/* ==========================================================================
   Canvas Image Generation for Exports
   ========================================================================== */

interface IshikawaImageResult {
  imgData: string;
  width: number;
  height: number;
}

/**
 * Smart word-wrapping that also breaks long words character-by-character
 * when they exceed the available width.
 */
function wrapCanvasTextSmart(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  if (!text) return 0;
  text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;

  const words = text.split(' ');
  let line = '';
  let ly = y;
  let lines = 0;

  for (const word of words) {
    // If the word alone exceeds maxWidth, we need to character-break it
    if (ctx.measureText(word).width > maxWidth) {
      // Flush the current line first
      if (line) {
        ctx.fillText(line, x, ly);
        ly += lineHeight;
        lines++;
        line = '';
      }
      // Break the long word character by character
      let chunk = '';
      for (const char of word) {
        const test = chunk + char;
        if (ctx.measureText(test).width > maxWidth && chunk) {
          ctx.fillText(chunk, x, ly);
          ly += lineHeight;
          lines++;
          chunk = char;
        } else {
          chunk = test;
        }
      }
      if (chunk) {
        line = chunk;
      }
      continue;
    }

    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, ly);
      line = word;
      ly += lineHeight;
      lines++;
    } else {
      line = test;
    }
  }

  if (line) {
    ctx.fillText(line, x, ly);
    lines++;
  }

  return lines;
}

/** Counts lines that smart wrapping would produce (for height calculation) */
function countWrapLinesSmart(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): number {
  if (!text) return 0;
  text = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return 0;

  const words = text.split(' ');
  let line = '';
  let lines = 0;

  for (const word of words) {
    if (ctx.measureText(word).width > maxWidth) {
      if (line) { lines++; line = ''; }
      // Count character breaks
      let chunk = '';
      for (const char of word) {
        const test = chunk + char;
        if (ctx.measureText(test).width > maxWidth && chunk) {
          lines++;
          chunk = char;
        } else {
          chunk = test;
        }
      }
      if (chunk) line = chunk;
      continue;
    }

    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines++;
      line = word;
    } else {
      line = test;
    }
  }

  if (line) lines++;
  return lines;
}

/** Generates an Ishikawa diagram image on a canvas — professional fishbone, full text readable */
export function createSimplifiedIshikawa(
  ishikawaData?: RCAIshikawa,
  problemaText?: string
): IshikawaImageResult | null {
  const canvas = document.createElement('canvas');
  const CANVAS_W = 1600;
  canvas.width = CANVAS_W;
  let canvasH = 580;
  const ctx = canvas.getContext('2d')!;
  if (!ctx) return null;

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 500);
  bgGrad.addColorStop(0, '#f8fafc');
  bgGrad.addColorStop(1, '#ffffff');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, canvas.width, canvasH);

  const categories = CATEGORY_ORDER.map(key => ({
    key,
    label: ISHIKAWA_CATEGORY_CONFIG[key].label,
    value: ishikawaData
      ? (ishikawaData[key] || '')
      : ((document.getElementById(`ishikawa-${key}`) as HTMLTextAreaElement)?.value || '').trim()
  }));

  const hasData = categories.some(c => c.value);
  if (!hasData) {
    ctx.font = '14px Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText('No hay datos de Ishikawa disponibles', CANVAS_W / 2, 280);
    const scNoData = upscaleCanvas(canvas, 4);
    return { imgData: scNoData.toDataURL(), width: scNoData.width, height: scNoData.height };
  }

  // ═══════════════════════════════════════════════
  //  LAYOUT CONSTANTS — larger & roomier
  // ═══════════════════════════════════════════════

  const CARD_W = 220;           // wider cards for long text
  const CARD_R = 10;
  const HEADER_H = 36;
  const CONTENT_PAD = 48;
  const CONTENT_BOT = 14;
  const MIN_CARD_H = 120;
  const LINE_H = 17;            // bigger line-height
  const CARD_TEXT_MAX_W = CARD_W - 24;
  const FONT_SIZE_CARD = '12px Arial, sans-serif';
  const FONT_SIZE_HEADER = 'bold 14px Arial, sans-serif';

  // 3 columns, more spread out
  const colCenters = [180, 470, 760];
  const cardUpperXs = [70, 360, 650];
  const cardLowerXs = [70, 360, 650];
  const contactXs = [310, 600, 890];

  const spineY = 290;
  const upperCardY = 30;
  const lowerCardY = 418;

  // ── Dynamic card heights ──
  ctx.font = FONT_SIZE_CARD;
  const cardHeights = categories.map(cat => {
    if (!cat.value) return MIN_CARD_H;
    const lines = countWrapLinesSmart(ctx, cat.value, CARD_TEXT_MAX_W);
    const contentH = lines * LINE_H;
    return Math.max(MIN_CARD_H, HEADER_H + CONTENT_PAD + contentH + CONTENT_BOT);
  });

  // Dynamic spine position based on upper cards
  let maxUpperBottom = 0;
  cardHeights.slice(0, 3).forEach(h => {
    maxUpperBottom = Math.max(maxUpperBottom, upperCardY + h);
  });

  const MIN_GAP = 40;
  let spineShift = 0;
  if (maxUpperBottom + MIN_GAP > spineY) {
    spineShift = maxUpperBottom + MIN_GAP - spineY;
  }
  const newSpineY = spineY + spineShift;
  const newLowerY = lowerCardY + spineShift;

  // Grow canvas height to fit
  cardHeights.slice(0, 3).forEach(h => {
    const bottom = upperCardY + h + 40;
    if (bottom > canvasH) canvasH = bottom;
  });
  cardHeights.slice(3, 6).forEach(h => {
    const bottom = newLowerY + h + 40;
    if (bottom > canvasH) canvasH = bottom;
  });

  // ── Problem box ──
  const pbW = 320;
  const problema =
    problemaText ||
    (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() ||
    'No definido';
  ctx.font = '13px Arial, sans-serif';
  const pbLines = countWrapLinesSmart(ctx, problema, pbW - 36);
  const pbContentH = pbLines * 18;
  const pbH = Math.max(130, 60 + pbContentH);
  const pbX = CANVAS_W - pbW - 36;
  const pbY = Math.max(newSpineY - Math.floor(pbH / 2) + 10, upperCardY + 20);
  const pbBottom = pbY + pbH + 40;
  if (pbBottom > canvasH) canvasH = pbBottom;

  // ── Finalise canvas ──
  canvas.height = canvasH;
  // Re-draw background for full height
  const bgGrad2 = ctx.createLinearGradient(0, 0, 0, canvasH);
  bgGrad2.addColorStop(0, '#f8fafc');
  bgGrad2.addColorStop(1, '#ffffff');
  ctx.fillStyle = bgGrad2;
  ctx.fillRect(0, 0, canvas.width, canvasH);
  ctx.lineCap = 'round';

  // ═══════════════════════════════════════════════
  //  DRAW FISHBONE
  // ═══════════════════════════════════════════════

  // ── Shadow helper ──
  function cardShadow(x: number, y: number, w: number, h: number, r: number) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x + 1, y + 2, w, h, r);
    ctx.fill();
    ctx.restore();
  }

  // ── Fish tail (navy) ──
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(130, newSpineY);
  ctx.lineTo(80, newSpineY - 48);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(130, newSpineY);
  ctx.lineTo(80, newSpineY + 48);
  ctx.stroke();
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(80, newSpineY - 48);
  ctx.lineTo(80, newSpineY + 48);
  ctx.stroke();

  // ── Spine ──
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(130, newSpineY);
  const spineEnd = pbX - 16;
  ctx.lineTo(spineEnd, newSpineY);
  ctx.stroke();

  // ── Arrow tip (towards problem box) ──
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.moveTo(spineEnd, newSpineY);
  ctx.lineTo(spineEnd - 12, newSpineY - 8);
  ctx.lineTo(spineEnd - 12, newSpineY + 8);
  ctx.closePath();
  ctx.fill();

  // ── Contact marks ──
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  contactXs.forEach(x => {
    ctx.moveTo(x, newSpineY - 10);
    ctx.lineTo(x, newSpineY + 10);
  });
  ctx.stroke();

  // ── Branches (blue) ──
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  categories.slice(0, 3).forEach((_cat, i) => {
    const ch = cardHeights[i];
    const branchY1 = upperCardY + ch;
    ctx.beginPath();
    ctx.moveTo(colCenters[i], branchY1);
    ctx.lineTo(contactXs[i], newSpineY);
    ctx.stroke();
  });
  categories.slice(3, 6).forEach((_cat, i) => {
    ctx.beginPath();
    ctx.moveTo(colCenters[i], newLowerY);
    ctx.lineTo(contactXs[i], newSpineY);
    ctx.stroke();
  });

  // ── Cards ──
  const catColors: Record<string, string> = {
    maquina: '#dbeafe', metodo: '#dcfce7', materiales: '#fef3c7',
    manoObra: '#fce7f3', medicion: '#ede9fe', medioAmbiente: '#ccfbf1'
  };

  categories.forEach((cat, i) => {
    const isUpper = i < 3;
    const x = isUpper ? cardUpperXs[i] : cardLowerXs[i - 3];
    const cy = isUpper ? upperCardY : newLowerY;
    const h = cardHeights[i];
    const hasContent = !!cat.value;

    // Shadow
    cardShadow(x, cy, CARD_W, h, CARD_R);

    // Card fill
    ctx.lineWidth = 1.5;
    ctx.fillStyle = catColors[cat.key] || '#f1f5f9';
    ctx.strokeStyle = hasContent ? '#3b82f6' : '#cbd5e1';
    roundRect(ctx, x, cy, CARD_W, h, CARD_R);
    ctx.fill();
    ctx.stroke();

    // Header separator
    ctx.strokeStyle = hasContent ? '#93c5fd' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 12, cy + HEADER_H);
    ctx.lineTo(x + CARD_W - 12, cy + HEADER_H);
    ctx.stroke();

    // Category label
    ctx.fillStyle = '#1e3a5f';
    ctx.font = FONT_SIZE_HEADER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cat.label, x + CARD_W / 2, cy + 18);

    // Content text
    if (hasContent) {
      ctx.fillStyle = '#1e40af';
      ctx.font = FONT_SIZE_CARD;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      wrapCanvasTextSmart(ctx, cat.value, x + 12, cy + CONTENT_PAD, CARD_TEXT_MAX_W, LINE_H);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 12px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('—', x + CARD_W / 2, cy + h / 2 + 6);
    }
  });

  // ── Problem box ──
  // Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(30, 58, 95, 0.25)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#1e3a5f';
  roundRect(ctx, pbX, pbY, pbW, pbH, 14);
  ctx.fill();
  ctx.restore();

  // Re-draw on top (shadow was for the background only)
  ctx.fillStyle = '#1e3a5f';
  roundRect(ctx, pbX, pbY, pbW, pbH, 14);
  ctx.fill();

  // Problem box inner glow
  const pbGrad = ctx.createLinearGradient(pbX, pbY, pbX, pbY + pbH);
  pbGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
  pbGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = pbGrad;
  roundRect(ctx, pbX, pbY, pbW, pbH, 14);
  ctx.fill();

  // Title
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('PROBLEMA', pbX + pbW / 2, pbY + 18);

  // Separator line
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pbX + 28, pbY + 38);
  ctx.lineTo(pbX + pbW - 28, pbY + 38);
  ctx.stroke();

  // Problem text
  ctx.fillStyle = '#93c5fd';
  ctx.font = '13px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  wrapCanvasTextSmart(ctx, problema, pbX + 18, pbY + 48, pbW - 36, 18);

  const scIshikawa = upscaleCanvas(canvas, 4);
  return { imgData: scIshikawa.toDataURL(), width: scIshikawa.width, height: scIshikawa.height };
}

/** Generates a Pareto chart image on a canvas — modern, no text cut off */
export function createSimplifiedPareto(paretoItems?: ParetoItem[]): IshikawaImageResult | null {
  const items = (paretoItems || []).slice().sort((a, b) => b.frecuencia - a.frecuencia);

  if (items.length === 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText('No hay datos de Pareto disponibles', 150, 150);
    const scParetoEmpty = upscaleCanvas(canvas, 4);
    return { imgData: scParetoEmpty.toDataURL(), width: scParetoEmpty.width, height: scParetoEmpty.height };
  }

  const maxFreq = Math.max(...items.map(item => item.frecuencia));
  const totalFreq = items.reduce((sum, item) => sum + item.frecuencia, 0);

  // Wider canvas
  const CANVAS_W = 600;
  const CHART_PADDING = { top: 50, right: 70, bottom: 72, left: 64 };

  const barSpacing = (CANVAS_W - CHART_PADDING.left - CHART_PADDING.right) / items.length;
  const barWidth = Math.min(barSpacing * 0.55, 48);
  const maxLabelWidth = Math.max(barWidth + 8, 40);

  // Count required lines for each label (with character-level breaking)
  const tempCtx = document.createElement('canvas').getContext('2d')!;
  tempCtx.font = 'bold 8px Inter, Arial, sans-serif';

  let maxLines = 0;
  items.forEach(item => {
    const lines = countWrapLinesSmart(tempCtx, item.causa, maxLabelWidth);
    maxLines = Math.max(maxLines, lines);
  });

  const labelAreaH = Math.max(maxLines * 11, 14);
  CHART_PADDING.bottom = 22 + labelAreaH + 12;
  const bottomPad = CHART_PADDING.bottom;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  // Calculate total height: top + chart area + bottom label area
  canvas.height = CHART_PADDING.top + 260 + labelAreaH + 40;
  const ctx = canvas.getContext('2d')!;

  // ── Background ──
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#f8fafc');
  gradient.addColorStop(1, '#ffffff');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── Title ──
  ctx.fillStyle = '#1e3a5f';
  ctx.font = 'bold 15px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('Análisis de Pareto', canvas.width / 2, 12);

  // Subtitle
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px Inter, Arial, sans-serif';
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  ctx.fillText(`Generado: ${formatDateDDMMYYYY(todayISO)}`, canvas.width / 2, 30);

  const m = { top: 50, right: 70, bottom: bottomPad, left: 64 };
  const chartWidth = canvas.width - m.left - m.right;
  const chartHeight = canvas.height - m.top - m.bottom;
  const startX = m.left;
  const startY = canvas.height - m.bottom;

  // ── Grid lines ──
  const gridSteps = 4;
  for (let i = 0; i <= gridSteps; i++) {
    const y = startY - (i * chartHeight / gridSteps);
    const freqValue = Math.round(maxFreq * i / gridSteps);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(startX, y);
    ctx.lineTo(canvas.width - m.right, y);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 9px Inter, Arial, sans-serif';
    ctx.textAlign = 'end';
    ctx.textBaseline = 'middle';
    ctx.fillText(freqValue.toString(), startX - 10, y);
  }

  // ── Right axis (cumulative %) ──
  for (let i = 0; i <= gridSteps; i++) {
    const y = startY - (i * chartHeight / gridSteps);
    const pctValue = Math.round(100 * i / gridSteps);
    ctx.fillStyle = '#dc2626';
    ctx.font = 'bold 9px Inter, Arial, sans-serif';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'middle';
    ctx.fillText(pctValue + '%', canvas.width - m.right + 10, y);
  }

  // ── Axes ──
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startX, m.top);
  ctx.lineTo(startX, startY);
  ctx.lineTo(canvas.width - m.right, startY);
  ctx.stroke();

  // ── 80% reference line ──
  const eightyY = startY - (0.8 * chartHeight);
  ctx.strokeStyle = 'rgba(220, 38, 38, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(startX, eightyY);
  ctx.lineTo(canvas.width - m.right, eightyY);
  ctx.stroke();
  ctx.setLineDash([]);

  // "80%" label
  ctx.fillStyle = 'rgba(220, 38, 38, 0.5)';
  ctx.font = 'italic 8px Inter, Arial, sans-serif';
  ctx.textAlign = 'end';
  ctx.textBaseline = 'bottom';
  ctx.fillText('80%', canvas.width - m.right - 4, eightyY - 2);

  // ── Bars ──
  const barColors = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe'];
  let acumulado = 0;
  const linePoints: { x: number; y: number; pct: number; label: string; count: number }[] = [];

  items.forEach((item, index) => {
    const barHeight = Math.max((item.frecuencia / maxFreq) * chartHeight, 2);
    const x = startX + (index * barSpacing) + (barSpacing - barWidth) / 2;
    const y = startY - barHeight;

    // Bar shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    roundRect(ctx, x + 2, y + 2, barWidth, barHeight, 3);
    ctx.fill();

    // Bar fill with gradient
    const barColor = barColors[index % barColors.length];
    const grad = ctx.createLinearGradient(x, y, x, startY);
    grad.addColorStop(0, barColor);
    grad.addColorStop(1, barColor + '99');
    ctx.fillStyle = grad;
    ctx.strokeStyle = barColor;
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, barWidth, barHeight, 3);
    ctx.fill();
    ctx.stroke();

    // Frequency count inside bar
    if (barHeight > 20) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 8px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(item.frecuencia), x + barWidth / 2, y + barHeight / 2);
    } else {
      // Show count above bar if too short
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 8px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(String(item.frecuencia), x + barWidth / 2, y - 2);
    }

    // X-axis label (smart wrapped with character-level breaking)
    ctx.fillStyle = '#334155';
    ctx.font = 'bold 8px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    wrapCanvasTextSmart(ctx, item.causa, x + barWidth / 2, startY + 6, maxLabelWidth, 11);

    acumulado += item.frecuencia;
    const cumPct = (acumulado / totalFreq) * 100;
    const lineX = x + barWidth / 2;
    const lineY = startY - (cumPct / 100) * chartHeight;
    linePoints.push({ x: lineX, y: lineY, pct: cumPct, label: cumPct.toFixed(0) + '%', count: item.frecuencia });
  });

  // ── Cumulative line ──
  if (linePoints.length > 0) {
    // Area under curve
    ctx.beginPath();
    ctx.moveTo(linePoints[0].x, startY);
    linePoints.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(linePoints[linePoints.length - 1].x, startY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(220, 38, 38, 0.04)';
    ctx.fill();

    // Line
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(linePoints[0].x, linePoints[0].y);
    for (let i = 1; i < linePoints.length; i++) {
      ctx.lineTo(linePoints[i].x, linePoints[i].y);
    }
    ctx.stroke();

    // Dots
    linePoints.forEach((pt, i) => {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Percentage labels for key points
      if (i === 0 || i === linePoints.length - 1 || pt.pct >= 75) {
        ctx.fillStyle = '#dc2626';
        ctx.font = 'bold 9px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const label = pt.label;
        const labelW = ctx.measureText(label).width;
        const lx = pt.x;
        const ly = pt.y - 10;
        // Small label background
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        roundRect(ctx, lx - labelW / 2 - 3, ly - 6, labelW + 6, 14, 4);
        ctx.fill();
        ctx.fillStyle = '#dc2626';
        ctx.font = 'bold 9px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, lx, ly + 1);
      }
    });
  }

  // ── Legend (below all label lines) ──
  const legendY = startY + labelAreaH + 14;
  ctx.fillStyle = '#64748b';
  ctx.font = '8px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Bar legend
  const barLegendX = canvas.width / 2 - 90;
  ctx.fillStyle = barColors[0];
  roundRect(ctx, barLegendX, legendY, 12, 10, 2);
  ctx.fill();
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 9px Inter, Arial, sans-serif';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';
  ctx.fillText('Frecuencia', barLegendX + 17, legendY);

  // Line legend
  const lineLegendX = canvas.width / 2 + 20;
  ctx.strokeStyle = '#dc2626';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(lineLegendX, legendY + 5);
  ctx.lineTo(lineLegendX + 24, legendY + 5);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(lineLegendX + 12, legendY + 5, 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#dc2626';
  ctx.fill();
  ctx.fillStyle = '#475569';
  ctx.font = 'bold 9px Inter, Arial, sans-serif';
  ctx.textAlign = 'start';
  ctx.textBaseline = 'top';
  ctx.fillText('% Acumulado', lineLegendX + 30, legendY);

  const scPareto = upscaleCanvas(canvas, 4);
  return { imgData: scPareto.toDataURL(), width: scPareto.width, height: scPareto.height };
}
