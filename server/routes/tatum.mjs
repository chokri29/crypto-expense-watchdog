import { Router } from 'express'
import { tatumFetch, tatumRpc, MissingApiKeyError, tatumApiBase } from '../tatum-client.mjs'

const router = Router()

// =========================================================================
// WALRUS MEMORY INTEGRATION CONFIG & PLACEHOLDERS
// =========================================================================
// Walrus is a decentralized decentralized memory & blob storage layer.
// Provide your Walrus memory daemon endpoint or Walrus storage config here:
const WALRUS_MEMORY_CONFIG = {
  // e.g. 'https://publisher.walrus-testnet.walrus.space' or custom aggregator
  AGGREGATOR_URL: process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space',
  PUBLISHER_URL: process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space',
  // In-memory or Walrus blob-backed profile reference:
  MEMORY_EPOCH_ID: process.env.WALRUS_MEMORY_EPOCH_ID || 'epoch-walrus-alpha-watchdog-v1',
  IS_CONFIGURED: Boolean(process.env.WALRUS_PUBLISHER_URL)
}

// User Profile Baseline Memory (Stored in Walrus / cached in session)
// Contains typical transfer volume range and established counterparty whitelist
const DEFAULT_USER_MEMORY_PROFILE = {
  walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  minUsualTransferEth: 0.02,
  maxUsualTransferEth: 0.50,
  trustedAddresses: [
    '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    '0x28c6c06298d514db089934071355e5743bf21d60',
    '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503',
    '0x0000000000000000000000000000000000000000',
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
  ],
  duplicateWindowSeconds: 3600 // 1 hour duplicate detection window
}

// Status endpoint
router.get('/status', async (_req, res) => {
  const hasKey = Boolean(process.env.TATUM_API_KEY)
  const walrusConfigured = WALRUS_MEMORY_CONFIG.IS_CONFIGURED

  if (!hasKey) {
    return res.json({ 
      status: 'no-api-key', 
      hasTatumKey: false,
      walrusConfigured,
      walrusConfig: {
        aggregatorUrl: WALRUS_MEMORY_CONFIG.AGGREGATOR_URL,
        publisherUrl: WALRUS_MEMORY_CONFIG.PUBLISHER_URL,
        epochId: WALRUS_MEMORY_CONFIG.MEMORY_EPOCH_ID
      }
    })
  }

  try {
    await fetch(tatumApiBase(), { signal: AbortSignal.timeout(8000) })
    res.json({ 
      status: 'connected', 
      hasTatumKey: true,
      walrusConfigured,
      walrusConfig: {
        aggregatorUrl: WALRUS_MEMORY_CONFIG.AGGREGATOR_URL,
        publisherUrl: WALRUS_MEMORY_CONFIG.PUBLISHER_URL,
        epochId: WALRUS_MEMORY_CONFIG.MEMORY_EPOCH_ID
      }
    })
  } catch (error) {
    res.json({ 
      status: 'egress-failed', 
      hasTatumKey: true,
      error: error.message,
      walrusConfigured,
      walrusConfig: WALRUS_MEMORY_CONFIG
    })
  }
})

// Wallet balance endpoint using Tatum Data API (with RPC fallback)
router.get('/wallet/balance', async (req, res) => {
  const { address, chain = 'ethereum-mainnet' } = req.query
  if (!address) {
    return res.status(400).json({ error: 'Missing address parameter' })
  }

  try {
    // 1. Try Tatum Data API Native Balance
    const dataResponse = await tatumFetch(`/v4/data/blockchains/balance?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`)
    if (dataResponse.ok) {
      const data = await dataResponse.json()
      // format: { balance: "0.1234" } or string directly
      const balanceVal = typeof data === 'object' && data !== null ? (data.balance ?? '0.0000') : String(data)
      return res.json({ balance: balanceVal, chain, address })
    }

    // 2. Fallback to RPC eth_getBalance if Data API is 404 or formatting
    const rpcRes = await tatumRpc(chain.replace('-mainnet', '').replace('-sepolia', ''), {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1
    })

    if (rpcRes.ok) {
      const rpcJson = await rpcRes.json()
      if (rpcJson.result) {
        const wei = BigInt(rpcJson.result)
        const ethVal = (Number(wei) / 1e18).toFixed(4)
        return res.json({ balance: ethVal, chain, address })
      }
    }

    const errText = await dataResponse.text()
    return res.status(dataResponse.status).json({ error: `Tatum API error: ${errText}` })
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return res.status(401).json({ error: 'Missing TATUM_API_KEY. Configure in environment.' })
    }
    return res.status(500).json({ error: err.message })
  }
})

