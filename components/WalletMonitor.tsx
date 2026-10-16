import React, { useEffect, useMemo, useState } from "react";
import { Language } from "../types.ts";
import {
  ActivityEvent,
  CHAINS,
  ChainId,
  Holding,
  WalletSnapshot,
  WatchedWallet,
  WatchError,
  chainById,
  isAlert,
  loadWallet,
  resolveWallet,
} from "../services/chainWatch.ts";

const STORAGE_KEY = "chainwatch.wallets.v1";
const SAMPLE = { chainId: "eth" as ChainId, input: "vitalik.eth", label: "Vitalik" };

const TEXT = {
  zh: {
    title: "链上监测",
    subtitle: "盯住公开地址的余额、转账和大额进出。名单只保存在这台浏览器里。",
    add: "加入监测",
    adding: "解析地址…",
    sample: "示例 vitalik.eth",
    address: "地址或 ENS",
    nickname: "备注",
    nicknamePlaceholder: "例如 金库",
    chain: "网络",
    threshold: "警报线（美元）",
    empty: "还没有监测地址。加入一个公开钱包，查看其余额和最近资金流。",
    invalid: "请输入 0x 地址，或带点的 ENS 名称。",
    notFound: "这条链上没有解析到该名称。",
    network: "链上数据暂时取不到，请再试一次。",
    loading: "正在读取链上数据…",
    refresh: "刷新",
    remove: "移除",
    activity: "动态",
    holdings: "持仓",
    alerts: "警报",
    noActivity: "最近没有可显示的转账。",
    noHoldings: "除了原生币，这一页没有带价格的代币。",
    holdingsPartial: "代币持仓这次没有读全，原生余额和动态仍然有效。",
    noAlerts: "最近一页动态里，没有达到警报线的转账。",
    alertNote: "警报看最近约 50 笔主币交易，以及估值至少 1 美元的代币转账。持仓只保留市值超过 100 万美元的代币。",
    in: "流入",
    out: "流出",
    self: "自转",
    balance: "原生余额",
    copy: "复制",
    copied: "已复制",
    explorer: "浏览器",
    updated: "更新于",
    watchCount: "个地址",
  },
  en: {
    title: "On-chain watch",
    subtitle: "Balances, transfers, and large moves for public addresses. The list stays in this browser.",
    add: "Watch",
    adding: "Resolving…",
    sample: "Try vitalik.eth",
    address: "Address or ENS",
    nickname: "Label",
    nicknamePlaceholder: "e.g. Treasury",
    chain: "Network",
    threshold: "Alert above (USD)",
    empty: "No wallets yet. Add a public address to see its balance and recent flow.",
    invalid: "Enter a 0x address, or an ENS name that contains a dot.",
    notFound: "That name did not resolve on this chain.",
    network: "Chain data is unavailable right now. Try again.",
    loading: "Reading chain data…",
    refresh: "Refresh",
    remove: "Remove",
    activity: "Activity",
    holdings: "Holdings",
    alerts: "Alerts",
    noActivity: "No recent transfers to show.",
    noHoldings: "No priced tokens on this page besides the native coin.",
    holdingsPartial: "Token holdings did not load. Native balance and activity are still current.",
    noAlerts: "Nothing in the latest page of activity crosses the alert line.",
    alertNote: "Alerts use the latest 50 native transactions and token transfers worth at least $1. Holdings keep tokens with a market cap above $1M.",
    in: "In",
    out: "Out",
    self: "Self",
    balance: "Native balance",
    copy: "Copy",
    copied: "Copied",
    explorer: "Explorer",
    updated: "Updated",
    watchCount: "wallets",
  },
} as const;

function loadStored(): WatchedWallet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.address === "string" && typeof item.chainId === "string" && typeof item.id === "string");
  } catch {
    return [];
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "0";
  if (amount >= 1000) return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (amount >= 1) return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function formatUsd(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount)) return "—";
  if (amount >= 1000) return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (amount >= 1) return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function formatTime(iso: string, lang: Language): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return iso;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return lang === "zh" ? "刚刚" : "just now";
  if (minutes < 60) return lang === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return lang === "zh" ? `${hours} 小时前` : `${hours}h ago`;
  return new Date(then).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function errorText(code: string, copy: (typeof TEXT)["zh"]): string {
  if (code === "invalid") return copy.invalid;
  if (code === "not_found") return copy.notFound;
  return copy.network;
}

