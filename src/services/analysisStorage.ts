/* ==========================================================================
   Analysis Storage Service
   Communicates with the Vite API middleware to save/load/check/delete
   analysis entries in the project's analyses/ directory.
   Now stores an array of AnalysisEntry instead of a single object.
   Falls back to localStorage when the API is unavailable.
   ========================================================================== */

import type { RCAData, AnalysisEntry } from '../state/store';

const LS_KEY = 'savedAnalyses';

/* ---------- localStorage fallback helpers ---------- */

function lsLoadAll(): AnalysisEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function lsSaveAll(entries: AnalysisEntry[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(entries)); } catch { /* ignore */ }
}

function lsAppend(entry: AnalysisEntry): void {
  const entries = lsLoadAll();
  entries.push(entry);
  lsSaveAll(entries);
}

function lsDeleteAll(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

/* ---------- Server API with localStorage fallback ---------- */

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Error en la comunicación con el servidor');
  }
  const data = await res.json();
  if (data && typeof data === 'object' && (data as any).blobUnavailable) {
    throw new Error('Almacenamiento en servidor no disponible');
  }
  return data;
}

/** Saves a new analysis entry (appends to the existing list) */
export async function saveAnalysisFile(data: RCAData): Promise<void> {
  const entry: AnalysisEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2),
    savedAt: new Date().toISOString(),
    data,
  };

  try {
    // First, try to load existing entries, then append
    let existing: AnalysisEntry[] = [];
    try {
      const resp = await apiFetch<{ analyses: AnalysisEntry[] }>('/api/load-analysis');
      existing = resp.analyses || [];
    } catch {
      existing = lsLoadAll();
    }
    existing.push(entry);
    await apiFetch<{ success: boolean }>('/api/save-analysis', {
      method: 'POST',
      body: JSON.stringify({ analyses: existing }),
    });
    // Sync localStorage as well
    lsSaveAll(existing);
  } catch {
    lsAppend(entry);
  }
}

interface CheckResult {
  exists: boolean;
  count: number;
}

/** Checks if there are any saved analyses */
export async function checkAnalysisFile(): Promise<CheckResult> {
  try {
    const apiResult = await apiFetch<CheckResult>('/api/check-analysis');
    if (apiResult.exists) return apiResult;
    const local = lsLoadAll();
    return { exists: local.length > 0, count: local.length };
  } catch {
    const local = lsLoadAll();
    return { exists: local.length > 0, count: local.length };
  }
}

/** Loads all saved analysis entries */
export async function loadAnalysis(): Promise<AnalysisEntry[]> {
  try {
    const apiResult = await apiFetch<{ analyses: AnalysisEntry[] }>('/api/load-analysis');
    return apiResult.analyses || [];
  } catch {
    return lsLoadAll();
  }
}

/** Replaces the entire analysis list (for updates/deletes) */
export async function updateAnalysisFile(data: RCAData): Promise<void> {
  // Legacy support — not used for multi-entry. Use saveAnalysisFile instead.
  await saveAnalysisFile(data);
}

/** Deletes all saved analyses */
export async function deleteAnalysis(): Promise<void> {
  try {
    await apiFetch<{ success: boolean }>('/api/delete-analysis', {
      method: 'DELETE',
    });
    lsDeleteAll();
  } catch {
    lsDeleteAll();
  }
}

/** Deletes a single analysis by id */
export async function deleteAnalysisById(id: string): Promise<void> {
  try {
    let existing: AnalysisEntry[] = [];
    try {
      const resp = await apiFetch<{ analyses: AnalysisEntry[] }>('/api/load-analysis');
      existing = resp.analyses || [];
    } catch {
      existing = lsLoadAll();
    }
    const filtered = existing.filter(e => e.id !== id);
    // If empty after removal, delete the file entirely
    if (filtered.length === 0) {
      await deleteAnalysis();
      return;
    }
    await apiFetch<{ success: boolean }>('/api/save-analysis', {
      method: 'POST',
      body: JSON.stringify({ analyses: filtered }),
    });
    lsSaveAll(filtered);
  } catch {
    const existing = lsLoadAll();
    const filtered = existing.filter(e => e.id !== id);
    lsSaveAll(filtered);
  }
}

/** Updates a single analysis entry by id (reads list, replaces entry, saves) */
export async function updateEntryById(id: string, data: RCAData): Promise<void> {
  try {
    let existing: AnalysisEntry[] = [];
    try {
      const resp = await apiFetch<{ analyses: AnalysisEntry[] }>('/api/load-analysis');
      existing = resp.analyses || [];
    } catch {
      existing = lsLoadAll();
    }
    const idx = existing.findIndex(e => e.id === id);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], savedAt: new Date().toISOString(), data };
    } else {
      // If not found, append
      existing.push({ id, savedAt: new Date().toISOString(), data });
    }
    await apiFetch<{ success: boolean }>('/api/save-analysis', {
      method: 'POST',
      body: JSON.stringify({ analyses: existing }),
    });
    lsSaveAll(existing);
  } catch {
    // Fallback: update in localStorage
    let existing = lsLoadAll();
    const idx = existing.findIndex(e => e.id === id);
    if (idx >= 0) {
      existing[idx] = { ...existing[idx], savedAt: new Date().toISOString(), data };
    } else {
      existing.push({ id, savedAt: new Date().toISOString(), data });
    }
    lsSaveAll(existing);
  }
}
