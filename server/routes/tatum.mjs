import { Router } from 'express'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { tatumFetch, tatumRpc, MissingApiKeyError, tatumApiBase } from '../tatum-client.mjs'
import { getWalrusConfig, publishWalrusJson, readWalrusJson, isValidWalrusBlobId, isValidSuiAddress } from '../walrus-memory.mjs'

const router = Router()

function requireWalrusWriteAuthorization(req, res, next) {
  if (getWalrusConfig().network !== 'mainnet') return next()

  const expected = process.env.WALRUS_MAINNET_ADMIN_TOKEN || ''
  const supplied = req.get('x-walrus-admin-token') || ''
  if (!expected) {
    return res.status(503).json({ error: 'Mainnet writes are disabled: configure WALRUS_MAINNET_ADMIN_TOKEN on the backend first' })
  }

  const expectedBytes = Buffer.from(expected, 'utf8')
  const suppliedBytes = Buffer.from(supplied, 'utf8')
  const authorized = expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  if (!authorized) {
    return res.status(401).json({ error: 'Mainnet memory writes require the backend admin token; do not expose this token in the browser' })
  }
  return next()
}

// Walrus defaults to Testnet for backward compatibility. Mainnet is opt-in via
// WALRUS_NETWORK=mainnet and requires a private authenticated publisher endpoint.
const WALRUS_MEMORY_CONFIG = {
  get AGGREGATOR_URL() { return getWalrusConfig().aggregatorUrl },
  get PUBLISHER_URL() { return getWalrusConfig().publisherUrl },
  get STORAGE_DURATION() { const config = getWalrusConfig(); return `${config.epochs} ${config.network} epochs` },
  get IS_CONFIGURED() { return Boolean(getWalrusConfig().publisherUrl) },
  get OWNER_CONFIGURED() { return isValidSuiAddress(getWalrusConfig().ownerAddress) },
}

function createDefaultMemoryState(walletAddress = userMemoryProfile.walletAddress) {
  return {
    profile: {
      walletAddress,
      minUsualTransferEth: userMemoryProfile.minUsualTransferEth,
      maxUsualTransferEth: userMemoryProfile.maxUsualTransferEth,
      monthlyFeeBudgetEth: userMemoryProfile.monthlyFeeBudgetEth,
      averageFeeGwei: userMemoryProfile.averageFeeGwei,
    },
    trustedAddresses: userMemoryProfile.trustedAddresses.map((item) => ({ ...item })),
    favoriteCounterparties: userMemoryProfile.favoriteCounterparties.map((item) => ({ ...item })),
    dismissedAlertIds: [],
    pastAlertNotes: userMemoryProfile.pastAlertNotes.map((item) => ({ ...item })),
  }
}

function createDemoSeedPlan() {
  const snapshot = createDefaultMemoryState(userMemoryProfile.walletAddress)
  const events = [
    { memoryType: 'demo_profile', label: 'Demo wallet profile initialized', value: snapshot.profile.walletAddress, source: 'demo_fixture' },
    { memoryType: 'demo_habits', label: 'Customary transfer range', value: { minEth: snapshot.profile.minUsualTransferEth, maxEth: snapshot.profile.maxUsualTransferEth }, source: 'demo_fixture' },
    { memoryType: 'demo_gas_baseline', label: 'Monthly gas budget and average gas price', value: { monthlyFeeBudgetEth: snapshot.profile.monthlyFeeBudgetEth, averageFeeGwei: snapshot.profile.averageFeeGwei }, source: 'demo_fixture' },
    ...snapshot.trustedAddresses.map((item) => ({ memoryType: 'demo_trusted_address', label: item.name, value: item, source: 'demo_fixture' })),
    ...snapshot.favoriteCounterparties.map((item) => ({ memoryType: 'demo_counterparty', label: item.label, value: item, source: 'demo_fixture' })),
    { memoryType: 'demo_alert_note', label: 'Previously acknowledged alert note', value: snapshot.pastAlertNotes[0], source: 'demo_fixture' },
  ]
  return { seedId: randomUUID(), createdAt: Date.now(), snapshot, events }
}

function isValidSeedIdentity(seedId, createdAt) {
  return typeof seedId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seedId) &&
    Number.isSafeInteger(createdAt) &&
    createdAt > 0 &&
    createdAt <= Date.now() + 60_000
}

