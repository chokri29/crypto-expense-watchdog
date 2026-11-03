// Production entry for Vercel. Local preview still uses server/index.mjs, which
// wraps this app in a Vite dev middleware. Do not call listen() here.
import './proxy-bootstrap.mjs'
import './credentials-store.mjs'
import express from 'express'
import tatumRoutes from './routes/tatum.mjs'
import { credentialGuard } from './credential-guard.mjs'

const app = express()
app.use(express.json())
app.use(credentialGuard)
app.use('/api/tatum', tatumRoutes)

export default app
