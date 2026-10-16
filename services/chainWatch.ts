export type ChainId = "eth" | "op" | "gnosis" | "zksync" | "scroll" | "celo";

export interface Chain {
  id: ChainId;
  name: string;
  symbol: string;
  api: string;
  explorer: string;
}

export const CHAINS: Chain[] = [
  { id: "eth", name: "Ethereum", symbol: "ETH", api: "https://eth.blockscout.com/api/v2", explorer: "https://eth.blockscout.com" },
  { id: "op", name: "Optimism", symbol: "ETH", api: "https://explorer.optimism.io/api/v2", explorer: "https://explorer.optimism.io" },
  { id: "gnosis", name: "Gnosis", symbol: "xDAI", api: "https://gnosisscan.io/api/v2", explorer: "https://gnosisscan.io" },
  { id: "zksync", name: "zkSync", symbol: "ETH", api: "https://zksync.blockscout.com/api/v2", explorer: "https://zksync.blockscout.com" },
  { id: "scroll", name: "Scroll", symbol: "ETH", api: "https://scrollscan.com/api/v2", explorer: "https://scrollscan.com" },
  { id: "celo", name: "Celo", symbol: "CELO", api: "https://celo.blockscout.com/api/v2", explorer: "https://celo.blockscout.com" },
];

export function chainById(id: string): Chain {
  return CHAINS.find((chain) => chain.id === id) ?? CHAINS[0];
}

export class WatchError extends Error {
  code: "invalid" | "not_found" | "network";

  constructor(code: "invalid" | "not_found" | "network") {
    super(code);
    this.code = code;
  }
}

export interface WatchedWallet {
  id: string;
  chainId: ChainId;
  address: string;
  ens?: string;
  label: string;
  thresholdUsd: number;
}

export interface ActivityEvent {
  id: string;
  hash: string;
  timestamp: string;
  direction: "in" | "out" | "self";
  asset: string;
  amount: number;
  usd: number | null;
  counterparty: string;
  counterpartyName: string | null;
  kind: string;
}

export interface Holding {
  id: string;
  symbol: string;
  name: string;
  amount: number;
  usd: number | null;
}

