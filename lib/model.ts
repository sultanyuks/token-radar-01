// Launch Radar model (radar-5, "peer band + auditable peers, risk flags"): one sealed snapshot
// in, one ranked board out.
//
// THE MODEL. The snapshot itself says what a launched token is worth: many of its protocols
// already trade, and each carries both a TVL and a market cap. For every category we take the
// distribution of market-cap/TVL ratios among that category's trading protocols — its 25th
// percentile, median and 75th percentile — each shrunk toward the same global percentile by a
// geometric blend weighted peers/(peers+SHRINK_PEERS), so a category with two observations
// cannot shout down one with forty. A pre-token protocol's implied launch value is then
//
//   implied = TVL x category median multiple x momentum factor x seasoning factor
//   range   = TVL x category quartile multiple x momentum factor x seasoning factor
//
// so every row carries not just a price but the band its own category's trading peers span:
// the middle half of what tokens in that line of business actually fetched per dollar of TVL.
//
//   momentum factor  gains and losses are not symmetric evidence. A doubling of TVL in a week
//                    is often rented (an incentive can buy it), while a halving is rarely faked,
//                    so gains pass through at GAIN_WEIGHT and losses at LOSS_WEIGHT:
//                      change >= 0: 1 + 0.50 x min(change, +100)/100    (at most 1.50)
//                      change <  0: 1 + 0.90 x max(change,  -50)/100    (at least 0.55)
//                    An unreported change is not a zero: the factor is 1 and the row is flagged
//                    "7d unreported" wherever it is shown.
//   seasoning factor = 0.80 + 0.45 x sqrt(min(age_days, 1460)/1460). Concave on purpose: the
//                    premium for accrued, unpriced activity arrives early — a protocol's second
//                    tokenless year says less than its first. An unrecorded listing date is
//                    priced at the median age of the ranked protocols whose dates are recorded,
//                    never at a round number this file invents.
//
// Two reader's instruments ride on the same price, both computed from the same record:
//   farm efficiency  implied value per $1 of the farm capital the row's own plan commits
//                    (capitalFor below: $50 to $500 by the protocol's TVL tier). The board's
//                    job is to say where a farming dollar works hardest, and the raw ranking
//                    cannot: a giant's plan commits $500 against its implied value while a
//                    small protocol's commits $50, so the small one can stand behind more
//                    implied value per farm dollar. The figure is always shown beside the
//                    capital it divides by and the evidence grade behind the price — per-$
//                    efficiency on thin evidence is a lead, not a conclusion.
//   sensitivity      implied value is linear in the peer multiple (the other two factors are
//                    the protocol's own record, not the market's mood), so each row states
//                    the multiple at which its price halves and the one at which it doubles,
//                    and whether its own category band already crosses either line. That is
//                    "what the market must believe", in the market's own units.
//
// Two reader's safeguards ride on the same record, both computed from snapshot fields only:
//   auditable peers  the band is a claim about a list, so the dashboard carries the list: every
//                    category's trading peers by name, with the market cap, TVL and ratio each
//                    contributes, sorted by ratio — the exact set the quartiles are computed
//                    from, shrinkage aside. A reader who doubts a multiple can recount it.
//   risk flags       four explicit cautions a row can carry, each with a stated trigger:
//                    thin evidence (its category band rests on 1–3 trading peers, or on none —
//                    the global band), single chain (all of its TVL sits on one chain), young
//                    (a recorded listing date under 180 days ago) and 7d unreported (no 7-day
//                    change in the record, so momentum is neutral by construction, not by
//                    observation). Flags never move a price; they say how far to trust it.
//
// No protocol name is ever special-cased: the same function scores every row, and every multiple
// is recomputed from the snapshot at run time, so the same program re-run on a future snapshot
// finds future launches early. A protocol is pre-token when its record carries no token (no
// market cap, no CoinGecko id, no symbol); trading protocols are set apart in the live list with
// the market's own values, never mixed into the ranked board. The board ranks every rankable
// pre-token protocol in the snapshot: the watchlist's are flagged, not favoured — rank is the
// model's claim alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-5 peer-band, auditable peers & risk flags';

