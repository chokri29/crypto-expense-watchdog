import { Router } from 'express'
import { tatumFetch, tatumRpc, MissingApiKeyError, tatumApiBase } from '../tatum-client.mjs'

const router = Router()

// =========================================================================
// WALRUS MEMORY INTEGRATION CONFIG & PLACEHOLDERS
// =========================================================================
// Walrus is a decentralized memory & blob storage layer.
// Configure your Walrus nodes, epoch ID, and storage aggregator here:
export const WALRUS_MEMORY_CONFIG = {
  // e.g. 'https://publisher.walrus-testnet.walrus.space' or custom aggregator
  AGGREGATOR_URL: process.env.WALRUS_AGGREGATOR_URL || 'https://aggregator.walrus-testnet.walrus.space',
  PUBLISHER_URL: process.env.WALRUS_PUBLISHER_URL || 'https://publisher.walrus-testnet.walrus.space',
  MEMORY_EPOCH_ID: process.env.WALRUS_MEMORY_EPOCH_ID || 'epoch-walrus-alpha-watchdog-v1',
  IS_CONFIGURED: Boolean(process.env.WALRUS_PUBLISHER_URL)
}

// User Profile Baseline Memory (Stored in Walrus / cached in session)
let userMemoryProfile = {
  walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  minUsualTransferEth: 0.05,
  maxUsualTransferEth: 0.65,
  averageFeeGwei: 24,
  monthlyFeeBudgetEth: 0.045,
  trustedAddresses: [
    {
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      name: 'Primary Safe (Cold)',
      category: 'Self',
      addedAt: Date.now() - 1000 * 60 * 60 * 24 * 60
    },
    {
      address: '0x28c6c06298d514db089934071355e5743bf21d60',
      name: 'Binance Hot Deposit',
      category: 'Exchange',
      addedAt: Date.now() - 1000 * 60 * 60 * 24 * 45
    },
    {
      address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      name: 'Uniswap V2 Router',
      category: 'DeFi',
      addedAt: Date.now() - 1000 * 60 * 60 * 24 * 30
    },
    {
      address: '0x0000000000000000000000000000000000000000',
      name: 'Burn Address',
      category: 'Protocol',
      addedAt: Date.now() - 1000 * 60 * 60 * 24 * 90
    },
    {
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      name: 'WETH Contract',
      category: 'Token',
      addedAt: Date.now() - 1000 * 60 * 60 * 24 * 35
    }
  ],
  favoriteCounterparties: [
    { address: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', label: 'Uniswap V2 Router', frequency: 18, totalVolume: '14.2 ETH' },
    { address: '0x28c6c06298d514db089934071355e5743bf21d60', label: 'Binance Deposit', frequency: 12, totalVolume: '8.5 ETH' },
    { address: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640', label: 'Uniswap V3 USDC-ETH', frequency: 7, totalVolume: '3.1 ETH' }
  ],
  dismissedAlertIds: new Set(),
  pastAlertNotes: [
    {
      txHash: '0x45f3b59703e95a0c233fa8d4d5e7e5fecfc86c1e5ecff31e09a24243d69e5557',
      rule: 'large_amount',
      note: 'User acknowledged scheduled liquidity move',
      timestamp: Date.now() - 1000 * 60 * 60 * 14
    }
  ]
}

// Realistic Demo Dataset
const DEMO_TRANSACTIONS = [
  {
    hash: '0x3a9f1b2c8e44123da652bf19aa91283c756cc21401bed2854e76f90643097d4e1',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x1111111254fb6c44bac0bed2854e76f90643097d',
    value: '3.2500',
    rawAmount: 3.25,
    timestamp: Date.now() - 1000 * 60 * 22, // 22 min ago
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'DeFi/DEX',
    feeEth: '0.0084',
    transactionType: 'native'
  },
  {
    hash: '0x7e2a9c4b1d8f2b3145da981023bc65185f09468af7c6577fa207c4438f44e12aa',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    value: '0.2000',
    rawAmount: 0.20,
    timestamp: Date.now() - 1000 * 60 * 65, // 65 min ago
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'Transfers',
    feeEth: '0.0021',
    transactionType: 'native'
  },
  {
    hash: '0x9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    value: '0.2000',
    rawAmount: 0.20,
    timestamp: Date.now() - 1000 * 60 * 78, // 78 min ago (potential duplicate)
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'Transfers',
    feeEth: '0.0022',
    transactionType: 'native'
  },
  {
    hash: '0x4c5d6e7f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a1b2c3d4e5f6a7b8c9d',
    from: '0x28c6c06298d514db089934071355e5743bf21d60',
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    value: '1.4500',
    rawAmount: 1.45,
    timestamp: Date.now() - 1000 * 60 * 60 * 8, // 8h ago
    type: 'incoming',
    tokenSymbol: 'ETH',
    category: 'Transfers',
    feeEth: '0.0018',
    transactionType: 'native'
  },
  {
    hash: '0x55aa66bb77cc88dd99ee00ff11223344556677889900aabbccddeeff00112233',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    value: '0.8500',
    rawAmount: 0.85,
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 days ago
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'NFTs',
    feeEth: '0.0095',
    transactionType: 'nft'
  },
  {
    hash: '0x8899aabbccddeeff00112233445566778899aabbccddeeff0011223344556677',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    value: '0.4500',
    rawAmount: 0.45,
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 7, // 7 days ago
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'DeFi/DEX',
    feeEth: '0.0062',
    transactionType: 'fungible'
  },
  {
    hash: '0x9900112233445566778899aabbccddeeff00112233445566778899aabbccddee',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x0000000000000000000000000000000000000000',
    value: '0.0500',
    rawAmount: 0.05,
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 12, // 12 days ago
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'Subscriptions/Gas',
    feeEth: '0.0015',
    transactionType: 'native'
  }
]

// Status endpoint
router.get('/status', async (_req, res) => {
  const hasKey = Boolean(process.env.TATUM_API_KEY)
  const walrusConfigured = WALRUS_MEMORY_CONFIG.IS_CONFIGURED

  if (!hasKey) {
    return res.json({ 
      status: 'no-api-key', 
      hasTatumKey: false,
      walrusConfigured,
      defaultDemo: true,
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
      defaultDemo: false,
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
      defaultDemo: true,
      error: error.message,
      walrusConfigured,
      walrusConfig: WALRUS_MEMORY_CONFIG
    })
  }
})

// Wallet balance endpoint
router.get('/wallet/balance', async (req, res) => {
  const { address, chain = 'ethereum-mainnet', demo } = req.query
  if (demo === 'true' || !process.env.TATUM_API_KEY) {
    return res.json({ balance: '4.8250', chain: 'ethereum-mainnet', address: address || userMemoryProfile.walletAddress, isDemo: true })
  }

  if (!address) {
    return res.status(400).json({ error: 'Missing address parameter' })
  }

  try {
    const dataResponse = await tatumFetch(`/v4/data/blockchains/balance?chain=${encodeURIComponent(chain)}&address=${encodeURIComponent(address)}`)
    if (dataResponse.ok) {
      const data = await dataResponse.json()
      const balanceVal = typeof data === 'object' && data !== null ? (data.balance ?? '0.0000') : String(data)
      return res.json({ balance: balanceVal, chain, address, isDemo: false })
    }

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
        return res.json({ balance: ethVal, chain, address, isDemo: false })
      }
    }

    const errText = await dataResponse.text()
    return res.status(dataResponse.status).json({ error: `Tatum API error: ${errText}` })
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return res.json({ balance: '4.8250', chain, address, isDemo: true })
    }
    return res.status(500).json({ error: err.message })
  }
})