function isValidDemoSeedEvent(event) {
  const allowedTypes = new Set([
    'demo_profile',
    'demo_habits',
    'demo_gas_baseline',
    'demo_trusted_address',
    'demo_counterparty',
    'demo_alert_note',
  ])
  return Boolean(
    event &&
    typeof event === 'object' &&
    !Array.isArray(event) &&
    allowedTypes.has(event.memoryType) &&
    typeof event.label === 'string' &&
    event.label.length > 0 &&
    event.label.length <= 120 &&
    event.source === 'demo_fixture' &&
    Object.prototype.hasOwnProperty.call(event, 'value') &&
    Buffer.byteLength(JSON.stringify(event), 'utf8') <= 16 * 1024
  )
}

async function loadWalrusMemory(rootBlobId, readOptions = {}) {
  if (!rootBlobId) return null
  if (!isValidWalrusBlobId(rootBlobId)) throw new Error('Invalid Walrus memory root blob ID')

  const manifest = await readWalrusJson(rootBlobId, readOptions)
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.kind !== 'ledger-memory-manifest' ||
    manifest?.network !== getWalrusConfig().network ||
    !isValidWalrusBlobId(manifest.snapshotBlobId) ||
    !Array.isArray(manifest.memoryBlobIds) ||
    manifest.memoryBlobIds.length > 500 ||
    manifest.memoryCount !== manifest.memoryBlobIds.length ||
    manifest.memoryBlobIds.some((blobId) => !isValidWalrusBlobId(blobId))
  ) {
    throw new Error('Walrus memory manifest is invalid or unsupported')
  }

  const snapshot = await readWalrusJson(manifest.snapshotBlobId, readOptions)
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot?.kind !== 'ledger-memory-snapshot' ||
    snapshot?.network !== getWalrusConfig().network ||
    !snapshot.profile ||
    !Array.isArray(snapshot.trustedAddresses) ||
    !Array.isArray(snapshot.favoriteCounterparties) ||
    !Array.isArray(snapshot.dismissedAlertIds) ||
    !Array.isArray(snapshot.pastAlertNotes)
  ) {
    throw new Error('Walrus memory snapshot is invalid or incomplete')
  }

  return { manifest, snapshot }
}

async function publishWalrusMemory(snapshot, previousManifest = null, events = []) {
  const memoryBlobIds = [...(previousManifest?.memoryBlobIds || [])]
  const newMemoryBlobIds = []
  const publishOptions = { timeoutMs: 8000 }
  const verificationOptions = { timeoutMs: 6000, retries: 1 }

  // Walrus uploads are independent. Publish in bounded batches to avoid
  // serial network latency without overwhelming the public publisher.
  const batchSize = 6
  for (let offset = 0; offset < events.length; offset += batchSize) {
    const batch = events.slice(offset, offset + batchSize)
    const batchResults = await Promise.allSettled(batch.map((event) => publishWalrusJson({
      schemaVersion: 1,
      kind: 'ledger-memory-record',
      network: getWalrusConfig().network,
      createdAt: Date.now(),
      ...event,
    }, publishOptions)))
    const failedUpload = batchResults.find((result) => result.status === 'rejected')
    if (failedUpload) {
      throw new Error(`Walrus record upload batch ${Math.floor(offset / batchSize) + 1} failed: ${failedUpload.reason?.message || 'publisher request failed'}`)
    }
    const batchBlobIds = batchResults.map((result) => result.value.blobId)
    memoryBlobIds.push(...batchBlobIds)
    newMemoryBlobIds.push(...batchBlobIds)
  }

  let snapshotResult
  try {
    snapshotResult = await publishWalrusJson({
      schemaVersion: 1,
      kind: 'ledger-memory-snapshot',
      network: getWalrusConfig().network,
      updatedAt: Date.now(),
      ...snapshot,
    }, publishOptions)
  } catch (error) {
    throw new Error(`Walrus snapshot upload failed: ${error.message}`)
  }

  let manifestResult
  try {
    manifestResult = await publishWalrusJson({
      schemaVersion: 1,
      kind: 'ledger-memory-manifest',
      network: getWalrusConfig().network,
      createdAt: previousManifest?.createdAt || Date.now(),
      updatedAt: Date.now(),
      memoryCount: memoryBlobIds.length,
      storageEpochs: getWalrusConfig().epochs,
      memoryBlobIds,
      snapshotBlobId: snapshotResult.blobId,
    }, publishOptions)
  } catch (error) {
    throw new Error(`Walrus manifest upload failed: ${error.message}`)
  }

  // Verify the root and snapshot with short, bounded reads. The records are
  // then checked in parallel; no individual read can consume the full
  // Vercel function duration through repeated 20-second retries.
  let verified
  try {
    verified = await loadWalrusMemory(manifestResult.blobId, verificationOptions)
  } catch (error) {
    throw new Error(`Walrus manifest/snapshot readback failed: ${error.message}`)
  }
  if (!verified || verified.manifest.memoryCount !== memoryBlobIds.length) {
    throw new Error('Walrus manifest readback did not match the published memory count')
  }

  let verifiedRecords
  try {
    verifiedRecords = await Promise.all(newMemoryBlobIds.map((blobId) => readWalrusJson(blobId, verificationOptions)))
  } catch (error) {
    throw new Error(`Walrus memory-record readback failed: ${error.message}`)
  }
  if (verifiedRecords.some((record) => record?.schemaVersion !== 1 || record?.kind !== 'ledger-memory-record')) {
    throw new Error('One or more Walrus memory records failed readback validation')
  }

  return {
    rootBlobId: manifestResult.blobId,
    snapshotBlobId: snapshotResult.blobId,
    memoryBlobIds,
    memoryCount: memoryBlobIds.length,
    network: getWalrusConfig().network,
    updatedAt: Date.now(),
  }
}

