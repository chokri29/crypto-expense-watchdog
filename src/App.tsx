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
  Database, 
  Sparkles, 
  RefreshCw, 
  Sliders, 
  History, 
  Info, 
  ShieldCheck, 
  MessageSquare, 
  BrainCircuit, 
  Send, 
  Plus, 
  Trash2, 
  EyeOff, 
  PieChart, 
  TrendingUp, 
  TrendingDown, 
  UserCheck, 
  ToggleLeft,
  ToggleRight,
  ExternalLink,
  Copy,
  X
} from 'lucide-react';

interface Transaction {
  hash: string;
  from: string;
  to: string;
  valueDisplay: string;
  numericEth: number;
  timestamp: number;
  type: 'incoming' | 'outgoing';
  tokenSymbol: string;
  category: string;
  feeEth: string;
  numericFeeEth: number;
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
  isTrusted?: boolean;
}

interface TrustedAddress {
  address: string;
  name: string;
  category: string;
  addedAt: number;
}

interface FavoriteCounterparty {
  address: string;
  label: string;
  frequency: number;
  totalVolume: string;
}

interface MemoryProfileData {
  walletAddress: string;
  minUsualTransferEth: number;
  maxUsualTransferEth: number;
  monthlyFeeBudgetEth: number;
  averageFeeGwei: number;
}

interface MonthlySummary {
  hasActivity: boolean;
  currentMonthTotalEth: string;
  totalFeesEth: string;
  diffPercentDisplay: string;
  changeNote: string;
  categories: Array<{
    name: string;
    amountEth: string;
    percentage: number;
  }>;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  recalledMemories?: string[];
  timestamp: number;
}