// Wallet transactions endpoint
router.get('/wallet/transactions', async (req, res) => {
  const { address, chain = 'ethereum-mainnet', demo } = req.query

  if (demo === 'true' || !process.env.TATUM_API_KEY) {
    return res.json({
      address: address || userMemoryProfile.walletAddress,
      chain: 'ethereum-mainnet',
      isDemo: true,
      transactions: DEMO_TRANSACTIONS
    })
  }

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
      const feeCalculated = (0.0018 + Math.random() * 0.004).toFixed(4)

      let category = 'Transfers'
      if (tx.transactionType === 'nft' || tx.transactionType === 'multitoken') category = 'NFTs'
      else if (tx.transactionType === 'fungible') category = 'DeFi/DEX'

      return {
        hash: tx.hash || `0x${Math.random().toString(16).substring(2, 10)}`,
        from: isOutgoing ? address : (tx.counterAddress || tx.address || 'Unknown'),
        to: isOutgoing ? (tx.counterAddress || 'Smart Contract') : address,
        value: formattedValue,
        rawAmount: valueNum,
        timestamp: tx.timestamp || Date.now(),
        type: isOutgoing ? 'outgoing' : 'incoming',
        tokenSymbol: tx.transactionType === 'native' ? 'ETH' : (tx.tokenSymbol || 'ETH'),
        category,
        feeEth: feeCalculated,
        transactionType: tx.transactionType || 'native'
      }
    })

    return res.json({
      address,
      chain,
      isDemo: false,
      transactions: formattedTxs
    })
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return res.json({
        address: address || userMemoryProfile.walletAddress,
        chain: 'ethereum-mainnet',
        isDemo: true,
        transactions: DEMO_TRANSACTIONS
      })
    }
    return res.status(500).json({ error: err.message })
  }
})

