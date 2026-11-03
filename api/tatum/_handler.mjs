import app from '../../server/app.mjs'

// Vercel's /api router only forwards one extra segment to a catch-all file.
// Nested routes get their own file and pin the Express path explicitly.
export function handle(route) {
  return function handler(req, res) {
    const raw = req.url || ''
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
    req.url = `${route}${q}`
    return app(req, res)
  }
}

export const config = {
  maxDuration: 60,
}