export function App() {
  const [activeTab, setActiveTab] = useState<'wallet' | 'alerts' | 'chat' | 'memory'>('wallet');
  const [addressInput, setAddressInput] = useState('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  const [activeAddress, setActiveAddress] = useState('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
  
  // Demo Mode toggle
  const [demoMode, setDemoMode] = useState<boolean>(false);
  const [hasTatumKey, setHasTatumKey] = useState<boolean>(true);

  // Wallet Data
  const [balance, setBalance] = useState<string>('0.0000');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<MonthlySummary | null>(null);

  // Alerts Data
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  // Memory Data
  const [memoryProfile, setMemoryProfile] = useState<MemoryProfileData>({
    walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    minUsualTransferEth: 0.05,
    maxUsualTransferEth: 0.65,
    monthlyFeeBudgetEth: 0.045,
    averageFeeGwei: 24
  });
  const [trustedAddresses, setTrustedAddresses] = useState<TrustedAddress[]>([]);
  const [favoriteCounterparties, setFavoriteCounterparties] = useState<FavoriteCounterparty[]>([]);
  const [newTrustAddress, setNewTrustAddress] = useState('');
  const [newTrustName, setNewTrustName] = useState('');
  const [newTrustCategory, setNewTrustCategory] = useState('Custom');

  // Chat Data
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'assistant',
      text: "Hello! I am Ledger Memory Watchdog. I keep an active Walrus decentralized memory of your usual transfers, trusted contacts, and gas habits. Ask me anything about your expenses!",
      recalledMemories: [
        'Walrus Memory profile loaded for active wallet.',
        'Established habits: 0.05 – 0.65 ETH transfer range, 24 Gwei gas baseline.'
      ],
      timestamp: Date.now() - 1000 * 60 * 5
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // UI state
  const [loading, setLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => setSuccessToast(null), 3500);
  };

  const copyToClipboard = (text: string, label: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast(`Copied ${label} to clipboard!`);
    }
  };

  useEffect(() => {
    (async () => {
      const useDemo = await fetchStatus();
      loadAllData(activeAddress, useDemo);
    })();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/tatum/status');
      if (res.ok) {
        const data = await res.json();
        const useDemo = Boolean(data.defaultDemo || !data.hasTatumKey);
        setHasTatumKey(Boolean(data.hasTatumKey));
        if (useDemo) setDemoMode(true);
        return useDemo;
      }
    } catch (_) {}
    return false;
  };

  const loadAllData = async (targetAddress: string, isDemo: boolean) => {
    setLoading(true);
    setApiError(null);

    try {
      // 1. Balance
      const balanceUrl = `/api/tatum/wallet/balance?address=${encodeURIComponent(targetAddress)}&chain=ethereum-mainnet${isDemo ? '&demo=true' : ''}`;
      const balanceRes = await fetch(balanceUrl);
      if (balanceRes.ok) {
        const bData = await balanceRes.json();
        setBalance(bData.balance || '0.0000');
      } else {
        const errJson = await balanceRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to fetch wallet balance from Tatum');
      }

      // 2. Transactions
      const txUrl = `/api/tatum/wallet/transactions?address=${encodeURIComponent(targetAddress)}&chain=ethereum-mainnet${isDemo ? '&demo=true' : ''}`;
      const txRes = await fetch(txUrl);
      let fetchedTxs: Transaction[] = [];
      if (txRes.ok) {
        const tData = await txRes.json();
        fetchedTxs = tData.transactions || [];
        setTransactions(fetchedTxs);
        // Transaction history is the primary wallet view. Do not keep it hidden
        // behind slower summary, memory, or watchdog requests.
        setLoading(false);
      } else {
        const errJson = await txRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to fetch transaction records from Tatum');
      }

      // 3. Monthly Summary
      const summaryUrl = `/api/tatum/wallet/summary?address=${encodeURIComponent(targetAddress)}${isDemo ? '&demo=true' : ''}`;
      const summaryRes = await fetch(summaryUrl);
      if (summaryRes.ok) {
        const sData = await summaryRes.json();
        setMonthlySummary(sData);
      }

      // 4. Memory profile
      const memRes = await fetch('/api/tatum/memory');
      if (memRes.ok) {
        const mData = await memRes.json();
        if (mData.profile) setMemoryProfile(mData.profile);
        if (mData.trustedAddresses) setTrustedAddresses(mData.trustedAddresses);
        if (mData.favoriteCounterparties) setFavoriteCounterparties(mData.favoriteCounterparties);
      }

      // 5. Watchdog analysis for alerts
      const watchRes = await fetch('/api/tatum/watchdog/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: targetAddress,
          transactions: fetchedTxs
        })
      });
      if (watchRes.ok) {
        const wData = await watchRes.json();
        setAlerts(wData.alerts || []);
      }
    } catch (err: any) {
      setApiError(err.message || 'Error communicating with Tatum API.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDemo = () => {
    const nextDemo = !demoMode;
    setDemoMode(nextDemo);
    loadAllData(activeAddress, nextDemo);
    showToast(nextDemo ? 'Demo mode enabled (Sample data).' : 'Live mode enabled (Tatum API).');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressInput.trim()) return;
    setActiveAddress(addressInput.trim());
    loadAllData(addressInput.trim(), demoMode);
  };

  const handleRetry = () => {
    loadAllData(activeAddress, demoMode);
  };

  const handleTrustAddress = async (addressToTrust: string, name?: string, category?: string) => {
    try {
      const res = await fetch('/api/tatum/memory/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: addressToTrust,
          name: name || `Contact ${addressToTrust.slice(0, 6)}`,
          category: category || 'Trusted'
        })
      });
      if (res.ok) {
        const data = await res.json();
        setTrustedAddresses(data.trustedAddresses);
        loadAllData(activeAddress, demoMode);
        showToast(`Saved ${addressToTrust.slice(0, 8)}... to Walrus Memory!`);
      }
    } catch (err: any) {
      setApiError(err.message);
    }
  };

  const handleUntrustAddress = async (addressToUntrust: string) => {
    try {
      const res = await fetch('/api/tatum/memory/untrust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addressToUntrust })
      });
      if (res.ok) {
        const data = await res.json();
        setTrustedAddresses(data.trustedAddresses);
        showToast('Address untrusted and removed from memory.');
      }
    } catch (err: any) {
      setApiError(err.message);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      const res = await fetch('/api/tatum/memory/dismiss-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          alertId,
          note: 'User dismissed and ignored alert'
        })
      });
      if (res.ok) {
        setAlerts(prev => prev.filter(a => a.id !== alertId));
        showToast('Alert ignored and recorded in Walrus Memory.');
      }
    } catch (err: any) {
      setApiError(err.message);
    }
  };

  const handleSendChat = async (queryText?: string) => {
    const textToSend = queryText || chatInput;
    if (!textToSend.trim() || chatLoading) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: Date.now()
    };

    setChatMessages(prev => [...prev, userMsg]);
    if (!queryText) setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/tatum/chat/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: textToSend,
          address: activeAddress
        })
      });

      if (res.ok) {
        const data = await res.json();
        const assistantMsg: ChatMessage = {
          id: `ast-${Date.now()}`,
          sender: 'assistant',
          text: data.answer,
          recalledMemories: data.recalledMemories || [],
          timestamp: Date.now()
        };
        setChatMessages(prev => [...prev, assistantMsg]);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setChatMessages(prev => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            sender: 'assistant',
            text: errJson.error || 'Unable to process query right now.',
            timestamp: Date.now()
          }
        ]);
      }
    } catch (err: any) {
      setChatMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: 'Connection error while consulting Walrus Memory.',
          timestamp: Date.now()
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    if (!timestamp) return 'n/a';
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
    <div className="min-h-screen bg-secondary text-primary flex flex-col font-sans pb-11xl">
      {/* Toast Notification */}
      {successToast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-start gap-sm rounded-lg border border-secondary bg-primary p-lg shadow-lg">
          <CheckCircle2 className="mt-xxs size-4 shrink-0 text-fg-success-primary" aria-hidden="true" />
          <p className="text-sm text-secondary">{successToast}</p>
        </div>
      )}

      {/* Top Mobile Header */}
      <header className="sticky top-0 z-30 bg-primary border-b border-secondary px-lg py-sm shadow-xs">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-sm">
            <div className="w-8 h-8 rounded-lg bg-brand-solid flex items-center justify-center text-primary-on-brand shadow-xs">
              <ShieldAlert className="size-4 text-fg-white shrink-0" />
            </div>
            <div>
              <div className="flex items-center gap-xs">
                <span className="text-md font-semibold text-primary tracking-tight">Ledger Memory</span>
                {/* Visible Data Source Badge */}
                {demoMode ? (
                  <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                    Sample data
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-xs rounded-full border border-utility-success-200 bg-utility-success-50 px-md py-xxs text-xs font-medium text-utility-success-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-success-primary animate-pulse" />
                    Live data from Tatum
                  </span>
                )}
              </div>
              <p className="text-xs text-tertiary">Expense watchdog & memory guardian</p>
            </div>
          </div>

          <div className="flex items-center gap-xs">
            {/* Demo Mode Toggle Button */}
            <button
              type="button"
              onClick={handleToggleDemo}
              className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-semibold shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
                demoMode
                  ? 'border-utility-brand-200 bg-utility-brand-50 text-utility-brand-700'
                  : 'bg-primary text-secondary border-primary hover:bg-primary-hover'
              }`}
            >
              {demoMode ? (
                <>
                  <ToggleRight className="size-4 text-fg-brand-primary shrink-0" />
                  <span>Demo</span>
                </>
              ) : (
                <>
                  <ToggleLeft className="size-4 text-fg-quaternary shrink-0" />
                  <span>Live</span>
                </>
              )}
            </button>

            {/* Config modal button */}
            <button
              type="button"
              onClick={() => setShowConfigModal(true)}
              className="inline-flex items-center rounded-lg bg-primary p-sm text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              title="Config Placeholders"
            >
              <Sliders className="size-4 text-fg-quaternary shrink-0" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-md w-full mx-auto p-md flex flex-col gap-md">
        {/* API Failure with Retry button (Requirement 6) */}
        {apiError && (
          <div className="flex flex-col gap-sm rounded-xl bg-utility-error-50 p-xl border border-error-subtle">
            <div className="flex gap-lg items-start">
              <AlertTriangle className="mt-xxs size-5 shrink-0 text-utility-error-600" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-utility-error-600">API Connection Failed</p>
                <p className="mt-xxs text-sm text-tertiary">{apiError}</p>
              </div>
            </div>
            <div className="flex justify-end gap-sm mt-xs">
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <RefreshCw className="size-4 shrink-0 text-fg-white" />
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Monitored Wallet Form */}
        <form onSubmit={handleSearchSubmit} className="flex flex-col gap-sm">
          <label htmlFor="addressInput" className="text-sm font-medium text-secondary flex items-center justify-between">
            <span>Watchdog Monitored Address</span>
            <span className="text-xs text-tertiary">
              {demoMode ? 'Sample Sandbox' : 'Ethereum L1'}
            </span>
          </label>
          <div className="flex gap-xs">
              <div className="relative flex-1">
                <div className="absolute inset-y-0 left-0 pl-md flex items-center pointer-events-none">
                  <Search className="size-4 text-fg-quaternary shrink-0" />
                </div>
                <input
                  id="addressInput"
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="0x... wallet address"
                  className="w-full rounded-md bg-primary pl-3xl pr-lg py-sm text-sm font-mono text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring focus:outline-none"
                />
              </div>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 shrink-0"
            >
              {loading ? <RefreshCw className="size-4 animate-spin text-fg-white shrink-0" /> : 'Watch'}
            </button>
          </div>
        </form>

        {/* =========================================================================
            SCREEN 1: WALLET (Balance, Monthly Summary Card, Real Transactions)
        ========================================================================= */}
        {activeTab === 'wallet' && (
          <div className="flex flex-col gap-md">
            {/* Balance Overview Card */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
              <div className="flex items-center justify-between text-xs text-tertiary mb-xs">
                <span>Verified Balance</span>
                {/* Etherscan Address Chip (Requirement 5) */}
                <div className="flex items-center gap-xs">
                  <a
                    href={`https://etherscan.io/address/${activeAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-secondary bg-secondary px-xs py-xxs rounded-md border border-secondary hover:text-brand-primary flex items-center gap-xxs"
                    title="View address on Etherscan"
                  >
                    <span>{activeAddress.slice(0, 6)}...{activeAddress.slice(-4)}</span>
                    <ExternalLink className="size-3 text-fg-quaternary" />
                  </a>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(activeAddress, 'address')}
                    className="p-xxs text-tertiary hover:text-primary rounded"
                    title="Copy address"
                  >
                    <Copy className="size-3" />
                  </button>
                </div>
              </div>
              <div className="flex items-baseline gap-xs">
                <span className="text-heading-lg font-bold text-primary tracking-tight">
                  {balance}
                </span>
                <span className="text-md font-semibold text-brand-primary">ETH</span>
              </div>
              <div className="mt-md pt-xs border-t border-secondary flex items-center justify-between text-xs text-tertiary">
                <span className="flex items-center gap-xs">
                  <Sparkles className="size-4 text-fg-brand-primary shrink-0" />
                  {demoMode ? 'Sample data' : 'Live data from Tatum'}
                </span>
                <span>Ethereum</span>
              </div>
            </section>

            {/* MONTHLY SUMMARY CARD (Requirement 4: Rolling 30 Days, Exact Sums) */}
            {monthlySummary && (
              <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-xs">
                    <PieChart className="size-4 text-fg-brand-primary shrink-0" />
                    <h2 className="text-sm font-semibold text-primary">Monthly Expense Summary</h2>
                  </div>
                  <span className="text-xs text-tertiary">Rolling 30 Days</span>
                </div>

                {/* Top Metrics Row */}
                <div className="grid grid-cols-2 gap-sm">
                  <div className="bg-secondary p-sm rounded-lg border border-secondary">
                    <div className="text-xs text-tertiary">Total Outgoing</div>
                    <div className="text-sm font-bold text-primary mt-xxs">
                      {monthlySummary.currentMonthTotalEth}
                    </div>
                    <div className="flex items-center gap-xxs text-xs mt-xxs">
                      {monthlySummary.diffPercentDisplay !== 'n/a' ? (
                        <span className="text-secondary flex items-center font-semibold">
                          {monthlySummary.diffPercentDisplay.startsWith('+') ? (
                            <TrendingUp className="w-3 h-3 mr-xxs inline text-warning-primary" />
                          ) : (
                            <TrendingDown className="w-3 h-3 mr-xxs inline text-success-primary" />
                          )}
                          {monthlySummary.diffPercentDisplay}
                        </span>
                      ) : (
                        <span className="text-tertiary font-medium">n/a</span>
                      )}
                      <span className="text-tertiary text-xs">vs prev 30d</span>
                    </div>
                  </div>

                  <div className="bg-secondary p-sm rounded-lg border border-secondary">
                    <div className="text-xs text-tertiary">Total Fees Paid</div>
                    <div className="text-sm font-bold text-primary mt-xxs">
                      {monthlySummary.totalFeesEth}
                    </div>
                    <div className="text-xs text-tertiary mt-xxs">
                      Receipt Verified
                    </div>
                  </div>
                </div>

                {/* Category Breakdown */}
                <div className="flex flex-col gap-xs pt-xs border-t border-secondary">
                  <span className="text-xs font-semibold text-secondary">Spending by Category</span>
                  <div className="flex flex-col gap-xs">
                    {monthlySummary.categories.map((cat) => (
                      <div key={cat.name} className="flex flex-col gap-xxs">
                        <div className="flex justify-between text-xs">
                          <span className="text-secondary">{cat.name}</span>
                          <span className="font-semibold text-primary">{cat.amountEth} ({cat.percentage}%)</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-tertiary">
                          <div 
                            className="h-full rounded-full bg-brand-solid transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, cat.percentage))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* What Changed Note */}
                <div className="bg-secondary p-sm rounded-lg border border-secondary mt-xxs">
                  <div className="flex items-center gap-xs text-xs font-semibold text-secondary mb-xxs">
                    <Sparkles className="size-3 text-fg-brand-primary shrink-0" />
                    What changed since last month
                  </div>
                  <p className="text-xs text-tertiary leading-relaxed">
                    {monthlySummary.changeNote}
                  </p>
                </div>
              </section>
            )}

            {/* Transactions Section (Requirements 1, 2, 3, 5) */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-primary flex items-center gap-xs">
                  <History className="size-4 text-fg-tertiary shrink-0" />
                  Recent Transactions
                </h2>
                <span className="text-xs text-tertiary">{transactions.length} verified</span>
              </div>

              {loading ? (
                <div className="py-xl flex flex-col items-center justify-center gap-xs text-tertiary">
                  <RefreshCw className="size-6 animate-spin text-fg-brand-primary" />
                  <span className="text-xs">Querying Tatum Data API...</span>
                </div>
              ) : transactions.length === 0 ? (
                <div className="py-lg text-center text-xs text-tertiary">
                  No transactions found for this address.
                </div>
              ) : (
                <div className="divide-y divide-secondary">
                  {transactions.map((tx) => (
                    <div key={tx.hash} className="py-sm first:pt-none last:pb-none flex flex-col gap-xs">
                      <div className="flex items-center justify-between gap-sm">
                        <div className="flex items-center gap-sm min-w-0">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
                              tx.type === 'outgoing'
                                ? 'bg-utility-gray-50 border-utility-gray-200 text-utility-gray-700'
                                : 'bg-utility-success-50 border-utility-success-200 text-utility-success-700'
                            }`}
                          >
                            {tx.type === 'outgoing' ? (
                              <ArrowUpRight className="size-4 text-fg-secondary shrink-0" />
                            ) : (
                              <ArrowDownLeft className="size-4 text-fg-success-primary shrink-0" />
                            )}
                          </div>
                          <div className="min-w-0">
                            {/* Category Badge & Real From/To */}
                            <div className="flex items-center gap-xs flex-wrap">
                              <span className="inline-flex items-center rounded-full border border-utility-gray-200 bg-utility-gray-50 px-xs py-none text-xs font-medium text-utility-gray-700">
                                {tx.category}
                              </span>
                              <span className="text-xs font-medium text-primary truncate max-w-[170px]">
                                {tx.type === 'outgoing' ? `To: ${tx.to}` : `From: ${tx.from}`}
                              </span>
                            </div>

                            <div className="text-xs text-tertiary mt-xxs flex items-center gap-xs">
                              <span>Fee: {tx.feeEth !== 'n/a' ? `${tx.feeEth} ETH` : 'n/a'}</span>
                              <span>•</span>
                              <span>{formatTimeAgo(tx.timestamp)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Real Value Display */}
                        <div className="text-right shrink-0">
                          <div className={`text-xs font-semibold ${tx.type === 'outgoing' ? 'text-primary' : 'text-success-primary'}`}>
                            {tx.type === 'outgoing' ? '-' : '+'}{tx.valueDisplay}
                          </div>
                        </div>
                      </div>

                      {/* Etherscan TX Hash Link & Copy Hash Fallback (Requirement 5) */}
                      <div className="flex items-center justify-between text-xs text-tertiary bg-secondary px-xs py-xxs rounded-md border border-secondary">
                        <a
                          href={`https://etherscan.io/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-secondary hover:text-brand-primary flex items-center gap-xxs truncate max-w-[280px]"
                          title="Open transaction on Etherscan"
                        >
                          <span className="truncate">{tx.hash}</span>
                          <ExternalLink className="size-3 text-fg-quaternary shrink-0" />
                        </a>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(tx.hash, 'tx hash')}
                          className="inline-flex items-center gap-xxs text-xs text-tertiary hover:text-primary shrink-0 ml-xs"
                          title="Copy hash"
                        >
                          <Copy className="size-3" />
                          <span>Copy</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* =========================================================================
            SCREEN 2: ALERTS (Upgraded with Severity, Reason, Trust Button, Ignore)
        ========================================================================= */}
        {activeTab === 'alerts' && (
          <div className="flex flex-col gap-md">
            {/* Watchdog Status Card */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs">
              <div className="flex items-center gap-sm">
                <div className="w-9 h-9 rounded-lg bg-utility-brand-50 border border-utility-brand-200 flex items-center justify-center text-brand-primary shrink-0">
                  <ShieldAlert className="size-5 text-fg-brand-primary shrink-0" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">Watchdog Watch Protocol</h3>
                  <p className="text-xs text-tertiary">Real-time alerts scored against Walrus Memory habits</p>
                </div>
              </div>

              <div className="mt-md grid grid-cols-3 gap-xs text-center border-t border-secondary pt-sm">
                <div className="bg-secondary p-xs rounded-lg border border-secondary">
                  <div className="text-xs text-tertiary">High Severity</div>
                  <div className="text-sm font-bold text-error-primary mt-xxs">
                    {alerts.filter(a => a.severity === 'high').length}
                  </div>
                </div>
                <div className="bg-secondary p-xs rounded-lg border border-secondary">
                  <div className="text-xs text-tertiary">Medium</div>
                  <div className="text-sm font-bold text-warning-primary mt-xxs">
                    {alerts.filter(a => a.severity === 'medium').length}
                  </div>
                </div>
                <div className="bg-secondary p-xs rounded-lg border border-secondary">
                  <div className="text-xs text-tertiary">Low</div>
                  <div className="text-sm font-bold text-primary mt-xxs">
                    {alerts.filter(a => a.severity === 'low').length}
                  </div>
                </div>
              </div>
            </section>

            {/* Alerts List */}
            <div className="flex flex-col gap-sm">
              <div className="flex items-center justify-between px-xs">
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  Active Flags ({alerts.length})
                </span>
                <span className="text-xs text-tertiary">One-line plain reasons</span>
              </div>

              {alerts.length === 0 ? (
                <section className="rounded-xl border border-secondary bg-primary p-xl text-center flex flex-col items-center justify-center gap-xs shadow-xs">
                  <ShieldCheck className="size-9 text-fg-success-primary" />
                  <div className="text-sm font-semibold text-primary">Zero Anomalies Detected</div>
                  <p className="text-xs text-tertiary max-w-xs">
                    All transfers conform to your remembered transfer sizes and trusted counterparty memory.
                  </p>
                </section>
              ) : (
                alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`rounded-xl border bg-primary p-xl shadow-xs flex flex-col gap-sm ${
                      alert.severity === 'high'
                        ? 'border-error-subtle'
                        : 'border-secondary'
                    }`}
                  >
                    {/* Severity Badge & Rule */}
                    <div className="flex items-start justify-between gap-sm">
                      <div className="flex items-center gap-xs flex-wrap">
                        <span
                          className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-medium ${
                            alert.severity === 'high'
                              ? 'bg-utility-error-50 border-utility-error-200 text-utility-error-700'
                              : alert.severity === 'medium'
                              ? 'bg-utility-warning-50 border-utility-warning-200 text-utility-warning-700'
                              : 'bg-utility-gray-50 border-utility-gray-200 text-utility-gray-700'
                          }`}
                        >
                          <AlertTriangle className="size-3 shrink-0" />
                          {alert.severity.toUpperCase()} SEVERITY
                        </span>

                        <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                          {alert.rule === 'new_address' && 'New Counterparty'}
                          {alert.rule === 'large_amount' && 'Unusually Large'}
                          {alert.rule === 'duplicate_payment' && 'Duplicate Payment'}
                        </span>
                      </div>
                      <span className="text-xs text-tertiary shrink-0">
                        {formatTimeAgo(alert.timestamp)}
                      </span>
                    </div>

                    {/* One-Line Plain-Language Reason */}
                    <div className="bg-secondary p-sm rounded-lg border border-secondary">
                      <p className="text-xs font-medium text-primary leading-relaxed">
                        {alert.reason}
                      </p>
                    </div>

                    {/* Target & Actions Row */}
                    <div className="flex items-center justify-between text-xs pt-xxs gap-sm">
                      <div className="min-w-0">
                        <span className="text-tertiary block truncate text-xs font-mono">
                          Target: {alert.counterparty}
                        </span>
                        <span className="text-xs font-semibold text-primary">
                          Amount: {alert.amount}
                        </span>
                      </div>

                      <div className="flex items-center gap-xs shrink-0">
                        {/* Trust this address button */}
                        <button
                          type="button"
                          onClick={() => handleTrustAddress(alert.counterparty, `Peer ${alert.counterparty.slice(0, 6)}`)}
                          className="inline-flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
                        >
                          <UserCheck className="size-4 text-fg-brand-primary shrink-0" />
                          Trust address
                        </button>

                        {/* Ignore alert button */}
                        <button
                          type="button"
                          onClick={() => handleDismissAlert(alert.id)}
                          className="inline-flex items-center p-sm rounded-lg text-tertiary hover:text-secondary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring transition-colors"
                          title="Ignore this alert"
                        >
                          <EyeOff className="size-4 shrink-0" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            SCREEN 3: CHAT (Q&A using Walrus Memory + Tatum Data)
        ========================================================================= */}
        {activeTab === 'chat' && (
          <div className="flex flex-col gap-md">
            {/* Chat Header Card */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-sm">
                <div className="w-8 h-8 rounded-lg bg-brand-solid flex items-center justify-center text-primary-on-brand shadow-xs">
                  <BrainCircuit className="size-4 text-fg-white shrink-0" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">Memory Watchdog Assistant</h3>
                  <p className="text-xs text-tertiary">Combines Tatum on-chain logs with Walrus habits</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                Walrus Active
              </span>
            </section>

            {/* Quick Prompt Suggestion Chips */}
            <div className="flex flex-col gap-xs">
              <span className="text-xs font-semibold text-secondary px-xs">Suggested Inquiries</span>
              <div className="flex gap-xs overflow-x-auto pb-xxs">
                <button
                  type="button"
                  onClick={() => handleSendChat("Did I overpay on fees this month?")}
                  className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring whitespace-nowrap"
                >
                  "Did I overpay on fees this month?"
                </button>
                <button
                  type="button"
                  onClick={() => handleSendChat("Why was this flagged?")}
                  className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring whitespace-nowrap"
                >
                  "Why was this flagged?"
                </button>
                <button
                  type="button"
                  onClick={() => handleSendChat("Who is this address?")}
                  className="inline-flex items-center gap-sm rounded-full bg-primary px-lg py-sm text-sm font-semibold text-secondary border border-primary shadow-xs hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring whitespace-nowrap"
                >
                  "Who is this address?"
                </button>
              </div>
            </div>

            {/* Messages Feed */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-md min-h-[320px] max-h-[440px] overflow-y-auto">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col gap-xs ${
                    msg.sender === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`p-sm rounded-xl text-xs max-w-[85%] leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-brand-solid text-primary-on-brand shadow-xs'
                        : 'bg-secondary text-primary border border-secondary'
                    }`}
                  >
                    {msg.text}
                  </div>

                  {msg.recalledMemories && msg.recalledMemories.length > 0 && (
                    <div className="bg-primary border border-secondary rounded-lg p-xs text-xs max-w-[85%] flex flex-col gap-xxs shadow-xs">
                      <div className="flex items-center gap-xxs font-semibold text-brand-primary text-xs">
                        <Sparkles className="size-3 text-fg-brand-primary shrink-0" />
                        Ledger Memory recalled from Walrus:
                      </div>
                      {msg.recalledMemories.map((mem, i) => (
                        <div key={i} className="text-tertiary text-xs pl-xs border-l border-brand">
                          {mem}
                        </div>
                      ))}
                    </div>
                  )}

                  <span className="text-tertiary text-xs px-xs">
                    {formatTimeAgo(msg.timestamp)}
                  </span>
                </div>
              ))}

              {chatLoading && (
                <div className="flex items-center gap-xs text-tertiary text-xs py-xs">
                  <RefreshCw className="size-4 animate-spin text-fg-brand-primary shrink-0" />
                  <span>Consulting Walrus Memory and Tatum data...</span>
                </div>
              )}
            </section>

            {/* Chat Input Field */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendChat();
              }}
              className="flex gap-xs"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about fees, addresses, or flags..."
                className="flex-1 rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="inline-flex items-center justify-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 shrink-0"
              >
                <Send className="size-4 shrink-0 text-fg-white" />
              </button>
            </form>
          </div>
        )}

        {/* =========================================================================
            SCREEN 4: MEMORY (Walrus Profile, Trusted Contacts, Add/Remove Trust)
        ========================================================================= */}
        {activeTab === 'memory' && (
          <div className="flex flex-col gap-md">
            {/* What Walrus Currently Remembers Card */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-sm">
                  <div className="w-8 h-8 rounded-lg bg-utility-brand-50 border border-utility-brand-200 flex items-center justify-center text-brand-primary shrink-0">
                    <Database className="size-4 text-fg-brand-primary shrink-0" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">Walrus Memory Store</h3>
                    <p className="text-xs text-tertiary">Decentralized user habits profile</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                  Epoch Active
                </span>
              </div>

              {/* Habit Metrics */}
              <div className="grid grid-cols-2 gap-sm pt-xs border-t border-secondary">
                <div className="bg-secondary p-sm rounded-lg border border-secondary">
                  <span className="text-tertiary text-xs">Customary Transfer Size</span>
                  <div className="text-sm font-bold text-primary mt-xxs">
                    {memoryProfile.minUsualTransferEth} – {memoryProfile.maxUsualTransferEth} ETH
                  </div>
                  <span className="text-tertiary text-xs">Deviation triggers flags</span>
                </div>
                <div className="bg-secondary p-sm rounded-lg border border-secondary">
                  <span className="text-tertiary text-xs">Monthly Gas Budget</span>
                  <div className="text-sm font-bold text-primary mt-xxs">
                    {memoryProfile.monthlyFeeBudgetEth} ETH
                  </div>
                  <span className="text-tertiary text-xs">Avg: {memoryProfile.averageFeeGwei} Gwei</span>
                </div>
              </div>
            </section>

            {/* Favorite Counterparties */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-sm">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-secondary uppercase tracking-wider">
                  Favorite Counterparties
                </h4>
                <span className="text-xs text-tertiary">Remembered Habits</span>
              </div>

              <div className="divide-y divide-secondary">
                {favoriteCounterparties.map((peer) => (
                  <div key={peer.address} className="py-xs flex items-center justify-between text-xs first:pt-none last:pb-none">
                    <div>
                      <div className="font-semibold text-primary">{peer.label}</div>
                      <div className="text-tertiary font-mono text-xs">{peer.address.slice(0, 10)}...</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-secondary">{peer.frequency} txs</div>
                      <div className="text-tertiary text-xs">{peer.totalVolume}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Trusted Addresses Manager (Add / Remove) */}
            <section className="rounded-xl border border-secondary bg-primary p-xl shadow-xs flex flex-col gap-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-primary">Trusted Addresses</h4>
                  <p className="text-xs text-tertiary">Whitelisted peers saved directly to Walrus Memory</p>
                </div>
                <span className="inline-flex items-center gap-xs rounded-full border border-utility-brand-200 bg-utility-brand-50 px-md py-xxs text-xs font-medium text-utility-brand-700">
                  {trustedAddresses.length} Registered
                </span>
              </div>

              {/* Add New Trusted Address Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTrustAddress.trim()) return;
                  handleTrustAddress(newTrustAddress.trim(), newTrustName.trim(), newTrustCategory);
                  setNewTrustAddress('');
                  setNewTrustName('');
                }}
                className="bg-secondary p-sm rounded-lg border border-secondary flex flex-col gap-sm"
              >
                <label className="text-sm font-medium text-secondary">Register New Trusted Address</label>
                <input
                  type="text"
                  placeholder="0x... wallet or contract address"
                  value={newTrustAddress}
                  onChange={(e) => setNewTrustAddress(e.target.value)}
                  className="rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring focus:outline-none"
                />
                <div className="flex gap-sm">
                  <input
                    type="text"
                    placeholder="Label name (e.g. Treasury Safe)"
                    value={newTrustName}
                    onChange={(e) => setNewTrustName(e.target.value)}
                    className="flex-1 rounded-md bg-primary px-lg py-sm text-sm text-primary placeholder:text-placeholder border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring focus:outline-none"
                  />
                  <select
                    value={newTrustCategory}
                    onChange={(e) => setNewTrustCategory(e.target.value)}
                    className="rounded-md bg-primary px-lg py-sm text-sm text-primary border border-primary focus-visible:ring-2 focus-visible:ring-focus-ring focus:outline-none"
                  >
                    <option value="Self">Self</option>
                    <option value="Exchange">Exchange</option>
                    <option value="DeFi">DeFi</option>
                    <option value="Partner">Partner</option>
                    <option value="Custom">Custom</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={!newTrustAddress.trim()}
                  className="inline-flex items-center justify-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-50 mt-xxs"
                >
                  <Plus className="size-4 shrink-0" />
                  Save to Walrus Memory
                </button>
              </form>

              {/* Trusted Addresses List */}
              <div className="divide-y divide-secondary">
                {trustedAddresses.map((trusted) => (
                  <div key={trusted.address} className="py-sm first:pt-none last:pb-none flex items-center justify-between gap-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-xs">
                        <span className="text-xs font-semibold text-primary">{trusted.name}</span>
                        <span className="inline-flex items-center gap-xs rounded-full border border-utility-gray-200 bg-utility-gray-50 px-md py-xxs text-xs font-medium text-utility-gray-700">
                          {trusted.category}
                        </span>
                      </div>
                      <div className="text-tertiary font-mono text-xs truncate">
                        {trusted.address}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleUntrustAddress(trusted.address)}
                      className="inline-flex items-center p-sm rounded-lg text-tertiary hover:text-error-primary hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-focus-ring transition-colors shrink-0"
                      title="Remove from Walrus Memory"
                    >
                      <Trash2 className="size-4 shrink-0" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-primary border-t border-secondary py-xs shadow-lg">
        <div className="max-w-md mx-auto grid grid-cols-4 px-sm">
          <button
            type="button"
            onClick={() => setActiveTab('wallet')}
            className={`flex flex-col items-center justify-center py-xs rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
              activeTab === 'wallet'
                ? 'text-brand-primary font-semibold'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <WalletIcon className="size-5 shrink-0" />
            <span className="text-xs mt-xxs">Wallet</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('alerts')}
            className={`flex flex-col items-center justify-center py-xs rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring relative ${
              activeTab === 'alerts'
                ? 'text-brand-primary font-semibold'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <div className="relative">
              <Bell className="size-5 shrink-0" />
              {alerts.length > 0 && (
                <span className="absolute -top-1 -right-2 bg-error-primary text-primary-on-brand text-xs px-xs py-none rounded-full font-bold">
                  {alerts.length}
                </span>
              )}
            </div>
            <span className="text-xs mt-xxs">Alerts</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex flex-col items-center justify-center py-xs rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
              activeTab === 'chat'
                ? 'text-brand-primary font-semibold'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <MessageSquare className="size-5 shrink-0" />
            <span className="text-xs mt-xxs">Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`flex flex-col items-center justify-center py-xs rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring ${
              activeTab === 'memory'
                ? 'text-brand-primary font-semibold'
                : 'text-tertiary hover:text-secondary'
            }`}
          >
            <BrainCircuit className="size-5 shrink-0" />
            <span className="text-xs mt-xxs">Memory</span>
          </button>
        </div>
      </nav>

      {/* Config Details Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-md">
          <div 
            className="fixed inset-0 bg-overlay opacity-70"
            onClick={() => setShowConfigModal(false)}
          />
          <div className="relative z-10 flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg bg-primary shadow-2xl">
            <header className="flex items-start justify-between gap-lg border-b border-secondary p-xl">
              <div className="flex items-center gap-xs font-semibold text-primary text-lg">
                <Sliders className="size-5 text-fg-brand-primary shrink-0" />
                Service Placeholders
              </div>
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="text-tertiary hover:text-primary p-xs rounded focus-visible:ring-2 focus-visible:ring-focus-ring"
                aria-label="Close dialog"
              >
                <X className="size-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-xl text-sm text-secondary flex flex-col gap-md">
              <div>
                <span className="text-tertiary text-xs block mb-xxs">Tatum API Key</span>
                <div className="bg-secondary p-sm rounded-md border border-secondary font-mono text-xs text-secondary break-all">
                  TATUM_API_KEY (Managed in environment)
                </div>
              </div>

              <div>
                <span className="text-tertiary text-xs block mb-xxs">Walrus Publisher Endpoint</span>
                <div className="bg-secondary p-sm rounded-md border border-secondary font-mono text-xs text-secondary break-all">
                  WALRUS_PUBLISHER_URL || https://publisher.walrus-testnet.walrus.space
                </div>
              </div>

              <div>
                <span className="text-tertiary text-xs block mb-xxs">Walrus Aggregator Endpoint</span>
                <div className="bg-secondary p-sm rounded-md border border-secondary font-mono text-xs text-secondary break-all">
                  WALRUS_AGGREGATOR_URL || https://aggregator.walrus-testnet.walrus.space
                </div>
              </div>

              <div>
                <span className="text-tertiary text-xs block mb-xxs">Walrus Memory Epoch</span>
                <div className="bg-secondary p-sm rounded-md border border-secondary font-mono text-xs text-secondary break-all">
                  epoch-walrus-alpha-watchdog-v1
                </div>
              </div>
            </div>

            <footer className="flex justify-end gap-sm border-t border-secondary p-xl">
              <button
                type="button"
                onClick={() => setShowConfigModal(false)}
                className="inline-flex items-center gap-sm rounded-lg border border-transparent bg-brand-solid px-lg py-sm text-sm font-semibold text-primary-on-brand shadow-xs hover:bg-brand-solid-hover focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                Done
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
