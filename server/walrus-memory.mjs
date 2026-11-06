const DEFAULT_PUBLISHER_URL = 'https://publisher.walrus-testnet.walrus.space'
const DEFAULT_AGGREGATOR_URL = 'https://aggregator.walrus-testnet.walrus.space'
const REQUEST_TIMEOUT_MS = 20000
const MAX_BLOB_BYTES = 256 * 1024

function normalizeBaseUrl(value, fallback) {
  const url = String(value || fallback).trim().replace(/\/+$/, '')
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new Error('Walrus endpoints must use HTTPS')
  }
  return url
}

export function getWalrusConfig() {
  return {
    publisherUrl: normalizeBaseUrl(process.env.WALRUS_PUBLISHER_URL, DEFAULT_PUBLISHER_URL),
    aggregatorUrl: normalizeBaseUrl(process.env.WALRUS_AGGREGATOR_URL, DEFAULT_AGGREGATOR_URL),
    epochs: Math.max(1, Math.min(30, Number.parseInt(process.env.WALRUS_MEMORY_EPOCHS || '10', 10) || 10)),
    ownerAddress: process.env.WALRUS_SUI_OWNER_ADDRESS || process.env.SUI_WALLET_ADDRESS || '',
    network: 'testnet',
  }
}

export function isValidSuiAddress(address) {
  return typeof address === 'string' && /^0x[a-fA-F0-9]{64}$/.test(address.trim())
}

export async function publishWalrusJson(value) {
  const config = getWalrusConfig()
  const body = JSON.stringify(value)
  if (Buffer.byteLength(body, 'utf8') > MAX_BLOB_BYTES) {
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

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`Walrus publisher returned HTTP ${response.status}: ${detail}`)
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
  if (typeof blobId !== 'string' || blobId.length < 20 || blobId.length > 200) {
    throw new Error('Invalid Walrus blob ID')
  }

  const { aggregatorUrl } = getWalrusConfig()
  const url = `${aggregatorUrl}/v1/blobs/${encodeURIComponent(blobId)}`
  let lastError

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      if (response.ok) return Buffer.from(await response.arrayBuffer())
      const detail = (await response.text()).slice(0, 250)
      const retryable = response.status === 404 || response.status >= 500
      lastError = new Error(`Walrus aggregator returned HTTP ${response.status}: ${detail}`)
      if (!retryable) throw lastError
    } catch (error) {
      lastError = error
      if (attempt === 4) break
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
  return typeof blobId === 'string' && blobId.length >= 20 && blobId.length <= 200 && /^[A-Za-z0-9_=-]+$/.test(blobId)
}