/** Shrinkage strength: a category percentile is blended toward the global one as if the global
 *  figure were SHRINK_PEERS extra observations of the category. */
export const SHRINK_PEERS = 8;
/** How much of a clamped 7-day TVL gain the momentum factor passes through. */
export const GAIN_WEIGHT = 0.5;
/** How much of a clamped 7-day TVL loss passes through: losses are the stronger evidence. */
export const LOSS_WEIGHT = 0.9;
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
/** Seasoning: factor runs SEASONING_BASE .. SEASONING_BASE+SEASONING_RANGE over SEASONING_DAYS,
 *  on a square-root curve, so the premium for time tokenless accrues early, not late. */
export const SEASONING_BASE = 0.8;
export const SEASONING_RANGE = 0.45;
export const SEASONING_DAYS = 1460;
/** Age assumed when neither the protocol nor any ranked peer records a listing date. */
export const UNKNOWN_AGE_DAYS = 730;
/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;

/** A whole day count from listed_at to as_of, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The q-quantile of an already-sorted non-empty list, linear interpolation between neighbours. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** The median of a non-empty numeric list. */
export function median(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  return quantileSorted(v, 0.5);
}

/** A category's peer band: the shrunk quartiles of its trading protocols' mcap/TVL ratios. */
export interface CategoryBand {
  category: string;
  /** Trading protocols of this category carrying both a market cap and a TVL. */
  peers: number;
  /** The shrunk 25th percentile: the band's low multiple. */
  low: number;
  /** The shrunk median: the multiple a launch in this category is priced at. */
  multiple: number;
  /** The shrunk 75th percentile: the band's high multiple. */
  high: number;
}

/** One trading protocol behind a category's band: the evidence a reader can recount. */
export interface PeerEntry {
  slug: string;
  name: string;
  /** Its own market cap / TVL, the ratio it contributes to its category's quartiles. */
  multiple: number;
  tvl_usd: number;
  mcap_usd: number;
}

export interface Bands {
  global: CategoryBand;
  pairs: number;
  byCategory: Map<string, CategoryBand>;
  /** The peer list behind each category's band, sorted by ratio ascending. */
  peerLists: Map<string, PeerEntry[]>;
}

/** Blend one percentile geometrically toward the global one, weight peers/(peers+SHRINK_PEERS). */
function shrink(own: number, global: number, peers: number): number {
  const w = peers / (peers + SHRINK_PEERS);
  return Math.exp(w * Math.log(own) + (1 - w) * Math.log(global));
}

/**
 * The peer bands, calibrated from the snapshot alone: every trading protocol with both a market
 * cap and a TVL contributes its ratio; a category's band is its own quartiles blended
 * geometrically toward the global quartiles — a category with many trading peers keeps most of
 * its own spread, a thin one leans on the market's.
 */
export function calibrate(protocols: SnapshotProtocol[]): Bands {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  const peerLists = new Map<string, PeerEntry[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    ratios.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [r]);
    else list.push(r);
    const entry: PeerEntry = { slug: p.slug, name: p.name, multiple: round4(r), tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd };
    const peers = peerLists.get(key);
    if (peers === undefined) peerLists.set(key, [entry]);
    else peers.push(entry);
  }
  for (const peers of peerLists.values()) peers.sort((a, b) => a.multiple - b.multiple || (a.slug < b.slug ? -1 : 1));
  const all = [...ratios].sort((x, y) => x - y);
  const g = {
    low: all.length > 0 ? quantileSorted(all, 0.25) : 0.1,
    mid: all.length > 0 ? quantileSorted(all, 0.5) : 0.2,
    high: all.length > 0 ? quantileSorted(all, 0.75) : 0.4,
  };
  const global: CategoryBand = { category: 'All categories', peers: ratios.length, low: g.low, multiple: g.mid, high: g.high };
  const byCategory = new Map<string, CategoryBand>();
  for (const [category, list] of perCategory) {
    const s = [...list].sort((x, y) => x - y);
    byCategory.set(category, {
      category,
      peers: list.length,
      low: shrink(quantileSorted(s, 0.25), g.low, list.length),
      multiple: shrink(quantileSorted(s, 0.5), g.mid, list.length),
      high: shrink(quantileSorted(s, 0.75), g.high, list.length),
    });
  }
  return { global, pairs: ratios.length, byCategory, peerLists };
}

