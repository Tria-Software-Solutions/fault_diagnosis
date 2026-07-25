/** Normaliza un texto: minúsculas, sin tildes, sin espacios */
export function normalizeText(text: string = ''): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Escapa caracteres HTML para prevenir XSS */
export function escapeHtml(text: string = ''): string {
  return text
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Filtra valores duplicados (sin importar tildes) */
export function uniqueValues(values: string[] = []): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const cleanValue = value?.toString().trim();
    if (!cleanValue) return false;
    const normalized = normalizeText(cleanValue);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/** Divide texto por saltos de línea, comas o punto y coma */
export function splitTextValues(text: string = ''): string[] {
  return uniqueValues(
    text
      .split(/[\n,;]+/)
      .map(value => value.trim())
      .filter(Boolean)
  );
}

/** Filtra entradas válidas: máximo 4 palabras y 40 caracteres */
export function sanitizeKeywordEntries(values: string[] = []): string[] {
  return uniqueValues(values).filter(value => {
    const wordCount = value.trim().split(/\s+/).length;
    return wordCount <= 4 && value.trim().length <= 40;
  });
}

/** Trunca texto a una longitud máxima */
export function truncateText(text: string = '', maxLength: number = 80): string {
  const cleanText = text.toString().trim();
  if (cleanText.length <= maxLength) return cleanText;
  return `${cleanText.substring(0, maxLength - 3)}...`;
}

/** Obtiene la fecha actual en formato ISO (YYYY-MM-DD) */
export function getTodayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Convierte una fecha ISO (YYYY-MM-DD) al formato DD-MM-YYYY.
 * Ejemplo: "2026-07-24" → "24-07-2026"
 * Válida que los componentes sean numéricos antes de transformar.
 */
export function formatDateDDMMYYYY(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  // Validate that all parts are numeric (YYYY, MM, DD)
  if (!/^\d{4}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1]) || !/^\d{2}$/.test(parts[2])) {
    return isoDate;
  }
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}
