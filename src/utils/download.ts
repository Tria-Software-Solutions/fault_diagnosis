/* ==========================================================================
   File Save Helper — success feedback only after the user accepts the save
   dialog. Uses the File System Access API (showSaveFilePicker) when
   available, which resolves when the user accepts and rejects with
   AbortError when they cancel. Falls back to the classic anchor download
   on browsers without the API (acceptance can't be detected there, so we
   show the toast immediately as before).
   ========================================================================== */

export type SaveResult = 'saved' | 'cancelled' | 'fallback';

interface SaveFilePickerHandle {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
}

/**
 * Saves a Blob to disk.
 * - 'saved'     → user accepted the save dialog (File System Access API)
 * - 'cancelled' → user cancelled the save dialog
 * - 'fallback'  → classic download used (acceptance not detectable)
 */
export async function saveBlob(blob: Blob, filename: string, mimeType: string): Promise<SaveResult> {
  const picker = (window as unknown as { showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<SaveFilePickerHandle> }).showSaveFilePicker;

  if (typeof picker === 'function') {
    try {
      const ext = (filename.split('.').pop() || 'bin').toLowerCase();
      const handle = await picker({
        suggestedName: filename,
        types: [{ description: 'Documento', accept: { [mimeType]: ['.' + ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (error) {
      // User cancelled the dialog (AbortError) → no success toast
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
      // Any other failure (e.g. no user gesture) → fall through to classic download
    }
  }

  // Classic download (no acceptance signal available)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'fallback';
}