/** A recorded listing date younger than this many days earns the young risk flag. */
export const YOUNG_AGE_DAYS = 180;

/**
 * The risk flags a row can carry, each computed from snapshot fields alone and each with a
 * stated trigger (see riskFlagsFor). Flags never move a price: they say how far to trust it,
 * and the dashboard defines every one of them in its method section.
 */
export type RiskFlag = 'thin-evidence' | 'global-band' | 'single-chain' | 'young' | 'unreported-7d';

/** How much trading evidence stands behind a row's band, in words the dashboard can show. */
export type Confidence = 'deep' | 'solid' | 'thin' | 'global';

export function confidenceFor(peers: number): Confidence {
  if (peers >= 10) return 'deep';
  if (peers >= 4) return 'solid';
  if (peers >= 1) return 'thin';
  return 'global';
}

/**
 * One protocol's risk flags, in display order: the evidence caution first, then the record's
 * own shape. Every trigger reads the snapshot and nothing else — the peer count behind the
 * band, the chain list, the recorded listing date, the presence of a 7-day change.
 */
export function riskFlagsFor(p: SnapshotProtocol, confidence: Confidence, age: number | null, changeReported: boolean): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (confidence === 'thin') flags.push('thin-evidence');
  if (confidence === 'global') flags.push('global-band');
  if (p.chains.length === 1) flags.push('single-chain');
  if (age !== null && age < YOUNG_AGE_DAYS) flags.push('young');
  if (!changeReported) flags.push('unreported-7d');
  return flags;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking is a product of another asset. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** Exchange names: a protocol whose name begins with one is that exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: it records no token, and it is not a wrapped,
 * staked or bridged product of a token that already trades. The snapshot carries no parent
 * protocol field, so the product test uses the watchlist rule's own field-level checks —
 * category, version marker, product words and exchange prefixes. This is what keeps WBTC,
 * Binance staked ETH and USDT0 off the board: each records no token of its own in the file,
 * yet each is a trading token in a wrapper, not a launch still to come.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_NAME.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface Scored {
  implied: number;
  impliedLow: number;
  impliedHigh: number;
  multiple: number;
  bandLow: number;
  bandHigh: number;
  peers: number;
  confidence: Confidence;
  growthPct: number;
  growthMult: number;
  changeReported: boolean;
  seasoningMult: number;
  age: number | null;
  ageAssumed: boolean;
  /** The farm capital this row's own plan commits, from its TVL tier (capitalFor below). */
  farmCapital: number;
  /** Implied launch value standing behind each $1 of that farm capital. */
  impliedPerDollar: number;
  /** The peer multiple at which this row's implied value halves: half the pricing multiple. */
  halfMultiple: number;
  /** The peer multiple at which this row's implied value doubles: twice the pricing multiple. */
  doubleMultiple: number;
  /** The risk flags this row carries (riskFlagsFor): cautions, never price inputs. */
  riskFlags: RiskFlag[];
}

