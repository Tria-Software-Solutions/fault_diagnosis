import { CATEGORY_ORDER, ISHIKAWA_CATEGORY_CONFIG, type RCAIshikawa } from '../state/store';
import { upscaleCanvas } from '../utils/dom';

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

  // Background — plain white (no colors)
  ctx.fillStyle = '#ffffff';
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
    ctx.font = '28px Arial';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.fillText('No hay datos de Ishikawa disponibles', CANVAS_W / 2, 350);
    const scNoData = upscaleCanvas(canvas, upscale);
    return { imgData: scNoData.toDataURL(), width: scNoData.width, height: scNoData.height };
  }

  // ═══════════════════════════════════════════════
  //  LAYOUT CONSTANTS — compact, web-sized text
  // ═══════════════════════════════════════════════

  const CARD_W = 280;
  const CONTENT_PAD = 74;
  const LINE_H = 34;
  const CARD_TEXT_MAX_W = CARD_W - 44;
  const FONT_SIZE_CARD = '26px Inter, Arial, sans-serif';
  const FONT_SIZE_HEADER = 'bold 26px Inter, Arial, sans-serif';

  // Columns spread across the full available width (tail → problem box)
  const colCenters = [360, 800, 1240];
  const cardUpperXs = [220, 660, 1100];
  const cardLowerXs = [220, 660, 1100];
  const contactXs = [440, 880, 1320];

  const spineY = 300;

  // ── Dynamic content heights (no phantom cards) ──
  ctx.font = FONT_SIZE_CARD;
  const contentLines = categories.map(cat =>
    cat.value ? countWrapLinesSmart(ctx, cat.value, CARD_TEXT_MAX_W) : 0
  );
  const contentH = contentLines.map(lines => lines * LINE_H);

  // Uniform ribs: every branch spans the same vertical distance from the spine,
  // so all 6 branches share the exact same inclination and length.
  const RIB_V = 140;

  // Upper text blocks are bottom-aligned at newSpineY - RIB_V; shift the spine
  // down if the tallest upper block would overflow the top of the canvas.
  let minUpperTop = Infinity;
  for (let i = 0; i < 3; i++) {
    const top = spineY - RIB_V - CONTENT_PAD - contentH[i];
    if (top < minUpperTop) minUpperTop = top;
  }
  const TOP_MARGIN = 30;
  const spineShift = minUpperTop < TOP_MARGIN ? TOP_MARGIN - minUpperTop : 0;
  const newSpineY = spineY + spineShift;
  const upperBottom = newSpineY - RIB_V; // ribs end at upper block bottoms
  const lowerTop = newSpineY + RIB_V;    // ribs end at lower block tops
  const upperTops = categories.slice(0, 3).map((_c, i) => upperBottom - CONTENT_PAD - contentH[i]);

  // Grow canvas height to fit content
  for (let i = 0; i < 3; i++) {
    const bottom = upperTops[i] + CONTENT_PAD + contentH[i] + 20;
    if (bottom > canvasH) canvasH = bottom;
  }
  for (let i = 3; i < 6; i++) {
    const bottom = lowerTop + CONTENT_PAD + contentH[i] + 30;
    if (bottom > canvasH) canvasH = bottom;
  }

  // ── Problem box ──
  const pbW = 400;
  const problema =
    problemaText ||
    (document.getElementById('descripcionProblema') as HTMLTextAreaElement)?.value?.trim() ||
    'No definido';
  ctx.font = FONT_SIZE_CARD;
  const pbLines = countWrapLinesSmart(ctx, problema, pbW - 44);
  const pbContentH = pbLines * LINE_H;
  const pbH = Math.max(170, 88 + pbContentH);
  const pbX = CANVAS_W - pbW - 44;
  const pbY = Math.max(newSpineY - Math.floor(pbH / 2) + 10, TOP_MARGIN + 20);
  const pbBottom = pbY + pbH + 40;
  if (pbBottom > canvasH) canvasH = pbBottom;

  // ── Finalise canvas ──
  canvas.height = canvasH;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvasH);
  ctx.lineCap = 'round';

  // ═══════════════════════════════════════════════
  //  DRAW FISHBONE
  // ═══════════════════════════════════════════════

  // ── Fish tail — neutral dark slate, proportional to the problem box ──
  const tailBaseX = 150;
  const tailFinX = 130;
  const tailFinH = 22;
  ctx.strokeStyle = '#1e293b';
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
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(tailBaseX, newSpineY);
  const spineEnd = pbX - 6;
  ctx.lineTo(spineEnd, newSpineY);
  ctx.stroke();

  // ── Arrow tip (bigger, reaching toward the problem box) ──
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(spineEnd, newSpineY);
  ctx.lineTo(spineEnd - 64, newSpineY - 20);
  ctx.lineTo(spineEnd - 64, newSpineY + 20);
  ctx.closePath();
  ctx.fill();

  // ── Contact marks ──
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  ctx.beginPath();
  contactXs.forEach(x => {
    ctx.moveTo(x, newSpineY - 12);
    ctx.lineTo(x, newSpineY + 12);
  });
  ctx.stroke();

  // ── Branches — all ribs with identical inclination & length ──
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 4;
  categories.slice(0, 3).forEach((_cat, i) => {
    ctx.beginPath();
    ctx.moveTo(colCenters[i], upperBottom);
    ctx.lineTo(contactXs[i], newSpineY);
    ctx.stroke();
  });
  categories.slice(3, 6).forEach((_cat, i) => {
    ctx.beginPath();
    ctx.moveTo(colCenters[i], lowerTop);
    ctx.lineTo(contactXs[i], newSpineY);
    ctx.stroke();
  });

  // ── Cards — flat, no shadow, no border, no divider ──
  categories.forEach((cat, i) => {
    const isUpper = i < 3;
    const x = isUpper ? cardUpperXs[i] : cardLowerXs[i - 3];
    const cy = isUpper ? upperTops[i] : lowerTop;
    const hasContent = !!cat.value;

    ctx.fillStyle = '#0f172a';
    ctx.font = FONT_SIZE_HEADER;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cat.label, x + CARD_W / 2, cy + 28);

    if (hasContent) {
      ctx.fillStyle = '#334155';
      ctx.font = FONT_SIZE_CARD;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      wrapCanvasTextSmart(ctx, cat.value, x + 22, cy + CONTENT_PAD, CARD_TEXT_MAX_W, LINE_H);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = 'italic 21px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('—', x + CARD_W / 2, cy + CONTENT_PAD + 20);
    }
  });

  // ── Problem box — flat, no shadow, no border, no divider ──
  ctx.fillStyle = '#0f172a';
  ctx.font = FONT_SIZE_HEADER;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('PROBLEMA', pbX + pbW / 2, pbY + 26);

  ctx.fillStyle = '#334155';
  ctx.font = FONT_SIZE_CARD;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  wrapCanvasTextSmart(ctx, problema, pbX + 22, pbY + 70, pbW - 44, LINE_H);

  const scIshikawa = upscaleCanvas(canvas, upscale);
  return { imgData: scIshikawa.toDataURL(), width: scIshikawa.width, height: scIshikawa.height };
}
