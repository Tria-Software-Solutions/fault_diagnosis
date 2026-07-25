import { head, put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_FILENAME = 'analysis.json';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(200).json({ blobUnavailable: true });
  }

  try {
    const meta = await head(BLOB_FILENAME);
    if (!meta) return res.status(200).json({ analyses: [] });

    const resp = await fetch(meta.downloadUrl, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    const record = await resp.json();
    let analyses = record.analyses || (record.data ? [record] : []);

    // Expects { analyses: AnalysisEntry[] } — replaces the full list
    analyses = req.body.analyses || analyses;

    await put(BLOB_FILENAME, JSON.stringify({ analyses }), {
      contentType: 'application/json',
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    res.status(200).json({ success: true, count: analyses.length });
  } catch {
    res.status(200).json({ blobUnavailable: true });
  }
}