// Demo fixture defaults used only to initialize a first Walrus memory snapshot.
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
        storageDuration: WALRUS_MEMORY_CONFIG.STORAGE_DURATION,
        network: getWalrusConfig().network,
        epochs: getWalrusConfig().epochs,
        ownerAddressConfigured: WALRUS_MEMORY_CONFIG.OWNER_CONFIGURED,
        authenticatedPublisher: getWalrusConfig().authenticated,
        publisherJwtConfigured: getWalrusConfig().jwtConfigured
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
        epochId: WALRUS_MEMORY_CONFIG.MEMORY_EPOCH_ID,
        network: getWalrusConfig().network,
        epochs: getWalrusConfig().epochs,
        ownerAddressConfigured: WALRUS_MEMORY_CONFIG.OWNER_CONFIGURED,
        authenticatedPublisher: getWalrusConfig().authenticated,
        publisherJwtConfigured: getWalrusConfig().jwtConfigured
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
    const sym = tx.tokenSymbol || tx.tokenMetadata?.symbol || 'Unknown token'
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

// Walrus-backed Watchdog Analysis Endpoint
router.post('/watchdog/analyze', async (req, res) => {
  const { address, transactions = [], rootBlobId } = req.body
  let stored
  try {
    stored = await loadWalrusMemory(rootBlobId)
  } catch (error) {
    return res.status(502).json({ error: error.message, memoryInitialized: Boolean(rootBlobId) })
  }

  if (!stored) {
    return res.json({
      memoryInitialized: false,
      memoryProfile: { storageStatus: 'Not initialized', trustedCount: 0 },
      alerts: [],
    })
  }

  const profile = stored.snapshot.profile
  const trustedAddresses = stored.snapshot.trustedAddresses
  const dismissedAlertIds = new Set(stored.snapshot.dismissedAlertIds)
  const alerts = []
  const seenPayments = new Map()

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]
    if (tx.type !== 'outgoing') continue

    const recipient = (tx.to || '').toLowerCase()
    const amountEth = Number(tx.numericEth) || 0
    const txTime = tx.timestamp || Date.now()
    const alertId = `alert-${tx.hash || i}`

    const trustedMatch = trustedAddresses.find(
      (item) => item.address.toLowerCase() === recipient
    )

    if (amountEth > profile.maxUsualTransferEth && !dismissedAlertIds.has(`${alertId}-vol`)) {
      alerts.push({
        id: `${alertId}-vol`,
        txHash: tx.hash,
        rule: 'large_amount',
        severity: amountEth > (profile.maxUsualTransferEth * 3) ? 'high' : 'medium',
        reason: `Transfer of ${amountEth} ${tx.tokenSymbol || 'ETH'} exceeds your saved transfer cap of ${profile.maxUsualTransferEth} ETH.`,
        amount: tx.valueDisplay || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: Boolean(trustedMatch)
      })
    }

    const paymentKey = `${recipient}:${amountEth.toFixed(4)}`
    if (seenPayments.has(paymentKey) && amountEth > 0 && !dismissedAlertIds.has(`${alertId}-dup`)) {
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

    if (!dismissedAlertIds.has(`${alertId}-new`) && !trustedMatch && recipient && recipient !== 'n/a' && recipient !== '0x0000000000000000000000000000000000000000') {
      alerts.push({
        id: `${alertId}-new`,
        txHash: tx.hash,
        rule: 'new_address',
        severity: 'low',
        reason: `First transfer to counterparty ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}, not yet recorded in your saved trusted-address memory.`,
        amount: tx.valueDisplay || String(amountEth),
        token: tx.tokenSymbol || 'ETH',
        counterparty: tx.to,
        timestamp: txTime,
        isTrusted: false
      })
    }
  }

  res.json({
    memoryInitialized: true,
    memoryProfile: {
      minUsualTransferEth: profile.minUsualTransferEth,
      maxUsualTransferEth: profile.maxUsualTransferEth,
      trustedCount: trustedAddresses.length,
      storageStatus: `Walrus ${getWalrusConfig().network} verified by manifest read`,
      memoryCount: stored.manifest.memoryCount,
    },
    alerts
  })
})

