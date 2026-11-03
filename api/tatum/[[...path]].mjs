import app from '../../server/app.mjs'

// Vercel may pass the original URL (/api/tatum/...) or only the catch-all
// suffix (/status, /wallet/balance). Express routes are mounted at /api/tatum.
function withApiPrefix(req) {
  const raw = req.url || '/'
  const q = raw.indexOf('?')
  const pathname = q === -1 ? raw : raw.slice(0, q)
  const search = q === -1 ? '' : raw.slice(q)
  if (pathname === '/api/tatum' || pathname.startsWith('/api/tatum/')) return
  const suffix = pathname === '/' || pathname === ''
    ? ''
    : pathname.startsWith('/')
      ? pathname
      : `/${pathname}`
  req.url = `/api/tatum${suffix}${search}`
}

export default function handler(req, res) {
  withApiPrefix(req)
  return app(req, res)
}

export const config = {
  maxDuration: 60,
}
