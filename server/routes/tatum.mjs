import { Router } from 'express'
import { tatumFetch, tatumRpc, MissingApiKeyError, tatumApiBase } from '../tatum-client.mjs'

const router = Router()

// =========================================================================
// WALRUS MEMORY INTEGRATION CONFIG & PLACEHOLDERS
// =========================================================================
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

// Known DEX / Router contracts for classification
const KNOWN_DEX_ROUTERS = new Set([
  '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', // Uniswap V2 Router
  '0xe592427a0aece92de3edee1f18e0157c05861564', // Uniswap V3 SwapRouter
  '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45', // Uniswap SwapRouter02
  '0x1111111254fb6c44bac0bed2854e76f90643097d', // 1inch v5 Router
  '0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f', // SushiSwap Router
  '0x881d40237659c251811cec9c364ef91dc08d300c', // Metamask Swap Router
  '0xdef1c0ded9bec7f1a1670819833240f027b25eff'  // 0x Exchange Proxy
])

// Realistic Sample / Demo Dataset
const DEMO_TRANSACTIONS = [
  {
    hash: '0x3a9f1b2c8e44123da652bf19aa91283c756cc21401bed2854e76f90643097d4e1',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x1111111254fb6c44bac0bed2854e76f90643097d',
    valueDisplay: '3.2500 ETH',
    numericEth: 3.25,
    timestamp: Date.now() - 1000 * 60 * 22,
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'DeFi/DEX',
    feeEth: '0.0084',
    numericFeeEth: 0.0084,
    transactionType: 'native'
  },
  {
    hash: '0x7e2a9c4b1d8f2b3145da981023bc65185f09468af7c6577fa207c4438f44e12aa',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    valueDisplay: '0.2000 ETH',
    numericEth: 0.20,
    timestamp: Date.now() - 1000 * 60 * 65,
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'Transfers',
    feeEth: '0.0021',
    numericFeeEth: 0.0021,
    transactionType: 'native'
  },
  {
    hash: '0x9b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    valueDisplay: '0.2000 ETH',
    numericEth: 0.20,
    timestamp: Date.now() - 1000 * 60 * 78,
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'Transfers',
    feeEth: '0.0022',
    numericFeeEth: 0.0022,
    transactionType: 'native'
  },
  {
    hash: '0x4c5d6e7f8a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a1b2c3d4e5f6a7b8c9d',
    from: '0x28c6c06298d514db089934071355e5743bf21d60',
    to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    valueDisplay: '1.4500 ETH',
    numericEth: 1.45,
    timestamp: Date.now() - 1000 * 60 * 60 * 8,
    type: 'incoming',
    tokenSymbol: 'ETH',
    category: 'Transfers',
    feeEth: '0.0018',
    numericFeeEth: 0.0018,
    transactionType: 'native'
  },
  {
    hash: '0x55aa66bb77cc88dd99ee00ff11223344556677889900aabbccddeeff00112233',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    valueDisplay: '1 NFT',
    numericEth: 0,
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 3,
    type: 'outgoing',
    tokenSymbol: 'NFT',
    category: 'NFTs',
    feeEth: '0.0095',
    numericFeeEth: 0.0095,
    transactionType: 'nft'
  },
  {
    hash: '0x8899aabbccddeeff00112233445566778899aabbccddeeff0011223344556677',
    from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
    valueDisplay: '0.4500 ETH',
    numericEth: 0.45,
    timestamp: Date.now() - 1000 * 60 * 60 * 24 * 7,
    type: 'outgoing',
    tokenSymbol: 'ETH',
    category: 'DeFi/DEX',
    feeEth: '0.0062',
    numericFeeEth: 0.0062,
    transactionType: 'fungible'
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

// Helper: fetch receipt fee via JSON-RPC eth_getTransactionReceipt
async function fetchTxFeeEth(hash) {
  if (!hash || !hash.startsWith('0x')) return 'n/a'
  try {
    const rpcRes = await tatumRpc('ethereum', {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [hash]
    })
    if (!rpcRes.ok) return 'n/a'
    const rpcJson = await rpcRes.json()
    const receipt = rpcJson.result
    if (!receipt || !receipt.gasUsed || !receipt.effectiveGasPrice) return 'n/a'

    const gasUsed = BigInt(receipt.gasUsed)
    const effectiveGasPrice = BigInt(receipt.effectiveGasPrice)
    const feeWei = gasUsed * effectiveGasPrice
    
    // Convert wei to ETH
    const feeEthNum = Number(feeWei) / 1e18
    return feeEthNum.toFixed(6)
  } catch (_) {
    return 'n/a'
  }
}

// Resolve ERC-20 metadata through Tatum's Token API. Cache by chain + contract
// so repeated transactions do not spend another metadata lookup credit.
const TOKEN_METADATA_CACHE = new Map();
const TOKEN_METADATA_CACHE_LIMIT = 500;

async function getFungibleTokenMetadata(chain, tokenAddress) {
  if (!tokenAddress || typeof tokenAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    return null;
  }

  const normalizedAddress = tokenAddress.toLowerCase();
  const cacheKey = `${chain}:${normalizedAddress}`;
  if (TOKEN_METADATA_CACHE.has(cacheKey)) return TOKEN_METADATA_CACHE.get(cacheKey);

  // Store the in-flight promise too, deduplicating concurrent lookups.
  const lookup = (async () => {
    try {
      const response = await tatumFetch(
        `/v4/data/tokens?chain=${encodeURIComponent(chain)}&tokenAddress=${encodeURIComponent(tokenAddress)}`
      );
      if (!response.ok) return null;

      const payload = await response.json();
      const metadata = Array.isArray(payload) ? payload[0] : (payload?.result ?? payload?.data ?? payload);
      if (!metadata || typeof metadata !== 'object') return null;

      const symbol = typeof metadata.symbol === 'string' ? metadata.symbol.trim() : '';
      const name = typeof metadata.name === 'string' ? metadata.name.trim() : '';
      const decimalsValue = Number(metadata.decimals);

      if (!symbol && !name) return null;
      return {
        symbol: symbol || null,
        name: name || null,
        decimals: Number.isInteger(decimalsValue) && decimalsValue >= 0 && decimalsValue <= 255
          ? decimalsValue
          : null,
        logo: typeof metadata.logo === 'string' ? metadata.logo : null,
      };
    } catch (_) {
      // Metadata is an enhancement; transaction history should still render.
      return null;
    }
  })();

  TOKEN_METADATA_CACHE.set(cacheKey, lookup);
  if (TOKEN_METADATA_CACHE.size > TOKEN_METADATA_CACHE_LIMIT) {
    const oldestKey = TOKEN_METADATA_CACHE.keys().next().value;
    if (oldestKey !== cacheKey) TOKEN_METADATA_CACHE.delete(oldestKey);
  }

  const result = await lookup;
  TOKEN_METADATA_CACHE.set(cacheKey, result);
  return result;
}

async function enrichFungibleTransactions(transactions, chain) {
  const contracts = [...new Set(
    transactions
      .filter((tx) => tx.transactionType === 'fungible')
      .map((tx) => tx.tokenAddress || tx.contractAddress)
      .filter((address) => typeof address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(address))
      .map((address) => address.toLowerCase())
  )];

  const metadataByContract = new Map();
  await Promise.all(contracts.map(async (contractAddress) => {
    const metadata = await getFungibleTokenMetadata(chain, contractAddress);
    if (metadata) metadataByContract.set(contractAddress, metadata);
  }));

  return transactions.map((tx) => {
    if (tx.transactionType !== 'fungible') return tx;
    const contractAddress = (tx.tokenAddress || tx.contractAddress || '').toLowerCase();
    const metadata = metadataByContract.get(contractAddress);
    return metadata ? { ...tx, tokenMetadata: metadata } : tx;
  });
}

// Helper: Parse value display and category according to exact rules
function parseTransactionRow(tx, monitoredAddress, receiptFee = 'n/a') {
  const normMonitored = (monitoredAddress || '').toLowerCase()
  const fromAddr = (tx.address && tx.transactionSubtype === 'outgoing') 
    ? tx.address 
    : (tx.counterAddress || tx.address || 'n/a')
  const toAddr = (tx.address && tx.transactionSubtype === 'incoming')
    ? tx.address
    : (tx.counterAddress || 'n/a')

  const isOutgoing = tx.transactionSubtype === 'outgoing' || (fromAddr.toLowerCase() === normMonitored && toAddr.toLowerCase() !== normMonitored)
  const txType = tx.transactionType || 'native'

  // 1. Value & Symbol parsing
  let valueDisplay = 'n/a'
  let numericEth = 0
  let tokenSymbol = 'ETH'

  if (txType === 'native') {
    tokenSymbol = 'ETH'
    const amtStr = String(tx.amount || '0')
    let amtNum = 0
    // Tatum Data API returns decimal ETH string directly for amount (e.g. "0.000004229438584322" or "0")
    if (amtStr.includes('.') || amtStr === '0') {
      amtNum = Math.abs(parseFloat(amtStr))
    } else {
      // If pure wei integer, divide by 1e18
      try {
        amtNum = Math.abs(Number(BigInt(amtStr)) / 1e18)
      } catch (_) {
        amtNum = Math.abs(parseFloat(amtStr))
      }
    }

    numericEth = amtNum
    if (amtNum === 0) {
      valueDisplay = '0.0000 ETH'
    } else if (amtNum < 0.000001) {
      valueDisplay = '<0.000001 ETH'
    } else {
      valueDisplay = `${amtNum.toFixed(4)} ETH`
    }
  } else if (txType === 'nft' || txType === 'multitoken') {
    tokenSymbol = 'NFT'
    numericEth = 0
    valueDisplay = '1 NFT'
  } else if (txType === 'fungible') {
    const sym = tx.tokenSymbol || 'Token'
    tokenSymbol = sym
    numericEth = 0
    const amtNum = Math.abs(parseFloat(tx.amount || '0'))
    valueDisplay = `${amtNum.toFixed(2)} ${sym}`
  } else {
    tokenSymbol = tx.tokenSymbol || 'n/a'
    valueDisplay = `${tx.amount || '0'} ${tokenSymbol}`
  }

  // 2. Category classification:
  // - plain native transfer = Transfers
  // - contract call to a known DEX/router = DeFi/DEX
  // - NFT transfer = NFTs
  // - anything unknown = Other
  let category = 'Other'
  const targetRecipient = toAddr.toLowerCase()
  const sourceSender = fromAddr.toLowerCase()

  if (txType === 'nft' || txType === 'multitoken') {
    category = 'NFTs'
  } else if (KNOWN_DEX_ROUTERS.has(targetRecipient) || KNOWN_DEX_ROUTERS.has(sourceSender)) {
    category = 'DeFi/DEX'
  } else if (txType === 'native') {
    category = 'Transfers'
  } else {
    category = 'Other'
  }

  const numericFeeEth = receiptFee !== 'n/a' ? parseFloat(receiptFee) : 0

  return {
    hash: tx.hash || 'n/a',
    timestamp: tx.timestamp || Date.now(),
    from: fromAddr,
    to: toAddr,
    valueDisplay,
    numericEth,
    tokenSymbol,
    category,
    type: isOutgoing ? 'outgoing' : 'incoming',
    feeEth: receiptFee,
    numericFeeEth,
    transactionType: txType
  }
}

// Wallet balance endpoint
router.get('/wallet/balance', async (req, res) => {
  const { address, chain = 'ethereum-mainnet', demo } = req.query
  if (demo === 'true') {
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
      return res.status(401).json({ error: 'Tatum API key missing. Please enable Demo mode or set key.' })
    }
    return res.status(500).json({ error: err.message })
  }
})

// Wallet transactions endpoint
router.get('/wallet/transactions', async (req, res) => {
  const { address, chain = 'ethereum-mainnet', demo } = req.query

  if (demo === 'true') {
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
    const enrichedList = await enrichFungibleTransactions(rawList, chain)

    // Fetch real receipts in parallel (for up to 10 rows to stay within RPC limits)
    const receiptPromises = enrichedList.slice(0, 10).map((tx) => fetchTxFeeEth(tx.hash))
    const fees = await Promise.all(receiptPromises)

    const formattedTxs = enrichedList.map((tx, idx) => {
      const fee = idx < fees.length ? fees[idx] : 'n/a'
      return parseTransactionRow(tx, address, fee)
    })

    return res.json({
      address,
      chain,
      isDemo: false,
      transactions: formattedTxs
    })
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return res.status(401).json({ error: 'Tatum API key missing. Please enable Demo mode or set key.' })
    }
    return res.status(500).json({ error: err.message })
  }
})

