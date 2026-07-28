import { CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, type RCAIshikawa } from '../state/store';
import { roundRect, upscaleCanvas } from '../utils/dom';

/** Re-export utilities needed by Pareto and other canvas functions */
export { roundRect, upscaleCanvas } from '../utils/dom';

/* ==========================================================================
   Canvas Ishikawa Renderer — shared across PDF, main tab, and modals
   ========================================================================== */

export interface IshikawaImageResult {
  imgData: string;
  width: number;
  height: number;
}

/**
 * Smart word-wrapping that also breaks long words character-by-character
 * when they exceed the available width.
 */
export function wrapCanvasTextSmart(
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
    if (ctx.measureText(word).width > maxWidth) {
      if (line) {
        ctx.fillText(line, x, ly);
        ly += lineHeight;
        lines++;
        line = '';
      }
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
export function countWrapLinesSmart(
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

/** Generates an Ishikawa diagram image on a canvas — professional fishbone, full text readable
 *
 * @param ishikawaData - Category data
 * @param problemaText - Problem description
 * @param upscale - Upscale factor for the final image.
 *   1 = no upscale (best for screen, fastest, ~200KB),
 *   2 = 2x (good for retina screen, ~800KB),
 *   4 = 4x (print quality for PDF, ~3MB). Default: 2.
 */
export function createIshikawaImage(
  ishikawaData?: RCAIshikawa,
  problemaText?: string,
  upscale: number = 2
): IshikawaImageResult | null {
  const canvas = document.createElement('canvas');
  const CANVAS_W = 2000;
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
    ctx.font = '36px Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText('No hay datos de Ishikawa disponibles', CANVAS_W / 2, 350);
    const scNoData = upscaleCanvas(canvas, upscale);
    return { imgData: scNoData.toDataURL(), width: scNoData.width, height: scNoData.height };
  }

  // ═══════════════════════════════════════════════
  //  LAYOUT CONSTANTS — larger & roomier (1.25× scale)
  // ═══════════════════════════════════════════════

  const CARD_W = 280;
  const CARD_R = 12;
  const HEADER_H = 56;
  const CONTENT_PAD = 86;
  const CONTENT_BOT = 24;
  const MIN_CARD_H = 200;
  const LINE_H = 48;
  const CARD_TEXT_MAX_W = CARD_W - 44;
  const FONT_SIZE_CARD = '38px Inter, Arial, sans-serif';
  const FONT_SIZE_HEADER = 'bold 38px Inter, Arial, sans-serif';

  const colCenters = [230, 590, 950];
  const cardUpperXs = [90, 450, 810];
  const cardLowerXs = [90, 450, 810];
  const contactXs = [390, 750, 1110];

  const spineY = 300;
  const upperCardY = 38;
  const lowerCardY = 438;

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
  const pbW = 400;
  const problema =
    problemaText ||
    (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() ||
    'No definido';
  ctx.font = '38px Inter, Arial, sans-serif';
  const pbLines = countWrapLinesSmart(ctx, problema, pbW - 44);
  const pbContentH = pbLines * 48;
  const pbH = Math.max(200, 100 + pbContentH);
  const pbX = CANVAS_W - pbW - 44;
  const pbY = Math.max(newSpineY - Math.floor(pbH / 2) + 10, upperCardY + 20);
  const pbBottom = pbY + pbH + 40;
  if (pbBottom > canvasH) canvasH = pbBottom;

  // ── Finalise canvas ──
  canvas.height = canvasH;
  const bgGrad2 = ctx.createLinearGradient(0, 0, 0, canvasH);
  bgGrad2.addColorStop(0, '#f8fafc');
  bgGrad2.addColorStop(1, '#ffffff');
  ctx.fillStyle = bgGrad2;
  ctx.fillRect(0, 0, canvas.width, canvasH);
  ctx.lineCap = 'round';

  // ═══════════════════════════════════════════════
  //  DRAW FISHBONE
  // ═══════════════════════════════════════════════

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

  // ── Fish tail (navy) — proportional to the problem box ──
  const tailBaseX = 150;
  const tailFinX = 130;
  const tailFinH = 22;
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tailBaseX, newSpineY);
  ctx.lineTo(tailFinX, newSpineY - tailFinH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tailBaseX, newSpineY);
  ctx.lineTo(tailFinX, newSpineY + tailFinH);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(tailFinX, newSpineY - tailFinH);
  ctx.lineTo(tailFinX, newSpineY + tailFinH);
  ctx.stroke();

  // ── Spine ──
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(tailBaseX, newSpineY);
  const spineEnd = pbX - 16;
  ctx.lineTo(spineEnd, newSpineY);
  ctx.stroke();

  // ── Arrow tip ──
  ctx.fillStyle = '#2563eb';
  ctx.beginPath();
  ctx.moveTo(spineEnd, newSpineY);
  ctx.lineTo(spineEnd - 40, newSpineY - 12);
  ctx.lineTo(spineEnd - 40, newSpineY + 12);
  ctx.closePath();
  ctx.fill();

  // ── Contact marks ──
  ctx.strokeStyle = '#1e3a5f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  contactXs.forEach(x => {
    ctx.moveTo(x, newSpineY - 12);
    ctx.lineTo(x, newSpineY + 12);
  });
  ctx.stroke();

  // ── Branches (blue) ──
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 4;
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

    cardShadow(x, cy, CARD_W, h, CARD_R);

    ctx.lineWidth = 1.5;
    ctx.fillStyle = catColors[cat.key] || '#f1f5f9';
    ctx.strokeStyle = hasContent ? '#3b82f6' : '#cbd5e1';
    roundRect(ctx, x, cy, CARD_W, h, CARD_R);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = hasContent ? '#93c5fd' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 22, cy + HEADER_H);
    ctx.lineTo(x + CARD_W - 22, cy + HEADER_H);
    ctx.stroke();

    ctx.fillStyle = '#1e3a5f';
    ctx.font = FONT_SIZE_HEADER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cat.label, x + CARD_W / 2, cy + 28);

    if (hasContent) {
      ctx.fillStyle = '#1e40af';
      ctx.font = FONT_SIZE_CARD;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      wrapCanvasTextSmart(ctx, cat.value, x + 22, cy + CONTENT_PAD, CARD_TEXT_MAX_W, LINE_H);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 28px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('—', x + CARD_W / 2, cy + h / 2 + 6);
    }
  });

  // ── Problem box ──
  ctx.save();
  ctx.shadowColor = 'rgba(30, 58, 95, 0.25)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#1e3a5f';
  roundRect(ctx, pbX, pbY, pbW, pbH, 14);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#1e3a5f';
  roundRect(ctx, pbX, pbY, pbW, pbH, 14);
  ctx.fill();

  const pbGrad = ctx.createLinearGradient(pbX, pbY, pbX, pbY + pbH);
  pbGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
  pbGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = pbGrad;
  roundRect(ctx, pbX, pbY, pbW, pbH, 14);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('PROBLEMA', pbX + pbW / 2, pbY + 26);

  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pbX + 32, pbY + 62);
  ctx.lineTo(pbX + pbW - 32, pbY + 62);
  ctx.stroke();

  ctx.fillStyle = '#93c5fd';
  ctx.font = '38px Inter, Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  wrapCanvasTextSmart(ctx, problema, pbX + 22, pbY + 76, pbW - 44, 48);

  const scIshikawa = upscaleCanvas(canvas, upscale);
  return { imgData: scIshikawa.toDataURL(), width: scIshikawa.width, height: scIshikawa.height };
}