export const WalletMonitor: React.FC<{ lang: Language }> = ({ lang }) => {
  const copy = TEXT[lang];
  useEffect(() => {
    document.title = lang === "zh" ? "链上钱包监测" : "On-chain wallet monitor";
  }, [lang]);
  const [wallets, setWallets] = useState<WatchedWallet[]>(loadStored);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chainId, setChainId] = useState<ChainId>("eth");
  const [input, setInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [draftThreshold, setDraftThreshold] = useState("1000");
  const [formError, setFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"activity" | "holdings" | "alerts">("activity");
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  }, [wallets]);

  const selected = wallets.find((wallet) => wallet.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) {
      setSnapshot(null);
      setLoadError(null);
      return;
    }
    const wallet = selected;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    loadWallet(chainById(wallet.chainId), wallet.address, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setSnapshot(next);
        if (next.ens && next.ens !== wallet.ens) {
          setWallets((current) => current.map((item) => (item.id === wallet.id ? { ...item, ens: next.ens ?? item.ens } : item)));
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSnapshot(null);
        setLoadError(error instanceof WatchError ? error.code : "network");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected?.id, selected?.address, selected?.chainId, reloadKey]);

  const alerts = useMemo(
    () => (snapshot ? snapshot.activity.filter((event) => selected && isAlert(event, selected.thresholdUsd)) : []),
    [snapshot, selected]
  );

  const addWallet = async (preset?: { chainId: ChainId; input: string; label: string }) => {
    const nextChain = preset?.chainId ?? chainId;
    const nextInput = preset?.input ?? input;
    const nextLabel = preset?.label ?? nickname.trim();
    const threshold = Number(draftThreshold);
    setFormError(null);
    setAdding(true);
    try {
      const resolved = await resolveWallet(chainById(nextChain), nextInput);
      const id = `${nextChain}:${resolved.address.toLowerCase()}`;
      const wallet: WatchedWallet = {
        id,
        chainId: nextChain,
        address: resolved.address,
        ens: resolved.ens,
        label: nextLabel || resolved.ens || shortAddress(resolved.address),
        thresholdUsd: Number.isFinite(threshold) && threshold > 0 ? threshold : 1000,
      };
      setWallets((current) => [wallet, ...current.filter((item) => item.id !== id)]);
      setSelectedId(id);
      setTab("activity");
      setInput("");
      setNickname("");
    } catch (error) {
      setFormError(error instanceof WatchError ? error.code : "network");
    } finally {
      setAdding(false);
    }
  };

  const updateThreshold = (value: string) => {
    if (!selected) return;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return;
    setWallets((current) => current.map((wallet) => (wallet.id === selected.id ? { ...wallet, thresholdUsd: amount } : wallet)));
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 pb-16">
      <aside className="lg:w-80 shrink-0 space-y-4">
        <div>
          <h2 className="text-3xl font-cinzel gold-gradient font-bold">{copy.title}</h2>
          <p className="text-sm text-gray-400 mt-3 leading-relaxed">{copy.subtitle}</p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addWallet();
          }}
          className="glass-card rounded-3xl p-5 space-y-3"
        >
          <label className="block text-[10px] uppercase tracking-widest text-gray-500">
            {copy.chain}
            <select
              value={chainId}
              onChange={(event) => setChainId(event.target.value as ChainId)}
              className="mt-2 w-full bg-slate-950 border border-white/10 rounded-2xl px-4 py-3 text-white"
            >
              {CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[10px] uppercase tracking-widest text-gray-500">
            {copy.address}
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="0x… / name.eth"
              className="mt-2 w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white outline-none focus:border-yellow-500/50"
            />
          </label>
          <label className="block text-[10px] uppercase tracking-widest text-gray-500">
            {copy.nickname}
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder={copy.nicknamePlaceholder}
              className="mt-2 w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white outline-none focus:border-yellow-500/50"
            />
          </label>
          <label className="block text-[10px] uppercase tracking-widest text-gray-500">
            {copy.threshold}
            <input
              value={draftThreshold}
              onChange={(event) => setDraftThreshold(event.target.value)}
              inputMode="decimal"
              className="mt-2 w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-white outline-none focus:border-yellow-500/50"
            />
          </label>
          {formError && <p className="text-sm text-rose-300">{errorText(formError, copy)}</p>}
          <button type="submit" disabled={adding || !input.trim()} className="w-full py-3 rounded-2xl bg-yellow-500 text-slate-950 font-bold disabled:opacity-40">
            {adding ? copy.adding : copy.add}
          </button>
          <button type="button" onClick={() => void addWallet(SAMPLE)} disabled={adding} className="w-full py-2 text-[10px] uppercase tracking-widest text-yellow-500/80">
            {copy.sample}
          </button>
        </form>

        <div className="text-[10px] uppercase tracking-widest text-gray-500">
          {wallets.length} {copy.watchCount}
        </div>
        <div className="flex lg:flex-col gap-2 overflow-x-auto">
          {wallets.map((wallet) => {
            const chain = chainById(wallet.chainId);
            const active = wallet.id === selectedId;
            return (
              <button
                key={wallet.id}
                onClick={() => {
                  setSelectedId(wallet.id);
                  setTab("activity");
                }}
                className={`min-w-56 text-left rounded-2xl border px-4 py-3 transition-all ${active ? "border-yellow-500/60 bg-yellow-500/10" : "border-white/10 bg-white/5"}`}
              >
                <div className="font-semibold text-white">{wallet.label}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {chain.name} · {wallet.ens || shortAddress(wallet.address)}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flex-1 min-w-0">
        {!selected && <div className="glass-card rounded-[2rem] p-10 text-gray-300">{copy.empty}</div>}
        {selected && (
          <div className="space-y-6">
            <div className="glass-card rounded-[2rem] p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.3em] text-yellow-500">{chainById(selected.chainId).name}</div>
                  <h3 className="text-3xl font-cinzel text-white mt-2">{selected.label}</h3>
                  <p className="text-sm text-gray-400 mt-2 font-mono">{selected.ens ? `${selected.ens} · ` : ""}{selected.address}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(selected.address);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1200);
                      } catch {
                        setCopied(false);
                      }
                    }}
                    className="px-3 py-2 rounded-full border border-white/10 text-[10px] uppercase tracking-widest text-gray-300"
                  >
                    {copied ? copy.copied : copy.copy}
                  </button>
                  <a
                    href={`${chainById(selected.chainId).explorer}/address/${selected.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-2 rounded-full border border-white/10 text-[10px] uppercase tracking-widest text-gray-300"
                  >
                    {copy.explorer}
                  </a>
                  <button onClick={() => setReloadKey((value) => value + 1)} className="px-3 py-2 rounded-full border border-yellow-500/40 text-[10px] uppercase tracking-widest text-yellow-500">
                    {copy.refresh}
                  </button>
                  <button
                    onClick={() => {
                      setWallets((current) => current.filter((wallet) => wallet.id !== selected.id));
                      setSelectedId(null);
                      setSnapshot(null);
                    }}
                    className="px-3 py-2 rounded-full border border-white/10 text-[10px] uppercase tracking-widest text-rose-300"
                  >
                    {copy.remove}
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-8">
                <div className="rounded-2xl bg-black/20 border border-white/5 p-5">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500">{copy.balance}</div>
                  <div className="text-3xl text-white mt-2">
                    {snapshot ? formatAmount(snapshot.nativeBalance) : "—"} <span className="text-lg text-yellow-500">{chainById(selected.chainId).symbol}</span>
                  </div>
                  <div className="text-gray-400 mt-1">{snapshot ? formatUsd(snapshot.nativeUsd) : ""}</div>
                </div>
                <div className="rounded-2xl bg-black/20 border border-white/5 p-5">
                  <div className="text-[10px] uppercase tracking-widest text-gray-500">{copy.threshold}</div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {[1, 100, 1000, 10000].map((amount) => (
                      <button
                        key={amount}
                        onClick={() => updateThreshold(String(amount))}
                        className={`px-3 py-1.5 rounded-full text-xs border ${selected.thresholdUsd === amount ? "bg-yellow-500 text-slate-950 border-yellow-500" : "border-white/10 text-gray-300"}`}
                      >
                        ${amount.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-3">{copy.alertNote}</p>
                </div>
              </div>
              {snapshot && (
                <p className="text-[10px] uppercase tracking-widest text-gray-600 mt-4">
                  {copy.updated} {new Date(snapshot.fetchedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US")}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              {([
                ["activity", copy.activity, snapshot?.activity.length ?? 0],
                ["holdings", copy.holdings, snapshot?.holdings.length ?? 0],
                ["alerts", copy.alerts, alerts.length],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2 rounded-full text-xs uppercase tracking-widest border ${tab === key ? "bg-yellow-500 text-slate-950 border-yellow-500" : "border-white/10 text-gray-400"}`}
                >
                  {label} {count}
                </button>
              ))}
            </div>

            {loading && <p className="text-yellow-500/80">{copy.loading}</p>}
            {loadError && <p className="text-rose-300">{errorText(loadError, copy)}</p>}

            {snapshot && tab === "activity" && <ActivityList events={snapshot.activity} threshold={selected.thresholdUsd} lang={lang} copy={copy} chainExplorer={chainById(selected.chainId).explorer} />}
            {snapshot && tab === "holdings" && (
              <div className="space-y-3">
                {snapshot.holdingsUnavailable && <p className="text-sm text-amber-200">{copy.holdingsPartial}</p>}
                {snapshot.holdings.length <= 1 && !snapshot.holdings[0]?.amount ? (
                  <p className="text-gray-400">{copy.noHoldings}</p>
                ) : (
                  snapshot.holdings.map((holding) => <HoldingRow key={holding.id} holding={holding} />)
                )}
              </div>
            )}
            {snapshot && tab === "alerts" && (
              alerts.length === 0 ? <p className="text-gray-400">{copy.noAlerts}</p> : <ActivityList events={alerts} threshold={selected.thresholdUsd} lang={lang} copy={copy} chainExplorer={chainById(selected.chainId).explorer} />
            )}
          </div>
        )}
      </section>
    </div>
  );
};