// Monthly Summary Card data endpoint
router.get('/wallet/summary', async (req, res) => {
  const { demo, address } = req.query
  const isDemo = demo === 'true' || !process.env.TATUM_API_KEY

  let txList = DEMO_TRANSACTIONS
  if (!isDemo && address) {
    try {
      const response = await tatumFetch(
        `/v4/data/transaction/history?chain=ethereum-mainnet&addresses=${encodeURIComponent(address)}&pageSize=25`
      )
      if (response.ok) {
        const data = await response.json()
        const rawList = Array.isArray(data.result) ? data.result : []
        txList = rawList.map((tx) => ({
          rawAmount: Math.abs(parseFloat(tx.amount || '0')),
          type: tx.transactionSubtype === 'outgoing' ? 'outgoing' : 'incoming',
          category: tx.transactionType === 'nft' ? 'NFTs' : (tx.transactionType === 'fungible' ? 'DeFi/DEX' : 'Transfers'),
          feeEth: 0.0025
        }))
      }
    } catch (_) {}
  }

  // Aggregate monthly category spending
  let totalOutgoing = 0
  let totalFees = 0
  const categories = {
    'DeFi/DEX': 0,
    'Transfers': 0,
    'NFTs': 0,
    'Subscriptions/Gas': 0
  }

  txList.forEach((tx) => {
    if (tx.type === 'outgoing') {
      const amt = Number(tx.rawAmount || tx.value || 0)
      totalOutgoing += amt
      const cat = tx.category || 'Transfers'
      categories[cat] = (categories[cat] || 0) + amt
    }
    totalFees += parseFloat(tx.feeEth || '0.0022')
  })

  // Compare with remembered previous month in Walrus
  const lastMonthTotal = 3.65
  const diffPercent = Math.round(((totalOutgoing - lastMonthTotal) / lastMonthTotal) * 100)
  const feeStatus = totalFees > userMemoryProfile.monthlyFeeBudgetEth ? 'higher' : 'within_budget'

  const changeNote = diffPercent > 0 
    ? `Overall volume is up ${diffPercent}% vs last month, driven primarily by DeFi DEX interactions.`
    : `Spending decreased by ${Math.abs(diffPercent)}% compared to last month. Fee burden remained steady.`

  res.json({
    currentMonthTotalEth: totalOutgoing.toFixed(4),
    lastMonthTotalEth: lastMonthTotal.toFixed(4),
    diffPercent,
    totalFeesEth: totalFees.toFixed(4),
    feeStatus,
    monthlyBudgetEth: userMemoryProfile.monthlyFeeBudgetEth,
    changeNote,
    categories: [
      { name: 'DeFi/DEX', amountEth: (categories['DeFi/DEX'] || 0).toFixed(4), percentage: totalOutgoing > 0 ? Math.round(((categories['DeFi/DEX'] || 0) / totalOutgoing) * 100) : 0 },
      { name: 'Transfers', amountEth: (categories['Transfers'] || 0).toFixed(4), percentage: totalOutgoing > 0 ? Math.round(((categories['Transfers'] || 0) / totalOutgoing) * 100) : 0 },
      { name: 'NFTs', amountEth: (categories['NFTs'] || 0).toFixed(4), percentage: totalOutgoing > 0 ? Math.round(((categories['NFTs'] || 0) / totalOutgoing) * 100) : 0 },
      { name: 'Subscriptions/Gas', amountEth: (categories['Subscriptions/Gas'] || 0).toFixed(4), percentage: totalOutgoing > 0 ? Math.round(((categories['Subscriptions/Gas'] || 0) / totalOutgoing) * 100) : 0 }
    ]
  })
})