// Read the root manifest and latest snapshot from Walrus. The browser stores
// the root blob ID so this works across serverless invocations and restarts.
router.get('/memory', async (req, res) => {
  const config = getWalrusConfig()
  const rootBlobId = typeof req.query.rootBlobId === 'string' ? req.query.rootBlobId : ''
  const walrusConfig = {
    aggregatorUrl: config.aggregatorUrl,
    publisherUrl: config.publisherUrl,
    network: getWalrusConfig().network,
    epochs: config.epochs,
    ownerAddressConfigured: WALRUS_MEMORY_CONFIG.OWNER_CONFIGURED,
  }

  if (!rootBlobId) {
    return res.json({
      initialized: false,
      profile: null,
      trustedAddresses: [],
      favoriteCounterparties: [],
      dismissedCount: 0,
      pastAlertNotes: [],
      memoryStore: { rootBlobId: null, memoryCount: 0, blobIds: [] },
      walrusConfig,
    })
  }

  try {
    const stored = await loadWalrusMemory(rootBlobId)
    if (!stored) return res.status(404).json({ error: 'Walrus memory root was not found' })
    return res.json({
      initialized: true,
      profile: stored.snapshot.profile,
      trustedAddresses: stored.snapshot.trustedAddresses,
      favoriteCounterparties: stored.snapshot.favoriteCounterparties,
      dismissedCount: stored.snapshot.dismissedAlertIds.length,
      pastAlertNotes: stored.snapshot.pastAlertNotes,
      memoryStore: {
        rootBlobId,
        snapshotBlobId: stored.manifest.snapshotBlobId,
        memoryCount: stored.manifest.memoryCount,
        blobIds: stored.manifest.memoryBlobIds,
        updatedAt: stored.manifest.updatedAt,
      },
      walrusConfig,
    })
  } catch (error) {
    return res.status(502).json({ error: `Unable to retrieve Walrus memory: ${error.message}` })
  }
})

// Resumable first-run seed. Each Walrus write has its own Vercel invocation,
// and the browser checkpoints every returned content-addressed blob ID.
router.post('/memory/seed/plan', requireWalrusWriteAuthorization, (req, res) => {
  if (typeof req.body?.rootBlobId === 'string' && req.body.rootBlobId) {
    return res.status(409).json({ error: 'Memory is already initialized for this browser' })
  }
  const plan = createDemoSeedPlan()
  return res.json({
    success: true,
    network: getWalrusConfig().network,
    epochs: getWalrusConfig().epochs,
    ownerAddressConfigured: WALRUS_MEMORY_CONFIG.OWNER_CONFIGURED,
    ...plan,
  })
})