export interface WalletSnapshot {
  ens: string | null;
  nativeSymbol: string;
  nativeBalance: number;
  nativeUsd: number | null;
  activity: ActivityEvent[];
  holdings: Holding[];
  holdingsUnavailable: boolean;
  fetchedAt: number;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function rawToAmount(raw: string, decimals: number): number {
  if (!/^-?\d+$/.test(raw)) return 0;
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  const places = Number.isFinite(decimals) && decimals > 0 ? Math.floor(decimals) : 0;
  const padded = digits.padStart(places + 1, "0");
  const whole = padded.slice(0, padded.length - places);
  const fraction = padded.slice(padded.length - places, padded.length - places + 8);
  const value = Number(fraction ? `${whole}.${fraction}` : whole);
  if (!Number.isFinite(value)) return 0;
  return negative ? -value : value;
}

export function isAlert(event: ActivityEvent, thresholdUsd: number): boolean {
  return thresholdUsd > 0 && event.usd !== null && event.usd >= thresholdUsd;
}

function sameAddress(left?: string | null, right?: string | null): boolean {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function directionOf(watched: string, from?: string | null, to?: string | null): ActivityEvent["direction"] {
  const sent = sameAddress(from, watched);
  const received = sameAddress(to, watched);
  if (sent && received) return "self";
  if (sent) return "out";
  return "in";
}

function partyName(party: AddressParty | null | undefined): string | null {
  if (!party) return null;
  return party.ens_domain_name || party.public_tag || party.name || null;
}

function rateOf(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

interface AddressParty {
  hash?: string;
  name?: string | null;
  ens_domain_name?: string | null;
  public_tag?: string | null;
}

interface TxItem {
  hash?: string;
  timestamp?: string;
  value?: string;
  exchange_rate?: string | null;
  method?: string | null;
  from?: AddressParty | null;
  to?: AddressParty | null;
}

interface TokenTransferItem {
  transaction_hash?: string;
  log_index?: number;
  timestamp?: string;
  type?: string;
  from?: AddressParty | null;
  to?: AddressParty | null;
  total?: { value?: string; decimals?: string | number } | string | null;
  token?: {
    symbol?: string | null;
    decimals?: string | number | null;
    exchange_rate?: string | null;
    reputation?: string | null;
  } | null;
}

interface TokenBalanceItem {
  value?: string;
  token?: {
    address_hash?: string;
    name?: string | null;
    symbol?: string | null;
    decimals?: string | number | null;
    exchange_rate?: string | null;
    reputation?: string | null;
    circulating_market_cap?: string | null;
  } | null;
}

export function buildActivity(watched: string, nativeSymbol: string, transactions: TxItem[], transfers: TokenTransferItem[]): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  for (const tx of transactions) {
    if (!tx.hash || !tx.timestamp) continue;
    const amount = rawToAmount(String(tx.value ?? "0"), 18);
    if (amount <= 0) continue;
    const rate = rateOf(tx.exchange_rate);
    const from = tx.from?.hash ?? "";
    const to = tx.to?.hash ?? "";
    const direction = directionOf(watched, from, to);
    const counterparty = direction === "out" ? to : from;
    events.push({
      id: `native:${tx.hash}`,
      hash: tx.hash,
      timestamp: tx.timestamp,
      direction,
      asset: nativeSymbol,
      amount,
      usd: rate === null ? null : amount * rate,
      counterparty,
      counterpartyName: partyName(direction === "out" ? tx.to : tx.from),
      kind: tx.method || "transfer",
    });
  }

  for (const transfer of transfers) {
    const hash = transfer.transaction_hash;
    if (!hash || !transfer.timestamp) continue;
    if (transfer.token?.reputation === "scam") continue;
    const decimals = Number(
      (typeof transfer.total === "object" && transfer.total?.decimals) || transfer.token?.decimals || 18
    );
    const raw = typeof transfer.total === "object" ? transfer.total?.value : transfer.total;
    const amount = rawToAmount(String(raw ?? "0"), decimals);
    if (amount <= 0) continue;
    const rate = rateOf(transfer.token?.exchange_rate);
    const usd = rate === null ? null : amount * rate;
    if (transfer.token?.reputation !== "ok" || usd === null || usd < 1) continue;
    const from = transfer.from?.hash ?? "";
    const to = transfer.to?.hash ?? "";
    const direction = directionOf(watched, from, to);
    const counterparty = direction === "out" ? to : from;
    events.push({
      id: `token:${hash}:${transfer.log_index ?? events.length}`,
      hash,
      timestamp: transfer.timestamp,
      direction,
      asset: transfer.token?.symbol || "TOKEN",
      amount,
      usd,
      counterparty,
      counterpartyName: partyName(direction === "out" ? transfer.to : transfer.from),
      kind: (transfer.type || "token_transfer").replace("token_", ""),
    });
  }

  events.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  return events;
}

export function buildHoldings(nativeSymbol: string, nativeBalance: number, nativeUsd: number | null, tokens: TokenBalanceItem[]): Holding[] {
  const rows: Holding[] = [
    {
      id: "native",
      symbol: nativeSymbol,
      name: nativeSymbol,
      amount: nativeBalance,
      usd: nativeUsd,
    },
  ];

  for (const item of tokens) {
    const token = item.token;
    if (!token || token.reputation === "scam") continue;
    const amount = rawToAmount(String(item.value ?? "0"), Number(token.decimals ?? 18));
    const rate = rateOf(token.exchange_rate);
    const marketCap = Number(token.circulating_market_cap);
    const usd = rate === null ? null : amount * rate;
    if (amount <= 0 || usd === null || usd < 0.5 || usd > 1e12) continue;
    if (!Number.isFinite(marketCap) || marketCap < 1_000_000) continue;
    rows.push({
      id: token.address_hash || `${token.symbol}-${rows.length}`,
      symbol: token.symbol || "TOKEN",
      name: token.name || token.symbol || "Token",
      amount,
      usd,
    });
  }

  const [native, ...rest] = rows;
  rest.sort((left, right) => (right.usd ?? 0) - (left.usd ?? 0));
  return [native, ...rest.slice(0, 8)];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new WatchError("network");
  }
  if (!response.ok) throw new WatchError("network");
  return response.json() as Promise<T>;
}

export async function resolveWallet(chain: Chain, input: string, signal?: AbortSignal): Promise<{ address: string; ens?: string }> {
  const query = input.trim();
  if (ADDRESS_RE.test(query)) return { address: query };
  if (!query.includes(".")) throw new WatchError("invalid");

  const data = await getJson<{ items?: { address_hash?: string; ens_info?: { name?: string } | null }[] }>(
    `${chain.api}/search?q=${encodeURIComponent(query)}`,
    signal
  );
  const items = data.items ?? [];
  const exact = items.find((item) => item.ens_info?.name?.toLowerCase() === query.toLowerCase() && ADDRESS_RE.test(item.address_hash ?? ""));
  const fallback = items.find((item) => ADDRESS_RE.test(item.address_hash ?? "") && item.ens_info);
  const match = exact ?? fallback;
  if (!match?.address_hash) throw new WatchError("not_found");
  return { address: match.address_hash, ens: match.ens_info?.name };
}

export async function loadWallet(chain: Chain, address: string, signal?: AbortSignal): Promise<WalletSnapshot> {
  const base = `${chain.api}/addresses/${address}`;
  const [info, txPage, transferPage] = await Promise.all([
    getJson<{ ens_domain_name?: string | null; coin_balance?: string | null; exchange_rate?: string | null }>(base, signal),
    getJson<{ items?: TxItem[] }>(`${base}/transactions`, signal),
    getJson<{ items?: TokenTransferItem[] }>(`${base}/token-transfers?type=ERC-20`, signal),
  ]);

  let tokens: TokenBalanceItem[] = [];
  let holdingsUnavailable = false;
  try {
    const tokenPage = await getJson<{ items?: TokenBalanceItem[] }>(`${base}/tokens?type=ERC-20`, signal);
    tokens = tokenPage.items ?? [];
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    holdingsUnavailable = true;
  }

  const nativeBalance = rawToAmount(String(info.coin_balance ?? "0"), 18);
  const nativeRate = rateOf(info.exchange_rate);
  const nativeUsd = nativeRate === null ? null : nativeBalance * nativeRate;

  return {
    ens: info.ens_domain_name ?? null,
    nativeSymbol: chain.symbol,
    nativeBalance,
    nativeUsd,
    activity: buildActivity(address, chain.symbol, txPage.items ?? [], transferPage.items ?? []),
    holdings: buildHoldings(chain.symbol, nativeBalance, nativeUsd, tokens),
    holdingsUnavailable,
    fetchedAt: Date.now(),
  };
}
