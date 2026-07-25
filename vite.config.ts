import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'
import type { Connect } from 'vite'

const ANALYSES_DIR = path.resolve(process.cwd(), 'analyses')
const ANALYSIS_FILE = 'analisis.json'

// Ensure analyses directory exists
if (!fs.existsSync(ANALYSES_DIR)) {
  fs.mkdirSync(ANALYSES_DIR, { recursive: true })
}

function getAnalysisPath(): string {
  return path.join(ANALYSES_DIR, ANALYSIS_FILE)
}

function readAnalysisFile(): any | null {
  const fp = getAnalysisPath()
  if (!fs.existsSync(fp)) return null
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch { return null }
}

function writeAnalysisFile(data: any): void {
  // data should be { analyses: AnalysisEntry[] }
  // Store the raw { analyses: [...] } format directly, no wrapping
  fs.writeFileSync(getAnalysisPath(), JSON.stringify(data, null, 2), 'utf-8')
}

/** Normalizes stored content to { analyses: AnalysisEntry[] } format,
 *  supporting migration from:
 *    1. New format: { analyses: [...] }
 *    2. Buggy format: { id, savedAt, data: { analyses: [...] } }
 *    3. Old format: { id, savedAt, data: { captura, ... } } */
function normalizeToAnalyses(content: any): { analyses: any[] } {
  if (!content) return { analyses: [] }
  // New format: { analyses: [...] }
  if (Array.isArray(content.analyses)) return { analyses: content.analyses }
  // Buggy writeAnalysisFile wrapped { analyses: [...] } inside data:
  // { id, savedAt, data: { analyses: [...] } }
  if (content.data && Array.isArray(content.data.analyses)) {
    return { analyses: content.data.analyses }
  }
  // Old format: { id, savedAt, data: { captura, whys, ishikawa, acciones } }
  if (content.data && typeof content.data === 'object') {
    return { analyses: [{ id: content.id || 'legacy', savedAt: content.savedAt || '', data: content.data }] }
  }
  return { analyses: [] }
}

function analysisStoragePlugin(): any {
  return {
    name: 'analysis-storage',
    configureServer(server: any) {
      server.middlewares.use(async (req: Connect.IncomingMessage, res: any, next: Connect.NextFunction) => {
        const url = req.url || ''
        if (!url.startsWith('/api/')) return next()

        // Parse JSON body helper
        function parseBody(): Promise<any> {
          return new Promise((resolve, reject) => {
            let body = ''
            req.on('data', (chunk: string) => { body += chunk })
            req.on('end', () => {
              try { resolve(JSON.parse(body)) } catch { resolve({}) }
            })
            req.on('error', reject)
          })
        }

        function sendJson(data: any, status = 200) {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(data))
        }

        try {
          // POST /api/save-analysis — always writes to analisis.json
          if (url === '/api/save-analysis' && req.method === 'POST') {
            const body = await parseBody()
            writeAnalysisFile(body)
            return sendJson({ success: true, id: 'analisis', filename: ANALYSIS_FILE })
          }

          // GET /api/check-analysis — checks if analisis.json has entries
          if (url === '/api/check-analysis' && req.method === 'GET') {
            const content = readAnalysisFile()
            if (content) {
              const normalized = normalizeToAnalyses(content)
              return sendJson({
                exists: normalized.analyses.length > 0,
                count: normalized.analyses.length,
              })
            }
            return sendJson({ exists: false, count: 0 })
          }

          // GET /api/load-analysis — reads analisis.json, returns { analyses: [...] }
          if (url === '/api/load-analysis' && req.method === 'GET') {
            const content = readAnalysisFile()
            if (!content) {
              return sendJson({ analyses: [] })
            }
            return sendJson(normalizeToAnalyses(content))
          }

          // PUT /api/update-analysis — overwrites analisis.json
          if (url === '/api/update-analysis' && req.method === 'PUT') {
            const body = await parseBody()
            if (!fs.existsSync(getAnalysisPath())) {
              return sendJson({ error: 'Analysis not found' }, 404)
            }
            writeAnalysisFile(body)
            return sendJson({ success: true, id: 'analisis' })
          }

          // DELETE /api/delete-analysis — deletes analisis.json
          if (url === '/api/delete-analysis' && req.method === 'DELETE') {
            const fp = getAnalysisPath()
            if (!fs.existsSync(fp)) {
              return sendJson({ error: 'Analysis not found' }, 404)
            }
            fs.unlinkSync(fp)
            return sendJson({ success: true })
          }

          return next()
        } catch (err: any) {
          return sendJson({ error: err.message }, 500)
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [tailwindcss(), analysisStoragePlugin()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          pdf: ['jspdf'],
          excel: ['exceljs'],
          html2canvas: ['html2canvas'],
          purify: ['dompurify'],
        },
      },
    },
  },
})