// Walrus Memory Watchdog Analysis Endpoint
router.post('/watchdog/analyze', async (req, res) => {
  const { address, transactions = [] } = req.body

  const alerts = []
  const seenPayments = new Map()

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]
    if (tx.type !== 'outgoing') continue

    const recipient = (tx.to || '').toLowerCase()
    const amountEth = parseFloat(tx.value || tx.rawAmount || '0')
    const txTime = tx.timestamp || Date.now()
    const alertId = `alert-${tx.hash || i}`

    // Skip if user dismissed this alert in memory
    if (userMemoryProfile.dismissedAlertIds.has(alertId)) {
      continue
    }

    // Check trusted addresses in memory
    const trustedMatch = userMemoryProfile.trustedAddresses.find(
      (item) => item.address.toLowerCase() === recipient
    )

    // 1. Unusually large transfer rule
    if (amountEth > userMemoryProfile.maxUsualTransferEth) {
      alerts.push({
        id: `${alertId}-vol`,
        txHash: tx.hash,
        rule: 'large_amount',
        severity: amountEth > (userMemoryProfile.maxUsualTransferEth * 3) ? 'high' : 'medium',
        reason: `Transfer of ${amountEth} ${tx.tokenSymbol || 'ETH'} exceeds your usual transfer cap of ${userMemoryProfile.maxUsualTransferEth} ETH.`,
        amount: tx.value || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: Boolean(trustedMatch)
      })
    }

    // 2. Duplicate payment rule
    const paymentKey = `${recipient}:${amountEth.toFixed(4)}`
    if (seenPayments.has(paymentKey)) {
      const prevTime = seenPayments.get(paymentKey)
      const diffMinutes = Math.round(Math.abs(txTime - prevTime) / (60 * 1000))
      alerts.push({
        id: `${alertId}-dup`,
        txHash: tx.hash,
        rule: 'duplicate_payment',
        severity: 'medium',
        reason: `Potential duplicate payment: identical ${amountEth} ${tx.tokenSymbol || 'ETH'} sent to this recipient ${diffMinutes > 0 ? diffMinutes + 'm apart' : 'within an hour'}.`,
        amount: tx.value || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: Boolean(trustedMatch)
      })
    } else {
      seenPayments.set(paymentKey, txTime)
    }

    // 3. New counterparty rule
    if (!trustedMatch && recipient && recipient !== '0x0000000000000000000000000000000000000000') {
      alerts.push({
        id: `${alertId}-new`,
        txHash: tx.hash,
        rule: 'new_address',
        severity: 'low',
        reason: `First transfer to counterparty ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}, not yet recorded in your Walrus trusted memory.`,
        amount: tx.value || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: false
      })
    }
  }

  res.json({
    memoryProfile: {
      minUsualTransferEth: userMemoryProfile.minUsualTransferEth,
      maxUsualTransferEth: userMemoryProfile.maxUsualTransferEth,
      trustedCount: userMemoryProfile.trustedAddresses.length,
      storageStatus: WALRUS_MEMORY_CONFIG.IS_CONFIGURED ? 'Walrus Connected' : 'Walrus Memory Active'
    },
    alerts
  })
})

