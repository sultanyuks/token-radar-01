// Launch Radar model (radar-2, "peer multiple"): one sealed snapshot in, one ranked board out.
//
// THE MODEL. The snapshot itself says what a launched token is worth: 144 of its protocols already
// trade, and each carries both a TVL and a market cap. For every category we take the median
// market-cap/TVL ratio of that category's trading protocols, shrunk toward the global median
// (0.21 across all 128 usable pairs) by a geometric blend weighted n/(n+SHRINK_PEERS), so a
// category with two observations cannot shout down one with forty. A pre-token
// protocol's implied launch value is then
//
//   implied = TVL x category multiple x growth factor x seasoning factor
//
//   growth factor    = 1 + clamp(change_7d, -50, +100)/100 x 0.6   (unreported change counts as 0)
//   seasoning factor = 0.75 + 0.5 x min(age_days, 1460)/1460       (unknown listing date: age 730,
//                      the factor's neutral point: a protocol that has run longer with no token has
//                      more accrued, unpriced activity behind a launch, so it prices richer)
//
// No protocol name is ever special-cased: the same function scores every row, and every multiple is
// recomputed from the snapshot at run time, so the same program re-run on a future snapshot finds
// future launches early. A protocol is pre-token when its record carries no token (no market cap,
// no CoinGecko id, no symbol); trading protocols are set apart in the live list with the market's
// own values, never mixed into the ranked board. The board ranks every rankable pre-token protocol
// in the snapshot (198 on this one): the watchlist's 40 are flagged, not favoured — rank is the
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

export const MODEL_VERSION = 'radar-2 peer-multiple';

/** Shrinkage strength: a category median is blended toward the global median as if the global
 *  median were SHRINK_PEERS extra observations of the category. */
export const SHRINK_PEERS = 8;
/** How much of a clamped 7-day TVL move the growth factor passes through. */
export const GROWTH_WEIGHT = 0.6;
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 100;
/** Seasoning: factor runs SEASONING_BASE .. SEASONING_BASE+SEASONING_RANGE over SEASONING_DAYS. */
export const SEASONING_BASE = 0.75;
export const SEASONING_RANGE = 0.5;
export const SEASONING_DAYS = 1460;
/** Age assumed when DefiLlama names no listing date: the seasoning factor's neutral point. */
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

/** The median of a non-empty numeric list (mean of the two middle values on an even count). */
export function median(values: number[]): number {
  const v = [...values].sort((x, y) => x - y);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export interface CategoryMultiple {
  category: string;
  /** Trading protocols of this category carrying both a market cap and a TVL. */
  peers: number;
  /** The shrunk median market-cap/TVL ratio a launch in this category is priced at. */
  multiple: number;
}

export interface Multiples {
  global: number;
  pairs: number;
  byCategory: Map<string, CategoryMultiple>;
}

/**
 * The peer multiples, calibrated from the snapshot alone: every trading protocol with both a
 * market cap and a TVL contributes its ratio; a category's multiple is its own median ratio
 * blended geometrically toward the global median with weight peers/(peers+SHRINK_PEERS) — a
 * category with many trading peers keeps most of its own signal, a thin one leans on the market.
 */
export function calibrate(protocols: SnapshotProtocol[]): Multiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    ratios.push(r);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key);
    if (list === undefined) perCategory.set(key, [r]);
    else list.push(r);
  }
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, list] of perCategory) {
    const own = median(list);
    const w = list.length / (list.length + SHRINK_PEERS);
    const multiple = Math.exp(w * Math.log(own) + (1 - w) * Math.log(global));
    byCategory.set(category, { category, peers: list.length, multiple });
  }
  return { global, pairs: ratios.length, byCategory };
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

export interface Scored {
  implied: number;
  multiple: number;
  peers: number;
  growthPct: number;
  growthMult: number;
  seasoningMult: number;
  age: number | null;
}

/** One protocol's implied launch value and the full breakdown behind it. */
export function impliedValue(p: SnapshotProtocol, asOf: string, multiples: Multiples): Scored {
  const age = ageDays(asOf, p.listed_at);
  const cm = multiples.byCategory.get(p.category ?? 'Uncategorised');
  const multiple = cm === undefined ? multiples.global : cm.multiple;
  const peers = cm === undefined ? 0 : cm.peers;
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, raw));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const seasoningMult = SEASONING_BASE + (Math.min(Math.max(ageForModel, 0), SEASONING_DAYS) / SEASONING_DAYS) * SEASONING_RANGE;
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * seasoningMult));
  return { implied, multiple, peers, growthPct, growthMult, seasoningMult, age };
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
  model: {
    peer_multiple: number;
    category_peers: number;
    growth_pct: number;
    growth_multiplier: number;
    seasoning_multiplier: number;
  };
  farm_steps: string[];
}

/** The board: every rankable pre-token protocol, implied value descending, slug as the tie-break. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; multiples: Multiples } {
  const multiples = calibrate(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, s: impliedValue(p, snapshot.as_of, multiples) }));
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
    model: {
      peer_multiple: round4(s.multiple),
      category_peers: s.peers,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      seasoning_multiplier: round4(s.seasoningMult),
    },
    farm_steps: farmSteps(p, s.age),
  }));
  return { board, multiples };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
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
 * A protocol's farm plan: six steps derived from its own record — category playbook, first chain,
 * a capital size from its TVL and a hold from its age — each with what it costs and how long it
 * takes. Nothing is written per protocol by hand.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const book = playbookFor(p);
  const gas = capital >= 250 ? 8 : capital >= 150 ? 6 : 4;
  return [
    step(
      `Open a fresh wallet for ${p.name} alone and fund it from your main wallet; a dedicated wallet keeps the farm attributable and its seed phrase stays offline.`,
      'under $3 of gas for the funding transaction',
      '5 minutes',
    ),
    step(book.open(p, chain, capital), `$${capital} of capital plus about $${gas} of gas`, '15 minutes to set up'),
    step(book.deepen(p, chain, capital), 'about $2 of gas on top of the capital already in', '10 minutes, a week after step 2'),
    step(book.weekly(p), 'about $2 of gas a week', '10 minutes a week'),
    step(
      `Hold the position for at least ${hold} days so the activity appears in more than one weekly snapshot; ${p.name} has run ${age === null ? 'for an unrecorded span' : `about ${age} days`} with no token recorded, and short visits are the first thing a snapshot filter drops.`,
      `the $${capital} stays in the position for the whole hold`,
      `${hold} days`,
    ),
    step(
      `Keep a farm log (wallet, dates, transaction hashes, amounts) and, before any withdrawal, check ${p.name}'s own points or rewards page and follow only the claim link it publishes there.`,
      'nothing but the log; never pay a fee to claim',
      '10 minutes at the end',
    ),
  ];
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
  watchlist: boolean;
  implied_value_usd: number;
  peer_multiple: number;
  category_peers: number;
  growth_multiplier: number;
  seasoning_multiplier: number;
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
  calibration: { global_multiple: number; pairs: number; categories: CategoryMultiple[] };
  rows: RadarRow[];
  live: LiveRow[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    calibration: {
      global_multiple: round4(multiples.global),
      pairs: multiples.pairs,
      categories: [...multiples.byCategory.values()].sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1)),
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
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      peer_multiple: r.model.peer_multiple,
      category_peers: r.model.category_peers,
      growth_multiplier: r.model.growth_multiplier,
      seasoning_multiplier: r.model.seasoning_multiplier,
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
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