/**
 * One protocol's implied launch value, its peer band and the full breakdown behind both.
 * ageFallback is the age an unrecorded listing date is priced at: the median recorded age of
 * the ranked set, computed by buildBoard from the same snapshot.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string, bands: Bands, ageFallback: number): Scored {
  const age = ageDays(asOf, p.listed_at);
  const band = bands.byCategory.get(p.category ?? 'Uncategorised') ?? bands.global;
  const reported = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d);
  const raw = reported ? p.change_7d! : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw));
  const growthMult = !reported ? 1 : growthPct >= 0 ? 1 + GAIN_WEIGHT * (growthPct / 100) : 1 + LOSS_WEIGHT * (growthPct / 100);
  const ageForModel = age ?? ageFallback;
  const seasoningMult = SEASONING_BASE + SEASONING_RANGE * Math.sqrt(Math.min(Math.max(ageForModel, 0), SEASONING_DAYS) / SEASONING_DAYS);
  const implied = Math.max(1, Math.round(p.tvl_usd * band.multiple * growthMult * seasoningMult));
  const impliedLow = Math.max(1, Math.min(implied, Math.round(p.tvl_usd * band.low * growthMult * seasoningMult)));
  const impliedHigh = Math.max(implied, Math.round(p.tvl_usd * band.high * growthMult * seasoningMult));
  const farmCapital = capitalFor(p);
  const confidence = confidenceFor(band.peers);
  return {
    implied,
    impliedLow,
    impliedHigh,
    multiple: band.multiple,
    bandLow: band.low,
    bandHigh: band.high,
    peers: band.peers,
    confidence,
    growthPct,
    growthMult,
    changeReported: reported,
    seasoningMult,
    age,
    ageAssumed: age === null,
    farmCapital,
    impliedPerDollar: Math.round(implied / farmCapital),
    halfMultiple: band.multiple / 2,
    doubleMultiple: band.multiple * 2,
    riskFlags: riskFlagsFor(p, confidence, age, reported),
  };
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  farm_chain: string;
  model: {
    peer_multiple: number;
    peer_band_low: number;
    peer_band_high: number;
    category_peers: number;
    confidence: Confidence;
    growth_pct: number;
    growth_multiplier: number;
    seasoning_multiplier: number;
    farm_capital_usd: number;
    implied_per_farm_dollar: number;
    half_multiple: number;
    double_multiple: number;
    risk_flags: RiskFlag[];
  };
  farm_steps: string[];
}

/** The board: every rankable pre-token protocol, implied value descending, slug as the tie-break. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; bands: Bands } {
  const bands = calibrate(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const rankable = snapshot.protocols.filter(isRankable);
  const knownAges = rankable.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const ageFallback = knownAges.length > 0 ? Math.round(median(knownAges)) : UNKNOWN_AGE_DAYS;
  const scored = rankable.map((p) => ({ p, s: impliedValue(p, snapshot.as_of, bands, ageFallback) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    token_status: 'pre-token' as const,
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_low_usd: s.impliedLow,
    implied_high_usd: s.impliedHigh,
    farm_chain: farmChain(p).chain,
    model: {
      peer_multiple: round4(s.multiple),
      peer_band_low: round4(s.bandLow),
      peer_band_high: round4(s.bandHigh),
      category_peers: s.peers,
      confidence: s.confidence,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      seasoning_multiplier: round4(s.seasoningMult),
      farm_capital_usd: s.farmCapital,
      implied_per_farm_dollar: s.impliedPerDollar,
      half_multiple: round4(s.halfMultiple),
      double_multiple: round4(s.doubleMultiple),
      risk_flags: s.riskFlags,
    },
    farm_steps: farmSteps(p, s),
  }));
  return { board, bands };
}

/**
 * A typical cost, in US dollars, of one ordinary transaction (a swap, a deposit) on a chain
 * DefiLlama names, at ordinary congestion. The farm plan is written for the cheapest chain the
 * protocol itself runs on: the same position farmed on Ethereum mainnet can cost fifty times
 * the gas of the same position on Base, and a plan that hides that is not a plan.
 */