const HoldingRow: React.FC<{ holding: Holding }> = ({ holding }) => {
  return (
    <div className="glass-card rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
      <div>
        <div className="text-white font-semibold">{holding.symbol}</div>
        <div className="text-xs text-gray-500">{holding.name}</div>
      </div>
      <div className="text-right">
        <div className="text-white">{formatAmount(holding.amount)}</div>
        <div className="text-xs text-yellow-500/80">{formatUsd(holding.usd)}</div>
      </div>
    </div>
  );
};

function ActivityList({
  events,
  threshold,
  lang,
  copy,
  chainExplorer,
}: {
  events: ActivityEvent[];
  threshold: number;
  lang: Language;
  copy: (typeof TEXT)["zh"];
  chainExplorer: string;
}) {
  if (events.length === 0) return <p className="text-gray-400">{copy.noActivity}</p>;
  return (
    <div className="space-y-3">
      {events.map((event) => {
        const alert = isAlert(event, threshold);
        const direction = event.direction === "in" ? copy.in : event.direction === "out" ? copy.out : copy.self;
        return (
          <a
            key={event.id}
            href={`${chainExplorer}/tx/${event.hash}`}
            target="_blank"
            rel="noreferrer"
            className={`block glass-card rounded-2xl px-5 py-4 border ${alert ? "border-yellow-500/50" : "border-transparent"}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] uppercase tracking-widest ${event.direction === "in" ? "text-emerald-300" : event.direction === "out" ? "text-rose-300" : "text-gray-400"}`}>{direction}</span>
                  {alert && <span className="text-[10px] uppercase tracking-widest text-yellow-500">{copy.alerts}</span>}
                </div>
                <div className="text-white mt-1">
                  {formatAmount(event.amount)} {event.asset}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {event.counterpartyName || (event.counterparty ? shortAddress(event.counterparty) : "—")} · {event.kind}
                </div>
              </div>
              <div className="text-right">
                <div className="text-yellow-500/90">{formatUsd(event.usd)}</div>
                <div className="text-[10px] text-gray-500 mt-1">{formatTime(event.timestamp, lang)}</div>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
