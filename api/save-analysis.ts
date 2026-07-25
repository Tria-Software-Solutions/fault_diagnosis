import { head, put } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_FILENAME = 'analysis.json';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(200).json({ blobUnavailable: true });
  }

  try {
    // Expects { analyses: AnalysisEntry[] }
    const analyses = req.body.analyses || [];
    await put(BLOB_FILENAME, JSON.stringify({ analyses }), {
      contentType: 'application/json',
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    res.status(200).json({ success: true, count: analyses.length, filename: 'analysis.json' });
  } catch {
    res.status(200).json({ blobUnavailable: true });
  }
}