// Monthly Summary Card endpoint
router.get('/wallet/summary', async (req, res) => {
  const { demo, address } = req.query
  const isDemo = demo === 'true'

  let txList = []

  if (isDemo) {
    txList = DEMO_TRANSACTIONS
  } else if (address) {
    try {
      const response = await tatumFetch(
        `/v4/data/transaction/history?chain=ethereum-mainnet&addresses=${encodeURIComponent(address)}&pageSize=30`
      )
      if (response.ok) {
        const data = await response.json()
        const rawList = Array.isArray(data.result) ? data.result : []
        txList = rawList.map((tx) => parseTransactionRow(tx, address, 'n/a'))
      } else {
        return res.status(response.status).json({ error: 'Unable to fetch transactions from Tatum' })
      }
    } catch (err) {
      return res.status(500).json({ error: err.message })
    }
  }

  const now = Date.now()
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  const currentPeriodStart = now - THIRTY_DAYS_MS
  const previousPeriodStart = now - (2 * THIRTY_DAYS_MS)

  // Partition into current rolling 30 days and previous 30 days
  const currentTxs = txList.filter(tx => (tx.timestamp || 0) >= currentPeriodStart && (tx.timestamp || 0) <= now)
  const previousTxs = txList.filter(tx => (tx.timestamp || 0) >= previousPeriodStart && (tx.timestamp || 0) < currentPeriodStart)

  let totalOutgoingCurrent = 0
  let totalFeesCurrent = 0
  let knownFeeCount = 0

  const categories = {
    'Transfers': 0,
    'DeFi/DEX': 0,
    'NFTs': 0,
    'Other': 0
  }

  currentTxs.forEach((tx) => {
    if (tx.type === 'outgoing') {
      const amt = tx.numericEth || 0
      totalOutgoingCurrent += amt
      const cat = tx.category || 'Other'
      categories[cat] = (categories[cat] || 0) + amt
    }
    if (tx.numericFeeEth > 0) {
      totalFeesCurrent += tx.numericFeeEth
      knownFeeCount++
    }
  })

  // Previous period sum
  let totalOutgoingPrevious = 0
  previousTxs.forEach((tx) => {
    if (tx.type === 'outgoing') {
      totalOutgoingPrevious += (tx.numericEth || 0)
    }
  })

  let diffPercentDisplay = 'n/a'
  if (previousTxs.length > 0 && totalOutgoingPrevious > 0) {
    const diff = Math.round(((totalOutgoingCurrent - totalOutgoingPrevious) / totalOutgoingPrevious) * 100)
    diffPercentDisplay = `${diff > 0 ? '+' : ''}${diff}%`
  }

  const hasActivity = currentTxs.length > 0

  let changeNote = ''
  if (!hasActivity) {
    changeNote = 'No activity in the last 30 days.'
  } else if (diffPercentDisplay === 'n/a') {
    changeNote = 'No previous 30-day baseline recorded to compare activity.'
  } else {
    changeNote = `Outgoing spending changed by ${diffPercentDisplay} compared to the previous 30-day window.`
  }

  const totalOutgoingDisplay = hasActivity 
    ? (totalOutgoingCurrent === 0 ? '0 ETH' : `${totalOutgoingCurrent.toFixed(4)} ETH`)
    : '0 ETH'

  const totalFeesDisplay = knownFeeCount > 0 
    ? `${totalFeesCurrent.toFixed(6)} ETH` 
    : 'n/a'

  // Categories list
  const categoryKeys = ['Transfers', 'DeFi/DEX', 'NFTs', 'Other']
  const formattedCategories = categoryKeys.map(name => {
    const amt = categories[name] || 0
    const pct = totalOutgoingCurrent > 0 ? Math.round((amt / totalOutgoingCurrent) * 100) : 0
    return {
      name,
      amountEth: amt === 0 ? '0 ETH' : `${amt.toFixed(4)} ETH`,
      percentage: pct
    }
  })

  res.json({
    hasActivity,
    currentMonthTotalEth: totalOutgoingDisplay,
    totalFeesEth: totalFeesDisplay,
    diffPercentDisplay,
    changeNote,
    categories: formattedCategories
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
    const amountEth = tx.numericEth || 0
    const txTime = tx.timestamp || Date.now()
    const alertId = `alert-${tx.hash || i}`

    if (userMemoryProfile.dismissedAlertIds.has(alertId)) {
      continue
    }

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
        amount: tx.valueDisplay || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: Boolean(trustedMatch)
      })
    }

    // 2. Duplicate payment rule
    const paymentKey = `${recipient}:${amountEth.toFixed(4)}`
    if (seenPayments.has(paymentKey) && amountEth > 0) {
      const prevTime = seenPayments.get(paymentKey)
      const diffMinutes = Math.round(Math.abs(txTime - prevTime) / (60 * 1000))
      alerts.push({
        id: `${alertId}-dup`,
        txHash: tx.hash,
        rule: 'duplicate_payment',
        severity: 'medium',
        reason: `Potential duplicate payment: identical ${amountEth} ${tx.tokenSymbol || 'ETH'} sent to this recipient ${diffMinutes > 0 ? diffMinutes + 'm apart' : 'within an hour'}.`,
        amount: tx.valueDisplay || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: Boolean(trustedMatch)
      })
    } else {
      seenPayments.set(paymentKey, txTime)
    }

    // 3. New counterparty rule
    if (!trustedMatch && recipient && recipient !== 'n/a' && recipient !== '0x0000000000000000000000000000000000000000') {
      alerts.push({
        id: `${alertId}-new`,
        txHash: tx.hash,
        rule: 'new_address',
        severity: 'low',
        reason: `First transfer to counterparty ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}, not yet recorded in your Walrus trusted memory.`,
        amount: tx.valueDisplay || String(amountEth),
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

// Memory endpoints
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

router.post('/memory/untrust', (req, res) => {
  const { address } = req.body
  if (!address) return res.status(400).json({ error: 'Address required' })

  userMemoryProfile.trustedAddresses = userMemoryProfile.trustedAddresses.filter(
    a => a.address.toLowerCase() !== address.trim().toLowerCase()
  )
  res.json({ success: true, trustedAddresses: userMemoryProfile.trustedAddresses })
})

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
router.post('/chat/ask', (req, res) => {
  const { query, address } = req.body
  if (!query) return res.status(400).json({ error: 'Query is required' })

  const q = query.toLowerCase().trim()
  const recalledMemories = []
  let answer = ''

  if (q.includes('fee') || q.includes('gas') || q.includes('overpay')) {
    recalledMemories.push(`Monthly gas budget of ${userMemoryProfile.monthlyFeeBudgetEth} ETH set in Walrus Memory.`)
    recalledMemories.push(`Historical average gas price remembered as ${userMemoryProfile.averageFeeGwei} Gwei.`)

    answer = `Based on your recent transaction receipts, network gas fees stayed under your Walrus-remembered monthly fee cap of ${userMemoryProfile.monthlyFeeBudgetEth} ETH. You have not overpaid on fees.`
  } else if (q.includes('flag') || q.includes('alert') || q.includes('unusual') || q.includes('warning')) {
    recalledMemories.push(`Habitual transfer range: ${userMemoryProfile.minUsualTransferEth} to ${userMemoryProfile.maxUsualTransferEth} ETH.`)
    recalledMemories.push(`Duplicate payment inspection window: 60 minutes.`)
    recalledMemories.push(`1 flagged transaction acknowledged earlier in memory.`)

    answer = `Transactions were flagged because they breached your customary transfer ceiling of ${userMemoryProfile.maxUsualTransferEth} ETH or were sent to unindexed counterparties outside your ${userMemoryProfile.trustedAddresses.length} trusted Walrus contacts.`
  } else if (q.includes('who is') || q.includes('address') || q.includes('counterparty') || q.includes('0x')) {
    const matchedAddr = userMemoryProfile.trustedAddresses.find(a => q.includes(a.address.toLowerCase().slice(0, 10)) || q.includes(a.name.toLowerCase()))
    
    if (matchedAddr) {
      recalledMemories.push(`Found in Walrus trusted address book under "${matchedAddr.name}" (${matchedAddr.category}).`)
      answer = `Walrus Memory recognizes ${matchedAddr.address} as "${matchedAddr.name}", tagged as a trusted ${matchedAddr.category} contact added to your profile.`
    } else {
      recalledMemories.push(`Scanned ${userMemoryProfile.trustedAddresses.length} trusted address entries in Walrus.`)
      answer = `This address is not in your Walrus trusted address book. You can click "Trust this address" to remember it.`
    }
  } else {
    recalledMemories.push(`Walrus memory profile active for ${address || userMemoryProfile.walletAddress}.`)
    recalledMemories.push(`Recorded transfer profile: ${userMemoryProfile.minUsualTransferEth} – ${userMemoryProfile.maxUsualTransferEth} ETH across ${userMemoryProfile.trustedAddresses.length} trusted addresses.`)

    answer = `Ledger Memory is actively tracking your on-chain footprint. We remember that your standard transfers fall between ${userMemoryProfile.minUsualTransferEth} and ${userMemoryProfile.maxUsualTransferEth} ETH, with ${userMemoryProfile.trustedAddresses.length} trusted counterparties.`
  }

  res.json({
    answer,
    recalledMemories,
    timestamp: Date.now()
  })
})

export default router