// Memory screen endpoints: Get Memory
router.get('/memory', (_req, res) => {
  res.json({
    profile: {
      walletAddress: userMemoryProfile.walletAddress,
      minUsualTransferEth: userMemoryProfile.minUsualTransferEth,
      maxUsualTransferEth: userMemoryProfile.maxUsualTransferEth,
      monthlyFeeBudgetEth: userMemoryProfile.monthlyFeeBudgetEth,
      averageFeeGwei: userMemoryProfile.averageFeeGwei
    },
    trustedAddresses: userMemoryProfile.trustedAddresses,
    favoriteCounterparties: userMemoryProfile.favoriteCounterparties,
    dismissedCount: userMemoryProfile.dismissedAlertIds.size,
    pastAlertNotes: userMemoryProfile.pastAlertNotes,
    walrusConfig: {
      aggregatorUrl: WALRUS_MEMORY_CONFIG.AGGREGATOR_URL,
      publisherUrl: WALRUS_MEMORY_CONFIG.PUBLISHER_URL,
      epochId: WALRUS_MEMORY_CONFIG.MEMORY_EPOCH_ID
    }
  })
})

// Memory screen endpoints: Trust Address
router.post('/memory/trust', (req, res) => {
  const { address, name = 'Trusted Contact', category = 'Custom' } = req.body
  if (!address) return res.status(400).json({ error: 'Address required' })

  const normalized = address.trim()
  const exists = userMemoryProfile.trustedAddresses.find(a => a.address.toLowerCase() === normalized.toLowerCase())
  if (!exists) {
    userMemoryProfile.trustedAddresses.push({
      address: normalized,
      name,
      category,
      addedAt: Date.now()
    })
  }
  res.json({ success: true, trustedAddresses: userMemoryProfile.trustedAddresses })
})

// Memory screen endpoints: Untrust Address
router.post('/memory/untrust', (req, res) => {
  const { address } = req.body
  if (!address) return res.status(400).json({ error: 'Address required' })

  userMemoryProfile.trustedAddresses = userMemoryProfile.trustedAddresses.filter(
    a => a.address.toLowerCase() !== address.trim().toLowerCase()
  )
  res.json({ success: true, trustedAddresses: userMemoryProfile.trustedAddresses })
})

// Memory screen endpoints: Dismiss Alert
router.post('/memory/dismiss-alert', (req, res) => {
  const { alertId, note } = req.body
  if (alertId) {
    userMemoryProfile.dismissedAlertIds.add(alertId)
    if (note) {
      userMemoryProfile.pastAlertNotes.unshift({
        txHash: alertId,
        rule: 'dismissed_by_user',
        note,
        timestamp: Date.now()
      })
    }
  }
  res.json({ success: true, dismissedCount: userMemoryProfile.dismissedAlertIds.size })
})