router.post('/memory/seed/record', requireWalrusWriteAuthorization, async (req, res) => {
  const { seedId, createdAt, index, event } = req.body || {}
  if (!isValidSeedIdentity(seedId, createdAt) || !Number.isInteger(index) || index < 0 || index >= 12 || !isValidDemoSeedEvent(event)) {
    return res.status(400).json({ error: 'Invalid resumable seed record request' })
  }

  try {
    // All inputs are checkpointed by the browser. Repeating the exact request
    // produces identical bytes and therefore the same Walrus content-addressed blob ID.
    const payload = {
      ...event,
      schemaVersion: 1,
      kind: 'ledger-memory-record',
      network: getWalrusConfig().network,
      createdAt,
      seedId,
      index,
    }
    const published = await publishWalrusJson(payload, { timeoutMs: 30000 })
    const verified = await readWalrusJson(published.blobId, { timeoutMs: 6000, retries: 2 })
    if (verified?.kind !== 'ledger-memory-record' || verified?.seedId !== seedId || verified?.index !== index) {
      throw new Error('Published record did not pass readback validation')
    }
    return res.json({ success: true, index, blobId: published.blobId, network: published.network })
  } catch (error) {
    return res.status(502).json({ error: `Walrus seed record ${index + 1} failed: ${error.message}` })
  }
})

router.post('/memory/seed/snapshot', requireWalrusWriteAuthorization, async (req, res) => {
  const { seedId, createdAt, snapshot } = req.body || {}
  if (
    !isValidSeedIdentity(seedId, createdAt) ||
    !snapshot ||
    typeof snapshot !== 'object' ||
    !snapshot.profile ||
    !Array.isArray(snapshot.trustedAddresses) ||
    !Array.isArray(snapshot.favoriteCounterparties) ||
    !Array.isArray(snapshot.dismissedAlertIds) ||
    !Array.isArray(snapshot.pastAlertNotes) ||
    Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 64 * 1024
  ) {
    return res.status(400).json({ error: 'Invalid resumable seed snapshot request' })
  }

  try {
    const published = await publishWalrusJson({
      schemaVersion: 1,
      kind: 'ledger-memory-snapshot',
      network: getWalrusConfig().network,
      createdAt,
      seedId,
      ...snapshot,
    }, { timeoutMs: 30000 })
    const verified = await readWalrusJson(published.blobId, { timeoutMs: 6000, retries: 2 })
    if (verified?.kind !== 'ledger-memory-snapshot' || verified?.seedId !== seedId) {
      throw new Error('Published snapshot did not pass readback validation')
    }
    return res.json({ success: true, snapshotBlobId: published.blobId, network: published.network })
  } catch (error) {
    return res.status(502).json({ error: `Walrus seed snapshot failed: ${error.message}` })
  }
})

router.post('/memory/seed/finalize', requireWalrusWriteAuthorization, async (req, res) => {
  const { seedId, createdAt, snapshotBlobId, memoryBlobIds } = req.body || {}
  if (
    !isValidSeedIdentity(seedId, createdAt) ||
    !isValidWalrusBlobId(snapshotBlobId) ||
    !Array.isArray(memoryBlobIds) ||
    memoryBlobIds.length !== 12 ||
    memoryBlobIds.some((blobId) => !isValidWalrusBlobId(blobId))
  ) {
    return res.status(400).json({ error: 'Invalid resumable seed finalization request' })
  }

  try {
    const published = await publishWalrusJson({
      schemaVersion: 1,
      kind: 'ledger-memory-manifest',
      network: getWalrusConfig().network,
      createdAt,
      updatedAt: createdAt,
      seedId,
      memoryCount: memoryBlobIds.length,
      storageEpochs: getWalrusConfig().epochs,
      memoryBlobIds,
      snapshotBlobId,
    }, { timeoutMs: 30000 })

    const verified = await loadWalrusMemory(published.blobId, { timeoutMs: 6000, retries: 2 })
    if (
      !verified ||
      verified.manifest.seedId !== seedId ||
      verified.manifest.memoryCount !== 12 ||
      verified.manifest.snapshotBlobId !== snapshotBlobId ||
      verified.manifest.memoryBlobIds.some((blobId, index) => blobId !== memoryBlobIds[index]) ||
      verified.snapshot.seedId !== seedId
    ) {
      throw new Error('Published manifest failed readback validation')
    }

    return res.status(201).json({
      success: true,
      published: true,
      initialized: true,
      network: getWalrusConfig().network,
      rootBlobId: published.blobId,
      snapshotBlobId,
      memoryCount: memoryBlobIds.length,
      blobIds: memoryBlobIds,
      epochs: getWalrusConfig().epochs,
      ownerAddressConfigured: WALRUS_MEMORY_CONFIG.OWNER_CONFIGURED,
      note: 'These 12 records are labelled demo fixtures, not user-generated financial history.',
    })
  } catch (error) {
    return res.status(502).json({ error: `Walrus seed finalization failed: ${error.message}` })
  }
})