export const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 3.5,
  Bitcoin: 2.0,
  Litecoin: 0.05,
  Doge: 0.1,
  Tron: 0.8,
  Binance: 0.15,
  BSC: 0.15,
  'BNB Chain': 0.15,
  Op_Bnb: 0.05,
  Solana: 0.02,
  Eclipse: 0.02,
  Soon: 0.02,
  Base: 0.08,
  Arbitrum: 0.12,
  Optimism: 0.1,
  'OP Mainnet': 0.1,
  Polygon: 0.03,
  Avalanche: 0.25,
  'zkSync Era': 0.15,
  Linea: 0.15,
  Scroll: 0.2,
  Mantle: 0.08,
  Starknet: 0.15,
  Blast: 0.1,
  Mode: 0.1,
  Manta: 0.1,
  Taiko: 0.15,
  Sei: 0.03,
  Sui: 0.05,
  Aptos: 0.05,
  Near: 0.05,
  'Near Protocol': 0.05,
  Gnosis: 0.02,
  xDai: 0.02,
  Celo: 0.03,
  Fantom: 0.05,
  Sonic: 0.03,
  Moonbeam: 0.1,
  Moonriver: 0.05,
  Aurora: 0.03,
  Kava: 0.05,
  Cronos: 0.05,
  Harmony: 0.02,
  Injective: 0.03,
  Osmosis: 0.05,
  Cosmos: 0.05,
  Berachain: 0.1,
  Hyperliquid: 0.02,
  'Hyperliquid L1': 0.02,
  Unichain: 0.08,
  Ink: 0.08,
  Worldchain: 0.08,
  'World Chain': 0.08,
  Zora: 0.08,
  Fraxtal: 0.1,
  BOB: 0.1,
  Mint: 0.05,
  XLayer: 0.05,
  'X Layer': 0.05,
  'Polygon zkEVM': 0.15,
  Astar: 0.05,
  Metis: 0.1,
  Boba: 0.1,
  Fuse: 0.02,
  Velas: 0.02,
  Rootstock: 0.05,
  RSK: 0.05,
  Core: 0.05,
  CORE: 0.05,
  BitTorrent: 0.02,
  WEMIX: 0.05,
  Kaia: 0.03,
  Klaytn: 0.03,
  Monad: 0.03,
  'Robinhood Chain': 0.05,
  Plasma: 0.03,
  Ripple: 0.02,
  XRP: 0.02,
  Arc: 0.05,
  Cardano: 0.15,
  TON: 0.05,
  Stellar: 0.01,
  Flare: 0.03,
  Hemi: 0.08,
  'Plume Mainnet': 0.05,
  Katana: 0.05,
  Algorand: 0.01,
  MegaETH: 0.03,
  Tempo: 0.05,
  Morph: 0.08,
  TAC: 0.05,
  XDC: 0.02,
  Etherlink: 0.03,
  Soneium: 0.08,
  Filecoin: 0.05,
  Telos: 0.03,
  OKExChain: 0.05,
  Hedera: 0.01,
  Polkadot: 0.1,
  Stable: 0.03,
};

/** The gas figure used for a chain the table does not name. */
export const DEFAULT_GAS_USD = 0.4;

/** The chain a farm plan is written for: the cheapest of the protocol's own chains, first-listed on a tie. */
export function farmChain(p: SnapshotProtocol): { chain: string; gasUsd: number } {
  let best: { chain: string; gasUsd: number } | null = null;
  for (const chain of p.chains) {
    const gasUsd = CHAIN_GAS_USD[chain] ?? DEFAULT_GAS_USD;
    if (best === null || gasUsd < best.gasUsd) best = { chain, gasUsd };
  }
  return best ?? { chain: 'its main chain', gasUsd: DEFAULT_GAS_USD };
}

/** A dollar figure the way the farm steps quote it: cents under ten dollars, trimmed above. */
export function dollars(n: number): string {
  if (n < 10) return `$${n.toFixed(2).replace(/0$/, '')}`;
  return `$${Math.round(n)}`;
}