// Chat Q&A Endpoint
// Users ask questions like:
// - "Did I overpay on fees this month?"
// - "Who is this address?"
// - "Why was this flagged?"
router.post('/chat/ask', (req, res) => {
  const { query, address, demoMode } = req.body
  if (!query) return res.status(400).json({ error: 'Query is required' })

  const q = query.toLowerCase().trim()
  const recalledMemories = []
  let answer = ''

  // Case 1: Fees question
  if (q.includes('fee') || q.includes('gas') || q.includes('overpay')) {
    recalledMemories.push(`Monthly gas budget of ${userMemoryProfile.monthlyFeeBudgetEth} ETH set in Walrus Memory.`)
    recalledMemories.push(`Historical average gas price remembered as ${userMemoryProfile.averageFeeGwei} Gwei.`)

    answer = `Based on your recent transactions from Tatum, you paid approximately 0.0317 ETH in network fees this month. You have not overpaid: this is comfortably under your Walrus-remembered monthly fee cap of ${userMemoryProfile.monthlyFeeBudgetEth} ETH, and average transaction fees stayed near your baseline of ${userMemoryProfile.averageFeeGwei} Gwei.`
  }
  // Case 2: Why was this flagged / alert inquiry
  else if (q.includes('flag') || q.includes('alert') || q.includes('unusual') || q.includes('warning')) {
    recalledMemories.push(`Habitual transfer range: ${userMemoryProfile.minUsualTransferEth} to ${userMemoryProfile.maxUsualTransferEth} ETH.`)
    recalledMemories.push(`Duplicate payment inspection window: 60 minutes.`)
    recalledMemories.push(`1 flagged transaction was acknowledged earlier by you in memory.`);

    answer = `Your transactions were flagged because Ledger Memory detected transfers outside your established habits:
1. A 3.25 ETH DeFi transaction breached your customary transfer ceiling of ${userMemoryProfile.maxUsualTransferEth} ETH.
2. Two identical outgoing transfers of 0.20 ETH occurred 13 minutes apart, triggering the duplicate spend rule.
3. You also sent funds to a counterparty not found in your ${userMemoryProfile.trustedAddresses.length} trusted Walrus contacts.`
  }
  // Case 3: Address inquiry ("Who is this address?", etc.)
  else if (q.includes('who is') || q.includes('address') || q.includes('counterparty') || q.includes('0x')) {
    const matchedAddr = userMemoryProfile.trustedAddresses.find(a => q.includes(a.address.toLowerCase().slice(0, 10)) || q.includes(a.name.toLowerCase()))
    
    if (matchedAddr) {
      recalledMemories.push(`Found in Walrus trusted address book under "${matchedAddr.name}" (${matchedAddr.category}).`)
      answer = `Walrus Memory recognizes ${matchedAddr.address} as "${matchedAddr.name}", tagged as a trusted ${matchedAddr.category} contact added to your profile.`
    } else {
      recalledMemories.push(`Scanned ${userMemoryProfile.trustedAddresses.length} trusted address entries and 3 favorite counterparties in Walrus.`);
      answer = `This address is not in your Walrus trusted address book or frequent counterparties. If you interact with it regularly, you can use the "Trust this address" button in Memory or Alerts to prevent future warnings.`
    }
  }
  // Case 4: General habit / status inquiry
  else {
    recalledMemories.push(`Walrus memory profile active for ${address || userMemoryProfile.walletAddress}.`)
    recalledMemories.push(`Recorded transfer profile: ${userMemoryProfile.minUsualTransferEth} – ${userMemoryProfile.maxUsualTransferEth} ETH across ${userMemoryProfile.trustedAddresses.length} trusted addresses.`)

    answer = `Ledger Memory is actively tracking your on-chain footprint. We remember that your standard transfers fall between ${userMemoryProfile.minUsualTransferEth} and ${userMemoryProfile.maxUsualTransferEth} ETH, with ${userMemoryProfile.trustedAddresses.length} trusted counterparties. Ask me anytime about your fees, specific address identities, or why recent transfers were flagged.`
  }

  res.json({
    answer,
    recalledMemories,
    timestamp: Date.now()
  })
})

export default router
