import { head } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const BLOB_FILENAME = 'analysis.json';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(200).json({ blobUnavailable: true });
  }

  try {
    const meta = await head(BLOB_FILENAME);
    if (!meta) return res.status(200).json({ analyses: [] });

    // cache=0 bypasses the CDN so reads after an overwrite always reflect
    // the latest write (Vercel Blob overwrites may otherwise be stale up to 60s)
    const url = new URL(meta.downloadUrl);
    url.searchParams.set('cache', '0');
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    const record = await resp.json();
    // Support both old format (single record) and new format (array)
    const analyses = record.analyses || (record.data ? [record] : []);
    res.status(200).json({ analyses });
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.message?.includes('not found')) {
      return res.status(200).json({ analyses: [] });
    }
    res.status(200).json({ blobUnavailable: true });
  }
}