/** Capital for one farm position, from the protocol's own TVL: bigger protocols absorb more. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

interface Playbook {
  open: (p: SnapshotProtocol, chain: string, capital: number) => string;
  deepen: (p: SnapshotProtocol, chain: string, capital: number) => string;
  weekly: (p: SnapshotProtocol) => string;
}

/** The category playbooks: the two protocol-specific actions and the weekly cadence action. */
const PLAYBOOKS: { match: string[]; book: Playbook }[] = [
  {
    match: ['lend', 'cdp', 'collateral'],
    book: {
      open: (p, chain, c) => `Supply $${c} of USDC as collateral to ${p.name} on ${chain}; supplying is the activity a lending launch rewards first.`,
      deepen: (p, chain, c) => `Borrow about $${Math.round(c / 3)} of a second asset against the position on ${p.name} and repay it a week later, so the wallet shows both sides of the market.`,
      weekly: (p) => `Each week, add or withdraw a small amount (about $10) on ${p.name} so the position is never dormant in a weekly snapshot.`,
    },
  },
  {
    match: ['dex', 'swap'],
    book: {
      open: (p, chain, c) => `Provide $${c} of liquidity to ${p.name}'s highest-volume pool on ${chain} (a USDC pair if one exists) and keep the LP position open.`,
      deepen: (p, chain, c) => `Route about $${Math.round(c / 2)} of swaps through ${p.name} across the week in at least three separate transactions, not one block.`,
      weekly: (p) => `Each week, make one swap of $10 or more on ${p.name} and rebalance the LP position if it drifts out of range.`,
    },
  },
  {
    match: ['bridge', 'cross chain'],
    book: {
      open: (p, chain, c) => `Bridge $${c} of USDC to ${chain} through ${p.name}, then use the bridged funds in one app on the far side instead of bridging straight back.`,
      deepen: (p, chain, c) => `Bridge a second, smaller amount (about $${Math.round(c / 4)}) on a different day and in the other direction, so both routes carry your wallet.`,
      weekly: (p) => `Each week, bridge one small amount ($10 or more) through ${p.name} on a different day of the week than the last.`,
    },
  },
  {
    match: ['perpetual', 'derivative', 'options'],
    book: {
      open: (p, chain, c) => `Deposit $${c} of USDC as margin on ${p.name} and open one small position (about $${Math.round(c / 5)} notional) that you manage to a planned exit.`,
      deepen: (p, chain, c) => `Close the first position and open a second on a different market of ${p.name}, so the wallet trades more than one instrument.`,
      weekly: (p) => `Each week, place one trade of $10 or more notional on ${p.name}; steady volume over weeks counts more than one large day.`,
    },
  },
  {
    match: ['staking', 'restak'],
    book: {
      open: (p, chain, c) => `Stake $${c} of the staking asset of ${chain} through ${p.name} and keep the receipt token in the same wallet.`,
      deepen: (p, chain, c) => `Claim any staking rewards ${p.name} issues and restake them once, so the position compounds on the record.`,
      weekly: (p) => `Each week, check the position on ${p.name} and top it up by about $10 if rewards or prices moved it below your starting size.`,
    },
  },
  {
    match: ['curator', 'allocator', 'vault'],
    book: {
      open: (p, chain, c) => `Deposit $${c} into one of ${p.name}'s curated vaults on ${chain} and keep the vault shares in the wallet.`,
      deepen: (p, chain, c) => `Split a second deposit of about $${Math.round(c / 3)} into a different ${p.name} vault, so the wallet holds more than one strategy.`,
      weekly: (p) => `Each week, review the vault's allocation page on ${p.name} and add about $10 to whichever vault you already hold.`,
    },
  },
  {
    match: ['rwa', 'stable'],
    book: {
      open: (p, chain, c) => `Mint or deposit $${c} of ${p.name}'s yield-bearing asset on ${chain} through its own app and hold the asset in the wallet.`,
      deepen: (p, chain, c) => `Use the minted asset once as the protocol intends (hold it in a supported wallet view or supply it where ${p.name} lists it) rather than selling it at once.`,
      weekly: (p) => `Each week, add about $10 to the ${p.name} position so its balance grows in steps, not in a single day.`,
    },
  },
  {
    match: ['prediction'],
    book: {
      open: (p, chain, c) => `Fund the wallet with $${c} on ${p.name} and take one position in a liquid market you can state a reason for.`,
      deepen: (p, chain, c) => `Take a second position in a different category of market on ${p.name} and let both run to settlement.`,
      weekly: (p) => `Each week, take one new position of $10 or more on ${p.name} and settle or close the oldest open one.`,
    },
  },
  {
    match: ['insurance'],
    book: {
      open: (p, chain, c) => `Buy about $${c} of cover from ${p.name} on ${chain} for a position you actually hold, and keep the policy to its term.`,
      deepen: (p, chain, c) => `Stake about $${Math.round(c / 3)} into ${p.name}'s underwriting pool if it offers one, so the wallet also earns the risk side.`,
      weekly: (p) => `Each week, check the cover on ${p.name} is still active and renew or extend it before it lapses.`,
    },
  },
  {
    match: ['yield', 'farm', 'liquidity'],
    book: {
      open: (p, chain, c) => `Deposit $${c} into ${p.name}'s main yield position on ${chain} and keep the position open past the first rewards snapshot.`,
      deepen: (p, chain, c) => `Harvest the first rewards ${p.name} pays and redeposit them once, so the wallet's history shows a full earn cycle.`,
      weekly: (p) => `Each week, harvest or top up about $10 on ${p.name}; a position touched weekly reads as farmed, not parked.`,
    },
  },
];