// Retire the old all-in-one endpoint so stale clients cannot trigger another
// non-resumable 12-record upload.
router.post('/memory/seed', requireWalrusWriteAuthorization, (_req, res) => {
  return res.status(410).json({ error: 'This seed endpoint was replaced by the resumable Walrus initialization flow. Refresh the app and try again.' })
})

router.post('/memory/trust', requireWalrusWriteAuthorization, async (req, res) => {
  const { address, name = 'Trusted Contact', category = 'Custom', rootBlobId } = req.body || {}
  if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    return res.status(400).json({ error: 'A valid 20-byte EVM address is required' })
  }

  try {
    const stored = await loadWalrusMemory(rootBlobId)
    if (!stored) return res.status(409).json({ error: 'Initialize Walrus memory before saving trusted addresses' })
    const snapshot = stored.snapshot
    const normalized = address.trim()
    const exists = snapshot.trustedAddresses.some((item) => item.address.toLowerCase() === normalized.toLowerCase())
    if (exists) return res.json({ success: true, published: false, trustedAddresses: snapshot.trustedAddresses, rootBlobId })
    snapshot.trustedAddresses.push({ address: normalized, name: String(name).slice(0, 80), category: String(category).slice(0, 40), addedAt: Date.now() })
    const published = await publishWalrusMemory(snapshot, stored.manifest, [
      { memoryType: 'trusted_address_added', label: String(name).slice(0, 80), value: { address: normalized, category }, source: 'user_action' },
    ])
    return res.json({ success: true, published: true, trustedAddresses: snapshot.trustedAddresses, ...published })
  } catch (error) {
    return res.status(502).json({ error: `Unable to save trusted address to Walrus: ${error.message}` })
  }
})

router.post('/memory/untrust', requireWalrusWriteAuthorization, async (req, res) => {
  const { address, rootBlobId } = req.body || {}
  if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address.trim())) {
    return res.status(400).json({ error: 'A valid 20-byte EVM address is required' })
  }

  try {
    const stored = await loadWalrusMemory(rootBlobId)
    if (!stored) return res.status(409).json({ error: 'Initialize Walrus memory before editing trusted addresses' })
    const snapshot = stored.snapshot
    const before = snapshot.trustedAddresses.length
    snapshot.trustedAddresses = snapshot.trustedAddresses.filter((item) => item.address.toLowerCase() !== address.trim().toLowerCase())
    if (snapshot.trustedAddresses.length === before) return res.json({ success: true, published: false, trustedAddresses: snapshot.trustedAddresses, rootBlobId })
    const published = await publishWalrusMemory(snapshot, stored.manifest, [
      { memoryType: 'trusted_address_removed', label: 'Trusted address removed', value: { address: address.trim() }, source: 'user_action' },
    ])
    return res.json({ success: true, published: true, trustedAddresses: snapshot.trustedAddresses, ...published })
  } catch (error) {
    return res.status(502).json({ error: `Unable to update Walrus memory: ${error.message}` })
  }
})

