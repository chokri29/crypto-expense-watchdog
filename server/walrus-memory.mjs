import { createHmac, randomUUID } from 'node:crypto'

const DEFAULT_TESTNET_PUBLISHER_URL = 'https://publisher.walrus-testnet.walrus.space'
const DEFAULT_TESTNET_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space'
const DEFAULT_MAINNET_AGGREGATOR_URL = 'https://aggregator.walrus-mainnet.walrus.space'
const REQUEST_TIMEOUT_MS = 20000
const MAX_BLOB_BYTES = 256 * 1024
const JWT_TTL_SECONDS = 90

function normalizeBaseUrl(value, fallback) {
  const raw = String(value || fallback || '').trim().replace(/\/+$/, '')
  if (!raw) return ''
  const url = raw
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('Walrus endpoints must use HTTPS')
  return url
}

function getJwtSigningKey(secret) {
  const value = String(secret || '').trim()
  if (!value) throw new Error('WALRUS_JWT_SECRET is required for authenticated Mainnet publishing')
  // Walrus accepts a hex-encoded secret (0x...) or a plain UTF-8 secret.
  if (/^0x(?:[a-fA-F0-9]{2})+$/.test(value)) {
    const key = Buffer.from(value.slice(2), 'hex')
    if (key.length < 32) throw new Error('WALRUS_JWT_SECRET must contain at least 32 bytes')
    return key
  }
  const key = Buffer.from(value, 'utf8')
  if (key.length < 32) throw new Error('WALRUS_JWT_SECRET must contain at least 32 bytes')
  return key
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function createPublisherJwt(config, blobSize) {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const claims = {
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    jti: randomUUID(),
    epochs: config.epochs,
    max_size: blobSize,
    ...(config.ownerAddress ? { send_object_to: config.ownerAddress } : {}),
  }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signature = createHmac('sha256', getJwtSigningKey(process.env.WALRUS_JWT_SECRET))
    .update(signingInput)
    .digest('base64url')
  return `${signingInput}.${signature}`
}

export function getWalrusConfig() {
  const network = String(process.env.WALRUS_NETWORK || 'testnet').trim().toLowerCase()
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error('WALRUS_NETWORK must be either testnet or mainnet')
  }

  const publisherFallback = network === 'testnet' ? DEFAULT_TESTNET_PUBLISHER_URL : ''
  const aggregatorFallback = network === 'testnet' ? DEFAULT_TESTNET_AGGREGATOR_URL : DEFAULT_MAINNET_AGGREGATOR_URL
  const publisherUrl = normalizeBaseUrl(process.env.WALRUS_PUBLISHER_URL, publisherFallback)
  const aggregatorUrl = normalizeBaseUrl(process.env.WALRUS_AGGREGATOR_URL, aggregatorFallback)

  const publisherHost = publisherUrl ? new URL(publisherUrl).hostname.toLowerCase() : ''
  const aggregatorHost = new URL(aggregatorUrl).hostname.toLowerCase()
  if (network === 'testnet' && (!publisherHost.includes('testnet') || !aggregatorHost.includes('testnet'))) {
    throw new Error('Walrus Testnet mode only accepts Testnet publisher and aggregator endpoints')
  }
  if (network === 'mainnet' && (publisherHost.includes('testnet') || aggregatorHost.includes('testnet'))) {
    throw new Error('Walrus Mainnet mode cannot use Testnet endpoints')
  }
  return {
    network,
    publisherUrl,
    aggregatorUrl,
    epochs: Math.max(1, Math.min(30, Number.parseInt(process.env.WALRUS_MEMORY_EPOCHS || '10', 10) || 10)),
    ownerAddress: (process.env.WALRUS_SUI_OWNER_ADDRESS || process.env.SUI_WALLET_ADDRESS || '').trim(),
    authenticated: network === 'mainnet',
    jwtConfigured: network !== 'mainnet' || Boolean(process.env.WALRUS_JWT_SECRET),
  }
}

export function isValidSuiAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{64}$/.test(address.trim())
}

export async function publishWalrusJson(value) {
  const config = getWalrusConfig()
  if (!config.publisherUrl) throw new Error('WALRUS_PUBLISHER_URL must point to your privately operated authenticated Mainnet publisher')
  const body = JSON.stringify(value)
  const bodySize = Buffer.byteLength(body, 'utf8')
  if (bodySize > MAX_BLOB_BYTES) {
    throw new Error('Walrus memory payload exceeds the 256 KiB application limit')
  }

  const url = new URL(`${config.publisherUrl}/v1/blobs`)
  url.searchParams.set('epochs', String(config.epochs))
  if (config.ownerAddress) {
    if (!isValidSuiAddress(config.ownerAddress)) {
      throw new Error('WALRUS_SUI_OWNER_ADDRESS must be a valid 32-byte Sui address')
    }
    url.searchParams.set('send_object_to', config.ownerAddress.trim())
  }

  const headers = { 'Content-Type': 'application/json' }
  if (config.authenticated) {
    headers.Authorization = `Bearer ${createPublisherJwt(config, bodySize)}`
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`Walrus ${config.network} publisher returned HTTP ${response.status}: ${detail}`)
  }

  const result = await response.json()
  const created = result?.newlyCreated
  const certified = result?.alreadyCertified
  const blobId = created?.blobObject?.blobId || certified?.blobId
  if (typeof blobId !== 'string' || !blobId.trim()) {
    throw new Error('Walrus publisher response did not contain a blob ID')
  }

  return {
    blobId,
    objectId: created?.blobObject?.id || certified?.event?.object?.id || null,
    newlyCreated: Boolean(created),
    network: config.network,
    epochs: config.epochs,
    ownerAddress: config.ownerAddress || null,
  }
}

export async function readWalrusBytes(blobId) {
  if (!isValidWalrusBlobId(blobId)) {
    throw new Error('Invalid Walrus blob ID; expected a 43-character URL-safe base64 identifier')
  }

  const { aggregatorUrl, network } = getWalrusConfig()
  const url = `${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`
  let lastError

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      const detail = (await response.text()).slice(0, 250)
      const retryable = response.status === 404 || response.status >= 500
      lastError = new Error(`Walrus ${network} aggregator returned HTTP ${response.status}: ${detail}`)
      if (!retryable) {
        lastError.retryable = false
        throw lastError
      }
    } catch (error) {
      lastError = error
      if (error?.retryable === false || attempt === 4) break
    }
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)))
  }

  throw lastError || new Error('Unable to read Walrus blob')
}

export async function readWalrusJson(blobId) {
  const bytes = await readWalrusBytes(blobId)
  if (bytes.byteLength > MAX_BLOB_BYTES) {
    throw new Error('Walrus memory blob exceeds the 256 KiB application limit')
  }
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new Error('Walrus memory blob is not valid JSON')
  }
}

export function isValidWalrusBlobId(blobId) {
  return typeof blobId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(blobId)
}