const GENERIC: Playbook = {
  open: (p, chain, c) => `Deposit $${c} of USDC into ${p.name} on ${chain} through its own app and keep the position open.`,
  deepen: (p, chain, c) => `Make a second, smaller deposit of about $${Math.round(c / 3)} into ${p.name} on a different day, so the wallet's activity spans more than one session.`,
  weekly: (p) => `Each week, make one small transaction (about $10) on ${p.name} — a deposit, a claim or an adjustment — and never let a month pass idle.`,
};

function playbookFor(p: SnapshotProtocol): Playbook {
  const c = (p.category ?? '').toLowerCase();
  for (const entry of PLAYBOOKS) {
    if (entry.match.some((m) => c.includes(m))) return entry.book;
  }
  return GENERIC;
}

/** A step as the gate reads it: one string, trimmed length 20..600, action plus cost plus time. */
function step(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  return s;
}

/**
 * The step a row's own 7-day record calls for, or null when the week was unremarkable: a steep
 * fall asks for a safety check before any deposit, and growth fast enough to be rented asks for
 * smaller sizing. Both come from the protocol's own change_7d, never from its name.
 */
function riskStep(p: SnapshotProtocol): string | null {
  if (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d)) return null;
  if (p.change_7d <= -15) {
    return step(
      `Before depositing anything, check ${p.name}'s own announcements for why its TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in seven days — an exploit, a migration or an ended incentive each call for a different answer, and if no cause is published, farm something else first.`,
      'nothing; this step is reading, not spending',
      '20 minutes, before step 2',
    );
  }
  if (p.change_7d >= 40) {
    return step(
      `Size the position as if the current incentive ends without notice: ${p.name}'s TVL grew ${p.change_7d.toFixed(1)}% in seven days, growth that fast is usually rented, so keep the position at the size above and no larger until the growth survives a second week.`,
      'no extra cost; it caps the capital the other steps commit',
      'no extra time',
    );
  }
  return null;
}

/**
 * A protocol's farm plan: six steps (seven when its own week calls for a caution) derived from
 * its record — category playbook, the cheapest of its own chains to transact on, a capital size
 * from its TVL and a hold from its age — each with what it costs and how long it takes. Gas is
 * quoted for the chain the plan names, from CHAIN_GAS_USD. Nothing is written per protocol by hand.
 */
export function farmSteps(p: SnapshotProtocol, s: Scored): string[] {
  const { chain, gasUsd } = farmChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(s.age);
  const book = playbookFor(p);
  const setupGas = Math.max(0.05, gasUsd * 3);
  const touchGas = Math.max(0.02, gasUsd);
  const steps = [
    step(
      `Open a fresh wallet for ${p.name} alone and fund it from your main wallet; a dedicated wallet keeps the farm attributable and its seed phrase stays offline.`,
      `under ${dollars(touchGas * 2)} of gas for the funding transaction on ${chain}`,
      '5 minutes',
    ),
    step(book.open(p, chain, capital), `$${capital} of capital plus about ${dollars(setupGas)} of gas on ${chain}`, '15 minutes to set up'),
    step(book.deepen(p, chain, capital), `about ${dollars(touchGas * 2)} of gas on ${chain}, on top of the capital already in`, '10 minutes, a week after step 2'),
    step(book.weekly(p), `about ${dollars(touchGas)} of gas a week on ${chain}`, '10 minutes a week'),
    step(
      `Hold the position for at least ${hold} days so the activity appears in more than one weekly snapshot; ${p.name} has run ${s.age === null ? 'for an unrecorded span' : `about ${s.age} days`} with no token recorded, and short visits are the first thing a snapshot filter drops.`,
      `the $${capital} stays in the position for the whole hold`,
      `${hold} days`,
    ),
    step(
      `Keep a farm log (wallet, dates, transaction hashes, amounts) and, before any withdrawal, check ${p.name}'s own points or rewards page and follow only the claim link it publishes there.`,
      'nothing but the log; never pay a fee to claim',
      '10 minutes at the end',
    ),
  ];
  const risk = riskStep(p);
  if (risk !== null) steps.splice(1, 0, risk);
  return steps;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  symbol: string | null;
  /** The market's own mcap/TVL for this protocol: the very ratio the model learns from. */
  own_multiple: number | null;
}