router.post('/memory/dismiss-alert', requireWalrusWriteAuthorization, async (req, res) => {
  const { alertId, note, rootBlobId } = req.body || {}
  if (typeof alertId !== 'string' || !alertId.trim()) return res.status(400).json({ error: 'Alert ID is required' })

  try {
    const stored = await loadWalrusMemory(rootBlobId)
    if (!stored) return res.status(409).json({ error: 'Initialize Walrus memory before recording alert decisions' })
    const snapshot = stored.snapshot
    if (!snapshot.dismissedAlertIds.includes(alertId)) snapshot.dismissedAlertIds.push(alertId)
    if (note) {
      snapshot.pastAlertNotes.unshift({ txHash: alertId, rule: 'dismissed_by_user', note: String(note).slice(0, 300), timestamp: Date.now() })
    }
    const published = await publishWalrusMemory(snapshot, stored.manifest, [
      { memoryType: 'alert_dismissed', label: 'User dismissed an alert', value: { alertId, note: String(note || '') }, source: 'user_action' },
    ])
    return res.json({ success: true, published: true, dismissedCount: snapshot.dismissedAlertIds.length, ...published })
  } catch (error) {
    return res.status(502).json({ error: `Unable to record alert decision in Walrus: ${error.message}` })
  }
})

// Chat answers are grounded in the retrieved Walrus snapshot, not process memory.
router.post('/chat/ask', async (req, res) => {
  const { query, address, rootBlobId } = req.body || {}
  if (typeof query !== 'string' || !query.trim()) return res.status(400).json({ error: 'Query is required' })

  try {
    const stored = await loadWalrusMemory(rootBlobId)
    if (!stored) return res.status(409).json({ error: 'Walrus memory is not initialized yet. Initialize it in the Memory tab first.' })

    const profile = stored.snapshot.profile
    const trustedAddresses = stored.snapshot.trustedAddresses
    const q = query.toLowerCase().trim()
    const recalledMemories = []
    let answer = ''

    if (q.includes('fee') || q.includes('gas') || q.includes('overpay')) {
      recalledMemories.push(`Monthly gas budget of ${profile.monthlyFeeBudgetEth} ETH, retrieved from Walrus ${getWalrusConfig().network}.`)
      recalledMemories.push(`Historical average gas price remembered as ${profile.averageFeeGwei} Gwei.`)
      answer = `Your saved monthly gas budget is ${profile.monthlyFeeBudgetEth} ETH and your stored average gas baseline is ${profile.averageFeeGwei} Gwei. Compare these limits with the latest Tatum receipts before deciding whether fees were unusually high.`
    } else if (q.includes('flag') || q.includes('alert') || q.includes('unusual') || q.includes('warning')) {
      recalledMemories.push(`Saved habitual transfer range: ${profile.minUsualTransferEth} to ${profile.maxUsualTransferEth} ETH.`)
      recalledMemories.push(`${trustedAddresses.length} trusted addresses retrieved from Walrus ${getWalrusConfig().network}.`)
      recalledMemories.push(`${stored.snapshot.pastAlertNotes.length} stored alert notes.`)
      answer = `The watchdog compares transfers with your saved ${profile.maxUsualTransferEth} ETH customary ceiling and checks counterparties against your ${trustedAddresses.length} stored trusted addresses.`
    } else if (q.includes('who is') || q.includes('address') || q.includes('counterparty') || q.includes('0x')) {
      const matchedAddr = trustedAddresses.find(item => q.includes(item.address.toLowerCase().slice(0, 10)) || q.includes(item.name.toLowerCase()))
      if (matchedAddr) {
        recalledMemories.push(`Found in the Walrus trusted-address book as "${matchedAddr.name}" (${matchedAddr.category}).`)
        answer = `Walrus Memory recognizes ${matchedAddr.address} as "${matchedAddr.name}", tagged as ${matchedAddr.category}.`
      } else {
        recalledMemories.push(`Searched ${trustedAddresses.length} trusted-address records retrieved from Walrus.`)
        answer = 'This address is not present in the retrieved trusted-address records.'
      }
    } else {
      recalledMemories.push(`Wallet profile retrieved from Walrus for ${address || profile.walletAddress}.`)
      recalledMemories.push(`Saved transfer range: ${profile.minUsualTransferEth} – ${profile.maxUsualTransferEth} ETH.`)
      answer = `Your retrieved memory profile contains ${trustedAddresses.length} trusted counterparties and a customary transfer range of ${profile.minUsualTransferEth} – ${profile.maxUsualTransferEth} ETH.`
    }

    return res.json({ answer, recalledMemories, timestamp: Date.now(), network: getWalrusConfig().network, memoryCount: stored.manifest.memoryCount })
  } catch (error) {
    return res.status(502).json({ error: `Unable to retrieve Walrus memory for chat: ${error.message}` })
  }
})

export default router
