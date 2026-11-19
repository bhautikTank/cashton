"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building2,
  Smartphone,
  RefreshCw,
  ShieldCheck,
  CreditCard,
} from "lucide-react";

interface WalletSummary {
  totalTracked: string;
  pendingCashback: string;
  approvedCashback: string;
  confirmedCashback: string;
  availableBalance: string;
  totalPaidOut: string;
  currency: string;
  recentTransactions: Array<{
    id: string;
    amount: string;
    type: "CREDIT" | "DEBIT" | "REVERSAL" | "ADJUSTMENT";
    category: "CASHBACK" | "PAYOUT" | "ADMIN_ADJUSTMENT" | "BONUS";
    description: string;
    createdAt: string;
  }>;
}

interface PayoutDetails {
  id: string;
  payoutMethod: "BANK" | "UPI";
  accountHolderName: string | null;
  accountNumberMasked: string | null;
  accountNumberLast4: string | null;
  ifscCode: string | null;
  bankName: string | null;
  upiId: string | null;
  status: "PENDING" | "VERIFIED" | "REJECTED";
}

interface UserProfile {
  name: string | null;
  email: string;
  mobileNumber: string | null;
  role: string;
}

export default function DashboardPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [payout, setPayout] = useState<PayoutDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Payout form state
  const [payoutMethod, setPayoutMethod] = useState<"BANK" | "UPI">("UPI");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [bankName, setBankName] = useState("");
  const [upiId, setUpiId] = useState("");
  const [formSaving, setFormSaving] = useState(false);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/users/profile")
      .then((res) => {
        if (!res.ok) {
          if (res.status === 401) {
            throw new Error("You must be logged in to view your wallet dashboard.");
          }
          throw new Error("Failed to load user profile");
        }
        return res.json();
      })
      .then((data) => {
        if (isMounted) setProfile(data.profile);
      })
      .catch((err: Error) => {
        if (isMounted) setError(err.message);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    fetch("/api/wallet/summary")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.summary) setSummary(data.summary);
      })
      .catch(() => {});

    fetch("/api/users/payout-details")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data?.payoutDetails) {
          setPayout(data.payoutDetails);
          setPayoutMethod(data.payoutDetails.payoutMethod);
          setAccountHolderName(data.payoutDetails.accountHolderName || "");
          setIfscCode(data.payoutDetails.ifscCode || "");
          setBankName(data.payoutDetails.bankName || "");
          setUpiId(data.payoutDetails.upiId || "");
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [refreshTrigger]);

  const handleSavePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    setFormSuccess(null);
    setFormError(null);

    const payload =
      payoutMethod === "BANK"
        ? {
            payoutMethod: "BANK",
            accountHolderName: accountHolderName.trim(),
            accountNumber: accountNumber.trim() || undefined,
            ifscCode: ifscCode.trim().toUpperCase(),
            bankName: bankName.trim() || undefined,
          }
        : {
            payoutMethod: "UPI",
            upiId: upiId.trim().toLowerCase(),
          };

    try {
      const res = await fetch("/api/users/payout-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data.errors
          ? Object.values(data.errors).flat().join(", ")
          : data.message || "Failed to save payout details";
        throw new Error(msg);
      }

      setPayout(data.payoutDetails);
      setAccountNumber(""); // Clear raw account number from memory
      setFormSuccess("Payout details updated successfully! Verification status: PENDING.");
    } catch (err: unknown) {
      setFormError((err as Error).message || "An error occurred");
    } finally {
      setFormSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 md:p-12 font-sans">
        <div className="max-w-6xl mx-auto space-y-8 animate-pulse">
          <div className="h-10 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="h-32 bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>
            <div className="h-32 bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>
            <div className="h-32 bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>
          </div>
          <div className="h-64 bg-zinc-200 dark:bg-zinc-800 rounded-xl"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-6">
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-8 rounded-2xl shadow-sm text-center max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Access Notice</h2>
          <p className="text-zinc-600 dark:text-zinc-400 mb-6">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              setRefreshTrigger((prev) => prev + 1);
            }}
            className="px-5 py-2.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 rounded-xl font-medium hover:opacity-90 transition"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-4 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-widest font-semibold px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-full">
                CashTon Wallet
              </span>
              {profile?.role === "ADMIN" && (
                <span className="text-xs uppercase tracking-widest font-semibold px-2 py-0.5 bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 rounded-full">
                  Admin
                </span>
              )}
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold mt-2 tracking-tight">
              Welcome back, {profile?.name || "Member"}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {profile?.email} • {profile?.mobileNumber || "Mobile unlinked"}
            </p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              setRefreshTrigger((prev) => prev + 1);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-zinc-300 dark:border-zinc-700 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition shadow-sm w-fit"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Balances
          </button>
        </div>

        {/* Top Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Main Available Balance */}
          <div className="bg-gradient-to-br from-emerald-500 to-teal-700 text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
            <div className="absolute right-3 top-3 opacity-15">
              <Wallet className="w-24 h-24" />
            </div>
            <div className="relative z-10">
              <div className="text-emerald-100 text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-200" />
                Available to Withdraw
              </div>
              <div className="text-3xl md:text-4xl font-extrabold tracking-tight mt-2">
                ₹{summary?.availableBalance || "0.00"}
              </div>
              <p className="text-xs text-emerald-100/90 mt-2">
                Confirmed cashback ready for disbursement.
              </p>
            </div>
          </div>

          {/* Pending Cashback */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-2xl shadow-sm">
            <div className="text-zinc-500 dark:text-zinc-400 text-sm font-medium flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Verification
            </div>
            <div className="text-2xl md:text-3xl font-bold tracking-tight text-amber-600 dark:text-amber-400 mt-2">
              ₹{summary?.pendingCashback || "0.00"}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Awaiting merchant confirmation window.
            </p>
          </div>

          {/* Total Cashback Tracked */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-6 rounded-2xl shadow-sm">
            <div className="text-zinc-500 dark:text-zinc-400 text-sm font-medium flex items-center gap-1.5">
              <ArrowDownLeft className="w-4 h-4 text-blue-500" />
              Total Cashback Tracked
            </div>
            <div className="text-2xl md:text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mt-2">
              ₹{summary?.totalTracked || "0.00"}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Lifetime cashback earned across all stores.
            </p>
          </div>
        </div>

        {/* Secondary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl flex justify-between items-center">
            <span className="text-zinc-500">Approved Cashback:</span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">
              ₹{summary?.approvedCashback || "0.00"}
            </span>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl flex justify-between items-center">
            <span className="text-zinc-500">Confirmed Cashback:</span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              ₹{summary?.confirmedCashback || "0.00"}
            </span>
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 rounded-xl flex justify-between items-center">
            <span className="text-zinc-500">Total Paid Out:</span>
            <span className="font-semibold text-purple-600 dark:text-purple-400">
              ₹{summary?.totalPaidOut || "0.00"}
            </span>
          </div>
        </div>

        {/* Ledger & Payout Details Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Wallet Transactions */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-500" />
                Recent Wallet Transactions
              </h2>
              <span className="text-xs text-zinc-400 font-medium">Append-only Ledger</span>
            </div>

            {!summary?.recentTransactions || summary.recentTransactions.length === 0 ? (
              <div className="border border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-10 text-center text-zinc-400 space-y-2">
                <Wallet className="w-10 h-10 mx-auto text-zinc-300 dark:text-zinc-700" />
                <p className="font-medium">No transactions recorded yet.</p>
                <p className="text-xs text-zinc-500">
                  When you shop via our merchant links, your earned cashback credits will appear here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-y-zinc-800 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-400 uppercase tracking-wider">
                      <th className="py-2.5">Date</th>
                      <th className="py-2.5">Description</th>
                      <th className="py-2.5">Type</th>
                      <th className="py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {summary.recentTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition">
                        <td className="py-3 text-zinc-500 text-xs whitespace-nowrap">
                          {new Date(tx.createdAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="py-3 font-medium text-zinc-800 dark:text-zinc-200">
                          {tx.description}
                          <span className="block text-xs text-zinc-400 capitalize">
                            {tx.category.toLowerCase().replace("_", " ")}
                          </span>
                        </td>
                        <td className="py-3">
                          <span
                            className={`inline-flex items-center text-xs px-2 py-0.5 rounded font-medium ${
                              tx.type === "CREDIT"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td
                          className={`py-3 text-right font-semibold whitespace-nowrap ${
                            tx.type === "CREDIT"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {tx.type === "CREDIT" ? "+" : "-"}₹{tx.amount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Payout Details Panel */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-6">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  Payout Details
                </h2>
                {payout && (
                  <span
                    className={`text-xs uppercase font-semibold px-2 py-0.5 rounded-full ${
                      payout.status === "VERIFIED"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : payout.status === "REJECTED"
                        ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {payout.status}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                Withdrawals are transferred directly to your bank account or UPI ID.
              </p>
            </div>

            {/* Current saved status banner */}
            {payout?.accountNumberMasked && (
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs space-y-1">
                <div className="font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-zinc-500" />
                  Linked Bank Account
                </div>
                <div className="text-zinc-600 dark:text-zinc-300">
                  A/C: <span className="font-mono">{payout.accountNumberMasked}</span>
                </div>
                <div className="text-zinc-500">
                  Holder: {payout.accountHolderName} • IFSC: {payout.ifscCode}
                </div>
              </div>
            )}

            {payout?.upiId && (
              <div className="p-3 bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 rounded-xl text-xs space-y-1">
                <div className="font-semibold text-zinc-700 dark:text-zinc-200 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-zinc-500" />
                  Linked UPI ID
                </div>
                <div className="text-zinc-600 dark:text-zinc-300 font-mono">
                  {payout.upiId}
                </div>
              </div>
            )}

            {/* Payout Form */}
            <form onSubmit={handleSavePayout} className="space-y-4 text-sm">
              <div className="flex rounded-xl bg-zinc-100 dark:bg-zinc-800 p-1">
                <button
                  type="button"
                  onClick={() => setPayoutMethod("UPI")}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                    payoutMethod === "UPI"
                      ? "bg-white dark:bg-zinc-900 shadow-sm text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  UPI (Fastest)
                </button>
                <button
                  type="button"
                  onClick={() => setPayoutMethod("BANK")}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition ${
                    payoutMethod === "BANK"
                      ? "bg-white dark:bg-zinc-900 shadow-sm text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  Bank Transfer
                </button>
              </div>

              {payoutMethod === "UPI" ? (
                <div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                    UPI ID (VPA)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. mobile@upi or username@okhdfcbank"
                    value={upiId}
                    onChange={(e) => setUpiId(e.target.value)}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Account Holder Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="As per bank passbook"
                      value={accountHolderName}
                      onChange={(e) => setAccountHolderName(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Account Number {payout?.accountNumberMasked && "(Leave blank to keep current)"}
                    </label>
                    <input
                      type="password"
                      placeholder={payout?.accountNumberMasked || "Enter 9-18 digit account number"}
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      IFSC Code
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. HDFC0001234"
                      value={ifscCode}
                      onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1">
                      Bank Name (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. HDFC Bank"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-transparent focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
                    />
                  </div>
                </div>
              )}

              {formSuccess && (
                <div className="p-2.5 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-xs rounded-lg border border-emerald-200 dark:border-emerald-900">
                  {formSuccess}
                </div>
              )}

              {formError && (
                <div className="p-2.5 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300 text-xs rounded-lg border border-red-200 dark:border-red-900">
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={formSaving}
                className="w-full py-2.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 font-semibold rounded-xl hover:opacity-90 transition disabled:opacity-50 text-sm"
              >
                {formSaving ? "Saving Encrypted Details..." : "Save Payout Details"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