/** The live-token protocols, by market cap, for the dashboard's separate Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      symbol: p.symbol,
      own_multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round2(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The dashboard's compact row: the board row's display fields plus its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  age_assumed: boolean;
  watchlist: boolean;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  peer_multiple: number;
  peer_band_low: number;
  peer_band_high: number;
  category_peers: number;
  confidence: Confidence;
  growth_multiplier: number;
  change_reported: boolean;
  seasoning_multiplier: number;
  farm_capital_usd: number;
  implied_per_farm_dollar: number;
  half_multiple: number;
  double_multiple: number;
  risk_flags: RiskFlag[];
  farm_chain: string;
  farm_steps: string[];
}

/** The worked example the dashboard's "how to read this board" section walks through: the
 *  board's first row, with every number the narrative quotes taken from its own scored row. */
export interface WorkedExample {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  peers: number;
  confidence: Confidence;
  band_low: number;
  peer_multiple: number;
  band_high: number;
  change_7d: number | null;
  growth_multiplier: number;
  seasoning_multiplier: number;
  age_days: number | null;
  implied_low_usd: number;
  implied_value_usd: number;
  implied_high_usd: number;
  farm_capital_usd: number;
  implied_per_farm_dollar: number;
  farm_chain: string;
  /** The plan's first three steps, quoted in the walk-through. */
  farm_steps: string[];
}

/** Everything the dashboard renders: the board, the live set, the calibration and the method. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  live_size: number;
  total_implied_usd: number;
  calibration: { global: CategoryBand; pairs: number; categories: CategoryBand[] };
  /** The peer list behind each category's band, in the calibration table's order. */
  peer_tables: { category: string; peers: PeerEntry[] }[];
  worked_example: WorkedExample;
  rows: RadarRow[];
  live: LiveRow[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, bands } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const categories = [...bands.byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const first = board[0]!;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    calibration: {
      global: bands.global,
      pairs: bands.pairs,
      categories,
    },
    peer_tables: categories.map((c) => ({ category: c.category, peers: bands.peerLists.get(c.category) ?? [] })),
    worked_example: {
      slug: first.slug,
      name: first.name,
      category: first.category,
      tvl_usd: first.tvl_usd,
      peers: first.model.category_peers,
      confidence: first.model.confidence,
      band_low: first.model.peer_band_low,
      peer_multiple: first.model.peer_multiple,
      band_high: first.model.peer_band_high,
      change_7d: first.change_7d,
      growth_multiplier: first.model.growth_multiplier,
      seasoning_multiplier: first.model.seasoning_multiplier,
      age_days: first.age_days,
      implied_low_usd: first.implied_low_usd,
      implied_value_usd: first.implied_value_usd,
      implied_high_usd: first.implied_high_usd,
      farm_capital_usd: first.model.farm_capital_usd,
      implied_per_farm_dollar: first.model.implied_per_farm_dollar,
      farm_chain: first.farm_chain,
      farm_steps: first.farm_steps.slice(0, 3),
    },
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      age_assumed: r.listed_at === null,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      implied_low_usd: r.implied_low_usd,
      implied_high_usd: r.implied_high_usd,
      peer_multiple: r.model.peer_multiple,
      peer_band_low: r.model.peer_band_low,
      peer_band_high: r.model.peer_band_high,
      category_peers: r.model.category_peers,
      confidence: r.model.confidence,
      growth_multiplier: r.model.growth_multiplier,
      change_reported: r.change_7d !== null,
      seasoning_multiplier: r.model.seasoning_multiplier,
      farm_capital_usd: r.model.farm_capital_usd,
      implied_per_farm_dollar: r.model.implied_per_farm_dollar,
      half_multiple: r.model.half_multiple,
      double_multiple: r.model.double_multiple,
      risk_flags: r.model.risk_flags,
      farm_chain: r.farm_chain,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.implied_low_usd > r.implied_value_usd || r.implied_high_usd < r.implied_value_usd) {
      return `${r.slug} has a value band that does not hold its implied value`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
