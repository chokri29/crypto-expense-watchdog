import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Wallet as WalletIcon, 
  Bell, 
  Search, 
  ArrowUpRight, 
  ArrowDownLeft, 
  AlertTriangle, 
  CheckCircle2, 
  Cpu, 
  Database, 
  Sparkles, 
  RefreshCw,
  Sliders,
  History,
  Key,
  Info,
  Clock,
  ShieldCheck,
  Zap
} from 'lucide-react';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  value: string;
  rawAmount: number;
  timestamp: number;
  type: 'incoming' | 'outgoing';
  tokenSymbol: string;
  transactionType: string;
}

interface AlertItem {
  id: string;
  txHash: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
  rule: 'new_address' | 'large_amount' | 'duplicate_payment';
  amount: string;
  token: string;
  counterparty: string;
  timestamp: number;
}

interface MemoryProfile {
  minUsualTransferEth: number;
  maxUsualTransferEth: number;
  trustedCount: number;
  storageStatus: string;
}

export function App() {
  const [activeTab, setActiveTab] = useState<'wallet' | 'alerts'>('wallet');
  const [addressInput, setAddressInput] = useState('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  const [activeAddress, setActiveAddress] = useState('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  
  const [balance, setBalance] = useState<string>('0.0000');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [memoryProfile, setMemoryProfile] = useState<MemoryProfile>({
    minUsualTransferEth: 0.02,
    maxUsualTransferEth: 0.50,
    trustedCount: 5,
    storageStatus: 'Walrus Memory Active'
  });

  const [loading, setLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [hasTatumKey, setHasTatumKey] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);

  // Initial load
  useEffect(() => {
    fetchWalletData(activeAddress);
  }, []);

  const fetchWalletData = async (targetAddress: string) => {
    setLoading(true);
    setApiError(null);

    try {
      // 1. Fetch live balance from backend Tatum Data API
      const balanceRes = await fetch(`/api/tatum/wallet/balance?address=${encodeURIComponent(targetAddress)}&chain=ethereum-mainnet`);
      if (balanceRes.status === 401) {
        setHasTatumKey(false);
        setApiError('Tatum API key missing or invalid. Set TATUM_API_KEY on the server.');
        setLoading(false);
        return;
      }
      
      let balanceVal = '0.0000';
      if (balanceRes.ok) {
        const balanceData = await balanceRes.json();
        balanceVal = balanceData.balance ?? '0.0000';
        setBalance(balanceVal);
      }

      // 2. Fetch transaction history from backend Tatum Data API
      const txRes = await fetch(`/api/tatum/wallet/transactions?address=${encodeURIComponent(targetAddress)}&chain=ethereum-mainnet`);
      let fetchedTxs: Transaction[] = [];
      if (txRes.ok) {
        const txData = await txRes.json();
        fetchedTxs = txData.transactions || [];
        setTransactions(fetchedTxs);
      } else {
        const errJson = await txRes.json().catch(() => ({}));
        if (errJson.error) setApiError(errJson.error);
      }

      // 3. Run Walrus Memory Watchdog analysis on fetched transactions
      const watchdogRes = await fetch('/api/tatum/watchdog/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: targetAddress,
          transactions: fetchedTxs
        })
      });

      if (watchdogRes.ok) {
        const watchdogData = await watchdogRes.json();
        setAlerts(watchdogData.alerts || []);
        if (watchdogData.memoryProfile) {
          setMemoryProfile(watchdogData.memoryProfile);
        }
      }
    } catch (err: any) {
      setApiError(err.message || 'Failed to fetch blockchain data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressInput.trim()) return;
    setActiveAddress(addressInput.trim());
    fetchWalletData(addressInput.trim());
  };

  const formatTimeAgo = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="min-h-screen bg-secondary text-primary flex flex-col font-sans">
      {/* Top Mobile-First App Header */}
      <header className="sticky top-0 z-30 bg-primary border-b border-secondary px-lg py-md shadow-xs">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-sm">
            <div className="w-8 h-8 rounded-lg bg-brand-solid flex items-center justify-center text-primary-on-brand shadow-xs">
              <ShieldAlert className="w-4 h-4 text-fg-white shrink-0" />
            </div>
            <div>
              <div className="flex items-center gap-xs">
                <span className="text-md font-semibold text-primary tracking-tight">Ledger Memory</span>
                <span className="bg-utility-brand-50 border border-utility-brand-200 text-utility-brand-700 text-xs px-xs py-none rounded-full font-medium">
                  Watchdog
                </span>
              </div>
              <p className="text-xs text-tertiary">Expense memory & anomaly watcher</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowConfigModal(true)}
            className="inline-flex items-center gap-xs px-sm py-xs rounded-md text-xs font-medium bg-secondary hover:bg-secondary-hover border border-secondary text-secondary transition-colors"
          >
            <Sliders className="w-3.5 h-3.5 text-fg-quaternary shrink-0" />
            Config
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-md w-full mx-auto p-md pb-2xl flex flex-col gap-md">
        {/* API / Key Alerts if missing */}
        {!hasTatumKey && (
          <div className="rounded-xl border border-error-subtle bg-utility-error-50 p-md flex items-start gap-sm">
            <AlertTriangle className="w-5 h-5 text-fg-error-primary shrink-0 mt-xxs" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-utility-error-700">Tatum API Key Required</h3>
              <p className="text-xs text-secondary mt-xxs">
                Please set the <code className="font-mono font-semibold">TATUM_API_KEY</code> environment variable in your server configuration to query live indexed balances.
              </p>
            </div>
          </div>
        )}

        {apiError && hasTatumKey && (
          <div className="rounded-xl border border-secondary bg-utility-warning-50 p-sm flex items-start gap-xs">
            <Info className="w-4 h-4 text-fg-warning-primary shrink-0 mt-xxs" />
            <div className="text-xs text-utility-warning-700 flex-1">
              {apiError}
            </div>
          </div>
        )}

        {/* Walrus Memory Profile Ribbon */}
        <section className="bg-primary rounded-xl border border-secondary p-md shadow-xs flex flex-col gap-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-xs font-semibold text-primary">
              <Database className="w-4 h-4 text-fg-brand-primary shrink-0" />
              Walrus Memory Profile
            </span>
            <span className="inline-flex items-center gap-xs bg-utility-brand-50 border border-utility-brand-200 text-utility-brand-700 px-xs py-xxs rounded-full text-xs font-medium">
              <Sparkles className="w-3 h-3 shrink-0" />
              Watchdog Active
            </span>
          </div>

          <p className="text-xs text-tertiary">
            Walrus decentralised blob memory stores habitual spending patterns and trusted addresses to catch deviations.
          </p>

          <div className="grid grid-cols-2 gap-sm text-xs pt-xs border-t border-secondary">
            <div className="bg-secondary p-sm rounded-lg border border-secondary">
              <div className="text-tertiary text-xs">Usual Transfer Range</div>
              <div className="text-primary font-semibold text-sm mt-xxs">
                {memoryProfile.minUsualTransferEth} – {memoryProfile.maxUsualTransferEth} ETH
              </div>
            </div>
            <div className="bg-secondary p-sm rounded-lg border border-secondary">
              <div className="text-tertiary text-xs">Remembered Peers</div>
              <div className="text-primary font-semibold text-sm mt-xxs">
                {memoryProfile.trustedCount} Addresses
              </div>
            </div>
          </div>
        </section>

        {/* Monitored Wallet Form */}
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-xs">
          <label htmlFor="addressInput" className="text-xs font-semibold text-secondary flex items-center justify-between">
            <span>Watchdog Monitored Address</span>
            <span className="text-tertiary text-xs">Ethereum Mainnet</span>
          </label>
          <div className="flex gap-xs">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-md flex items-center pointer-events-none">
                <Search className="w-4 h-4 text-fg-quaternary shrink-0" />
              </div>
              <input
                id="addressInput"
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="Enter 0x... wallet address"
                className="w-full bg-primary border border-secondary rounded-lg pl-xl pr-sm py-sm text-xs font-mono text-primary placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-focus-ring focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-xs rounded-lg border border-transparent bg-brand-solid px-md py-sm text-xs font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 shrink-0"
            >
              {loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0 text-fg-white" />
              ) : (
                'Watch'
              )}
            </button>
          </div>
        </form>

        {/* Mobile Tab Segmented Switcher */}
        <div className="bg-primary p-xxs rounded-xl border border-secondary flex shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab('wallet')}
            className={`flex-1 py-sm rounded-lg text-xs font-semibold flex items-center justify-center gap-xs transition-colors ${
              activeTab === 'wallet'
                ? 'bg-secondary text-primary shadow-xs'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <WalletIcon className="w-3.5 h-3.5 shrink-0" />
            Wallet & History
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('alerts')}
            className={`flex-1 py-sm rounded-lg text-xs font-semibold flex items-center justify-center gap-xs transition-colors relative ${
              activeTab === 'alerts'
                ? 'bg-secondary text-primary shadow-xs'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <Bell className="w-3.5 h-3.5 shrink-0" />
            Watchdog Alerts
            {alerts.length > 0 && (
              <span className="bg-error-primary text-primary-on-brand text-xs px-xs py-none rounded-full font-bold ml-xxs">
                {alerts.length}
              </span>
            )}
          </button>
        </div>

        {/* =========================================================================
            TAB 1: WALLET SCREEN
        ========================================================================= */}
        {activeTab === 'wallet' && (
          <div className="flex flex-col gap-md">
            {/* Balance Overview Card */}
            <div className="bg-primary border border-secondary rounded-xl p-md shadow-xs">
              <div className="flex items-center justify-between text-xs text-tertiary mb-xs">
                <span>Verified Balance</span>
                <span className="font-mono text-xs text-secondary bg-secondary px-xs py-xxs rounded-md border border-secondary">
                  {activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}
                </span>
              </div>
              <div className="flex items-baseline gap-xs">
                <span className="text-heading-lg font-bold text-primary tracking-tight">
                  {balance}
                </span>
                <span className="text-md font-semibold text-brand-primary">ETH</span>
              </div>
              <div className="mt-sm pt-xs border-t border-secondary flex items-center justify-between text-xs text-tertiary">
                <span className="flex items-center gap-xs">
                  <Sparkles className="w-3.5 h-3.5 text-fg-brand-primary shrink-0" />
                  Live Tatum Data API
                </span>
                <span>Ethereum L1</span>
              </div>
            </div>

            {/* Transaction List Card */}
            <div className="bg-primary border border-secondary rounded-xl p-md shadow-xs flex flex-col gap-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-primary flex items-center gap-xs">
                  <History className="w-4 h-4 text-fg-tertiary shrink-0" />
                  Transactions
                </h2>
                <span className="text-xs text-tertiary">
                  {transactions.length} fetched
                </span>
              </div>

              {loading ? (
                <div className="py-xl flex flex-col items-center justify-center gap-xs text-tertiary">
                  <RefreshCw className="w-6 h-6 animate-spin text-fg-brand-primary" />
                  <span className="text-xs">Querying Tatum indexer...</span>
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-lg text-center text-xs text-tertiary">
                  No recent transactions discovered for this address.
                </div>
              ) : (
                <div className="divide-y divide-secondary">
                  {transactions.map((tx) => (
                    <div key={tx.hash} className="py-sm first:pt-none last:pb-none flex items-center justify-between gap-sm">
                      <div className="flex items-center gap-sm min-w-0">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
                            tx.type === 'outgoing'
                              ? 'bg-utility-gray-50 border-utility-gray-200 text-utility-gray-700'
                              : 'bg-utility-success-50 border-utility-success-200 text-utility-success-700'
                          }`}
                        >
                          {tx.type === 'outgoing' ? (
                            <ArrowUpRight className="w-4 h-4 text-fg-secondary shrink-0" />
                          ) : (
                            <ArrowDownLeft className="w-4 h-4 text-fg-success-primary shrink-0" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-primary truncate">
                            {tx.type === 'outgoing'
                              ? `To: ${tx.to.slice(0, 6)}...${tx.to.slice(-4)}`
                              : `From: ${tx.from.slice(0, 6)}...${tx.from.slice(-4)}`}
                          </div>
                          <div className="text-xs text-tertiary font-mono">
                            {tx.hash.slice(0, 10)}...
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className={`text-xs font-semibold ${tx.type === 'outgoing' ? 'text-primary' : 'text-success-primary'}`}>
                          {tx.type === 'outgoing' ? '-' : '+'}{tx.value} {tx.tokenSymbol}
                        </div>
                        <div className="text-xs text-tertiary">
                          {formatTimeAgo(tx.timestamp)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: WATCHDOG ALERTS SCREEN (Walrus Memory Watchdog)
        ========================================================================= */}
        {activeTab === 'alerts' && (
          <div className="flex flex-col gap-md">
            {/* Watchdog Engine Summary Card */}
            <div className="bg-primary border border-secondary rounded-xl p-md shadow-xs">
              <div className="flex items-center gap-sm">
                <div className="w-9 h-9 rounded-lg bg-utility-brand-50 border border-utility-brand-200 flex items-center justify-center text-brand-primary shrink-0">
                  <Cpu className="w-5 h-5 text-fg-brand-primary shrink-0" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">Walrus Watchdog Watch</h3>
                  <p className="text-xs text-tertiary">Memory-driven anomaly analysis on every expense</p>
                </div>
              </div>

              <div className="mt-md grid grid-cols-3 gap-xs text-center border-t border-secondary pt-sm">
                <div className="bg-secondary p-xs rounded-lg border border-secondary">
                  <div className="text-xs text-tertiary">New Peer</div>
                  <div className="text-sm font-bold text-primary mt-xxs">
                    {alerts.filter(a => a.rule === 'new_address').length}
                  </div>
                </div>
                <div className="bg-secondary p-xs rounded-lg border border-secondary">
                  <div className="text-xs text-tertiary">High Volume</div>
                  <div className="text-sm font-bold text-warning-primary mt-xxs">
                    {alerts.filter(a => a.rule === 'large_amount').length}
                  </div>
                </div>
                <div className="bg-secondary p-xs rounded-lg border border-secondary">
                  <div className="text-xs text-tertiary">Duplicate</div>
                  <div className="text-sm font-bold text-error-primary mt-xxs">
                    {alerts.filter(a => a.rule === 'duplicate_payment').length}
                  </div>
                </div>
              </div>
            </div>

            {/* List of Flagged Watchdog Alerts with Plain-Language Reasons */}
            <div className="flex flex-col gap-sm">
              <div className="flex items-center justify-between px-xs">
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  Watchdog Flags ({alerts.length})
                </span>
                <span className="text-xs text-tertiary">One-line explanations</span>
              </div>

              {alerts.length === 0 ? (
                <div className="bg-primary border border-secondary rounded-xl p-xl text-center flex flex-col items-center justify-center gap-xs shadow-xs">
                  <ShieldCheck className="w-9 h-9 text-fg-success-primary" />
                  <div className="text-sm font-semibold text-primary">All Clear</div>
                  <p className="text-xs text-tertiary max-w-xs">
                    No transactions breached your usual transfer thresholds, untrusted addresses, or duplicate spend rules.
                  </p>
                </div>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`bg-primary border rounded-xl p-md shadow-xs flex flex-col gap-xs ${
                      alert.severity === 'high'
                        ? 'border-error-subtle'
                        : 'border-secondary'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-sm">
                      <div className="flex items-center gap-xs">
                        <span
                          className={`inline-flex items-center gap-xs px-sm py-xxs rounded-full text-xs font-semibold ${
                            alert.severity === 'high'
                              ? 'bg-utility-error-50 text-utility-error-700 border border-utility-error-200'
                              : 'bg-utility-warning-50 text-utility-warning-700 border border-utility-warning-200'
                          }`}
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          {alert.rule === 'new_address' && 'New Address'}
                          {alert.rule === 'large_amount' && 'Unusually Large'}
                          {alert.rule === 'duplicate_payment' && 'Duplicate Payment'}
                        </span>
                        <span className="text-xs text-tertiary font-mono">
                          {alert.amount} {alert.token}
                        </span>
                      </div>
                      <span className="text-xs text-tertiary shrink-0">
                        {formatTimeAgo(alert.timestamp)}
                      </span>
                    </div>

                    {/* One-line plain-language reason as specified */}
                    <div className="bg-secondary p-sm rounded-lg border border-secondary mt-xxs">
                      <p className="text-xs font-medium text-primary leading-relaxed">
                        {alert.reason}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-xs text-tertiary pt-xxs">
                      <span className="font-mono truncate max-w-[170px]">
                        Target: {alert.counterparty}
                      </span>
                      <span className="font-mono text-brand-primary">
                        Tx: {alert.txHash.slice(0, 8)}...
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Placeholders Config & Integration Footnote */}
        <section className="bg-primary border border-secondary rounded-xl p-md shadow-xs flex flex-col gap-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-secondary">
            <span className="flex items-center gap-xs">
              <Sliders className="w-3.5 h-3.5 text-fg-quaternary shrink-0" />
              Integration Placeholders
            </span>
            <span className="text-tertiary">Server-side</span>
          </div>
          <p className="text-xs text-tertiary leading-relaxed">
            Walrus Memory endpoint, Aggregator URLs, and the Tatum API Key have clearly marked placeholders in <code className="text-primary font-mono bg-secondary px-xs py-none rounded border border-secondary">server/routes/tatum.mjs</code>.
          </p>
        </section>
      </main>

      {/* Config Details Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-overlay flex items-center justify-center p-md">
          <div className="bg-primary border border-secondary rounded-xl max-w-sm w-full p-lg shadow-xl flex flex-col gap-md">
            <div className="flex items-center justify-between border-b border-secondary pb-sm">
              <div className="flex items-center gap-xs font-semibold text-primary text-sm">
                <Sliders className="w-4 h-4 text-fg-brand-primary shrink-0" />
                Service Placeholders
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="text-tertiary hover:text-primary text-xs px-xs py-xxs rounded"
              >
                Close
              </button>
            </div>

            <div className="flex flex-col gap-sm text-xs">
              <div>
                <span className="text-tertiary block mb-xxs">Tatum API Key</span>
                <div className="bg-secondary p-xs rounded-md border border-secondary font-mono text-secondary break-all">
                  TATUM_API_KEY (Managed in environment)
                </div>
              </div>

              <div>
                <span className="text-tertiary block mb-xxs">Walrus Publisher Endpoint</span>
                <div className="bg-secondary p-xs rounded-md border border-secondary font-mono text-secondary break-all">
                  WALRUS_PUBLISHER_URL || https://publisher.walrus-testnet.walrus.space
                </div>
              </div>

              <div>
                <span className="text-tertiary block mb-xxs">Walrus Aggregator Endpoint</span>
                <div className="bg-secondary p-xs rounded-md border border-secondary font-mono text-secondary break-all">
                  WALRUS_AGGREGATOR_URL || https://aggregator.walrus-testnet.walrus.space
                </div>
              </div>

              <div>
                <span className="text-tertiary block mb-xxs">Walrus Memory Epoch</span>
                <div className="bg-secondary p-xs rounded-md border border-secondary font-mono text-secondary break-all">
                  epoch-walrus-alpha-watchdog-v1
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowConfigModal(false)}
              className="inline-flex items-center justify-center rounded-lg border border-transparent bg-brand-solid px-md py-sm text-xs font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