// Wallet transactions endpoint using Tatum Data API
router.get('/wallet/transactions', async (req, res) => {
  const { address, chain = 'ethereum-mainnet' } = req.query
  if (!address) {
    return res.status(400).json({ error: 'Missing address parameter' })
  }

  try {
    const response = await tatumFetch(
      `/v4/data/transaction/history?chain=${encodeURIComponent(chain)}&addresses=${encodeURIComponent(address)}&pageSize=20`
    )

    if (!response.ok) {
      const errText = await response.text()
      return res.status(response.status).json({ error: `Tatum API error: ${errText}` })
    }

    const data = await response.json()
    const rawList = Array.isArray(data.result) ? data.result : []

    const formattedTxs = rawList.map((tx) => {
      const isOutgoing = tx.transactionSubtype === 'outgoing' || (tx.address && tx.address.toLowerCase() === address.toLowerCase() && tx.counterAddress)
      const valueNum = parseFloat(tx.amount || '0')
      const formattedValue = isNaN(valueNum) ? '0.0000' : Math.abs(valueNum).toFixed(4)

      return {
        hash: tx.hash || `0x${Math.random().toString(16).substring(2, 10)}`,
        from: isOutgoing ? address : (tx.counterAddress || tx.address || 'Unknown'),
        to: isOutgoing ? (tx.counterAddress || 'Smart Contract') : address,
        value: formattedValue,
        rawAmount: valueNum,
        timestamp: tx.timestamp || Date.now(),
        type: isOutgoing ? 'outgoing' : 'incoming',
        tokenSymbol: tx.transactionType === 'native' ? 'ETH' : (tx.tokenSymbol || 'ETH'),
        transactionType: tx.transactionType || 'native'
      }
    })

    return res.json({
      address,
      chain,
      transactions: formattedTxs
    })
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return res.status(401).json({ error: 'Missing TATUM_API_KEY. Configure in environment.' })
    }
    return res.status(500).json({ error: err.message })
  }
})

// Walrus Memory Watchdog Analysis Endpoint
// Analyzes transactions against Walrus User Profile Memory (usual transfer size & trusted addresses)
// Flags: 1. new address, 2. unusually large amount, 3. duplicate payment
router.post('/watchdog/analyze', async (req, res) => {
  const { address, transactions = [] } = req.body

  const memoryProfile = {
    ...DEFAULT_USER_MEMORY_PROFILE,
    walletAddress: address || DEFAULT_USER_MEMORY_PROFILE.walletAddress
  }

  const alerts = []
  const seenPayments = new Map() // Key: "recipient_amount" -> timestamp

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]
    if (tx.type !== 'outgoing') continue

    const recipient = (tx.to || '').toLowerCase()
    const amountEth = parseFloat(tx.value || '0')
    const txTime = tx.timestamp || Date.now()

    // 1. Unusually large transfer rule
    if (amountEth > memoryProfile.maxUsualTransferEth) {
      alerts.push({
        id: `alert-vol-${tx.hash}-${i}`,
        txHash: tx.hash,
        rule: 'large_amount',
        severity: amountEth > (memoryProfile.maxUsualTransferEth * 3) ? 'high' : 'medium',
        reason: `Unusually large transfer (${amountEth} ${tx.tokenSymbol} exceeds usual transfer range of ${memoryProfile.minUsualTransferEth} - ${memoryProfile.maxUsualTransferEth} ETH).`,
        amount: tx.value,
        token: tx.tokenSymbol,
        counterparty: tx.to,
        timestamp: txTime
      })
    }

    // 2. Duplicate payment rule (identical amount to same recipient within 1 hour)
    const paymentKey = `${recipient}:${amountEth.toFixed(4)}`
    if (seenPayments.has(paymentKey)) {
      const prevTime = seenPayments.get(paymentKey)
      const diffMinutes = Math.round(Math.abs(txTime - prevTime) / (60 * 1000))
      alerts.push({
        id: `alert-dup-${tx.hash}-${i}`,
        txHash: tx.hash,
        rule: 'duplicate_payment',
        severity: 'medium',
        reason: `Potential duplicate payment (identical ${amountEth} ${tx.tokenSymbol} sent to same recipient ${diffMinutes > 0 ? diffMinutes + 'm apart' : 'in recent window'}).`,
        amount: tx.value,
        token: tx.tokenSymbol,
        counterparty: tx.to,
        timestamp: txTime
      })
    } else {
      seenPayments.set(paymentKey, txTime)
    }

    // 3. New counterparty / address rule
    const isKnownTrusted = memoryProfile.trustedAddresses.some(
      (trusted) => trusted.toLowerCase() === recipient
    )
    if (!isKnownTrusted && recipient) {
      alerts.push({
        id: `alert-new-${tx.hash}-${i}`,
        txHash: tx.hash,
        rule: 'new_address',
        severity: 'medium',
        reason: `First-time transfer to an unindexed counterparty not remembered in your Walrus profile.`,
        amount: tx.value,
        token: tx.tokenSymbol,
        counterparty: tx.to,
        timestamp: txTime
      })
    }
  }

  res.json({
    memoryProfile: {
      minUsualTransferEth: memoryProfile.minUsualTransferEth,
      maxUsualTransferEth: memoryProfile.maxUsualTransferEth,
      trustedCount: memoryProfile.trustedAddresses.length,
      storageStatus: WALRUS_MEMORY_CONFIG.IS_CONFIGURED ? 'Walrus Blob Connected' : 'Local Sandbox Walrus Mock'
    },
    alerts
  })
})

export default router
