import app from '../../../server/app.mjs'

const ROUTE = '/api/tatum/watchdog/analyze'

export default function handler(req, res) {
  try {
    const raw = req.url || ''
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
    req.url = ROUTE + q
    return app(req, res)
  } catch (err) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: err && err.message ? err.message : String(err) }))
  }
}

export const config = {
  maxDuration: 60,
}
