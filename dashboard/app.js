/* Launch Radar page: renders window.RADAR (written by main.ts beside this page) with no network.
   Board view: every pre-token protocol, filterable and sortable — including by implied value per
   $1 of farm capital — each row carrying its risk flags under its name and opening a detail view
   with its value breakdown, its peer band, the named peer list behind that band, what the market
   must believe to halve or double its price, and its farm plan. A "how to read this board"
   section walks the first row end to end. Live view: the protocols whose token already trades,
   kept apart at the market's own values. Query parameters (?cat=, ?tier=, ?tvl=, ?q=, ?detail=,
   ?view=, ?sort=) set the opening state, which is how the entry's screenshots were taken. */
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString('en-US')}`);
const moneyFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const CONF_LABEL = { deep: 'deep evidence', solid: 'solid evidence', thin: 'thin evidence', global: 'global band only' };
/* The risk flags, as they ride under a row's name on the board. Definitions live in the method
   section and, with the row's own numbers filled in, in its detail view (flagLines below). */
const FLAG_SHORT = { 'thin-evidence': 'thin evidence', 'global-band': 'global band', 'single-chain': 'single chain', young: 'under 6 months', 'unreported-7d': '7d unreported' };
const flagChips = (r) => r.risk_flags.map((f) => `<span class="riskchip">${FLAG_SHORT[f]}</span>`).join('');

const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') ?? '',
  cat: params.get('cat') ?? 'all',
  chain: params.get('chain') ?? 'all',
  tier: params.get('tier') ?? 'all',
  tvlband: params.get('tvl') ?? 'all',
  sort: params.get('sort') ?? 'rank',
  view: params.get('view') ?? 'board',
  detail: params.get('detail') ?? null,
};

/* The range bars share one log scale across the whole board, so a wide bar on a small row and a
   narrow bar on a large one mean what they look like. */
const LOG_MIN = Math.log10(Math.max(1, Math.min(...R.rows.map((r) => r.implied_low_usd))));
const LOG_MAX = Math.log10(Math.max(...R.rows.map((r) => r.implied_high_usd)));
const logPos = (n) => ((Math.log10(Math.max(1, n)) - LOG_MIN) / Math.max(1e-9, LOG_MAX - LOG_MIN)) * 100;

function rangeBar(r) {
  const left = logPos(r.implied_low_usd);
  const width = Math.max(1.5, logPos(r.implied_high_usd) - left);
  const dot = logPos(r.implied_value_usd);
  return `<div class="rangebar" aria-hidden="true"><div class="seg-fill" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></div><div class="seg-dot" style="left:${dot.toFixed(1)}%"></div></div>`;
}

function fillSelect(el, values, allLabel) {
  el.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = allLabel;
  el.appendChild(all);
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  }
}

const TVL_BANDS = {
  b1: (t) => t >= 1e9,
  b2: (t) => t >= 1e8 && t < 1e9,
  b3: (t) => t >= 1e7 && t < 1e8,
  b4: (t) => t < 1e7,
};

function filtered() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (state.cat !== 'all' && (r.category ?? 'Uncategorised') !== state.cat) return false;
    if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
    if (state.tier === 'watchlist' && !r.watchlist) return false;
    if (state.tier === 'early' && r.watchlist) return false;
    if (state.tvlband !== 'all' && !TVL_BANDS[state.tvlband](r.tvl_usd)) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    multiple: (a, b) => b.peer_multiple - a.peer_multiple,
    width: (a, b) => b.implied_high_usd / b.implied_low_usd - a.implied_high_usd / a.implied_low_usd,
    peers: (a, b) => b.category_peers - a.category_peers || a.rank - b.rank,
    efficiency: (a, b) => b.implied_per_farm_dollar - a.implied_per_farm_dollar || a.rank - b.rank,
  }[state.sort];
  rows.sort(by);
  return rows;
}

function renderBoard() {
  const rows = filtered();
  $('count').textContent = `${rows.length} of ${R.board_size} pre-token protocols shown · ranked by implied launch value · the bar is each category's peer band (25th–75th percentile), the tick its price · the small figure under a price is the implied value per $1 of the farm capital its plan commits · the red chips under a name are its risk flags, defined in How to read this board`;
  $('rows').innerHTML = rows
    .map(
      (r) => `<tr class="row${state.detail === r.slug ? ' sel' : ''}" data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="flag">WATCHLIST</span>' : ''}${flagChips(r)}<br><span class="pcat">${esc(r.category ?? 'Uncategorised')}</span></td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
      <td class="num">${r.age_days === null ? '—' : `${r.age_days}d`}</td>
      <td class="num">${r.peer_multiple.toFixed(2)}×</td>
      <td class="num implied">${money(r.implied_value_usd)}<br><span class="perdollar">${money(r.implied_per_farm_dollar)} per $1 farmed</span></td>
      <td class="range">${rangeBar(r)}<span class="rangetext">${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</span></td>
      <td><button class="farmbtn" type="button" data-farm="${esc(r.slug)}">Farm plan</button></td>
    </tr>`,
    )
    .join('');
}

function renderLive() {
  $('liverows').innerHTML = R.live
    .map(
      (r) => `<tr>
      <td><span class="pname">${esc(r.name)}</span><br><span class="pcat">${esc(r.category ?? 'Uncategorised')}</span></td>
      <td>${esc(r.symbol ?? '—')}</td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${r.mcap_usd === null ? '—' : money(r.mcap_usd)}</td>
      <td class="num">${r.own_multiple === null ? '—' : `${r.own_multiple.toFixed(2)}×`}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
    </tr>`,
    )
    .join('');
}

function caveats(r) {
  const out = [];
  if (r.age_assumed) out.push('DefiLlama records no listing date for this protocol, so its seasoning is priced at the median recorded age of the ranked set, not at its own age.');
  return out;
}

/* The row's risk flags with their triggers stated against its own numbers. The evidence flags
   restate what the confidence grade says, in caution form; the rest read the record's shape. */
function flagLines(r) {
  const defs = {
    'thin-evidence': `<strong>Thin evidence</strong> — only ${r.category_peers} trading peer${r.category_peers === 1 ? '' : 's'} in its category ${r.category_peers === 1 ? 'carries' : 'carry'} both a TVL and a market cap, so this band leans heavily on the global one; the peer table below names ${r.category_peers === 1 ? 'it' : 'them'}.`,
    'global-band': '<strong>Global band</strong> — no protocol in its category trades with both a TVL and a market cap in the snapshot, so the market-wide band below prices this row.',
    'single-chain': `<strong>Single chain</strong> — every dollar of its TVL sits on ${esc(r.chains[0] ?? 'one chain')}; a halt or exploit on that one chain touches the whole position.`,
    young: `<strong>Young</strong> — first tracked ${r.age_days} days ago, under six months; a record that short has not yet survived a bad market, so the plan's long hold matters more, not less.`,
    'unreported-7d': '<strong>7d unreported</strong> — DefiLlama reports no 7-day change for this protocol, so its momentum factor is 1 by construction: unreported is not read as zero growth or as decline.',
  };
  return r.risk_flags.map((f) => defs[f]);
}

/* The peer list behind a row's band: its category's own table, or — for a row priced on the
   global band — every category's peers together, sorted by ratio. */
function peersFor(r) {
  const cat = r.category ?? 'Uncategorised';
  const t = R.peer_tables.find((x) => x.category === cat);
  if (t && t.peers.length > 0) return { label: cat, peers: t.peers, global: false };
  const all = R.peer_tables.flatMap((x) => x.peers).sort((a, b) => a.multiple - b.multiple || (a.slug < b.slug ? -1 : 1));
  return { label: 'All categories', peers: all, global: true };
}

const mult = (m) => `${m < 1 ? m.toFixed(3) : m.toFixed(2)}×`;

/* The auditable evidence: every peer behind the band, its own ratio beside the TVL and market
   cap it comes from, the peers inside the shrunk band shaded. */
function peerTable(r) {
  const { label, peers, global } = peersFor(r);
  const w = peers.length / (peers.length + 8);
  const rows = peers
    .map((p) => `<tr${p.multiple >= r.peer_band_low && p.multiple <= r.peer_band_high ? ' class="inband"' : ''}><td>${esc(p.name)}</td><td class="num">${mult(p.multiple)}</td><td class="num">${money(p.tvl_usd)}</td><td class="num">${money(p.mcap_usd)}</td></tr>`)
    .join('');
  return `<h3>The peers behind this price — ${esc(label)}${global ? ' (the global band)' : ''}</h3>
    <p class="sub">The band above is this list's 25th–75th percentile, shrunk toward the global band with weight ${peers.length}/(${peers.length}+8) = ${w.toFixed(2)}; shaded rows trade inside the shrunk band (${mult(r.peer_band_low)} – ${mult(r.peer_band_high)}). Recount the quartiles from these ratios and you recount the price.</p>
    <div class="tablewrap"><table class="peers"><thead><tr><th>Trading peer</th><th class="num">Mcap / TVL</th><th class="num">TVL</th><th class="num">Market cap</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* What the market must believe: the price is TVL × multiple, so it halves at half the pricing
   multiple and doubles at twice it. The sentences say where those two lines fall against the
   category's own band — inside it, the move needs no new mood, only the peers' weaker or
   stronger quarter; outside it, the band itself is the argument. */
function believeLines(r) {
  const half = `<strong>${r.half_multiple.toFixed(2)}×</strong> halves this price (to ${moneyFull(Math.round(r.implied_value_usd / 2))}); <strong>${r.double_multiple.toFixed(2)}×</strong> doubles it (to ${moneyFull(r.implied_value_usd * 2)}).`;
  const low =
    r.half_multiple < r.peer_band_low
      ? `Even the band's low end (${r.peer_band_low.toFixed(2)}×, its category's 25th percentile) leaves the launch worth ${moneyFull(r.implied_low_usd)} — the pessimistic quarter of its peers does not halve this price.`
      : `The halving line falls inside the category's own band (${r.peer_band_low.toFixed(2)}× – ${r.peer_band_high.toFixed(2)}×): its weaker quarter of peers already trades at or below it, so a halved price asks for no new pessimism.`;
  const high =
    r.double_multiple <= r.peer_band_high
      ? `The doubling line also falls inside the band — the category's stronger quarter of peers already trades above ${r.double_multiple.toFixed(2)}×.`
      : `Doubling takes ${r.double_multiple.toFixed(2)}×, above the band's high end (${r.peer_band_high.toFixed(2)}×) — more per TVL dollar than this category's strongest quarter of peers fetches today.`;
  return `${half} ${low} ${high}`;
}

function showDetail(slug, scroll = true) {
  const r = R.rows.find((x) => x.slug === slug);
  const box = $('detail');
  if (!r) {
    box.hidden = true;
    return;
  }
  state.detail = slug;
  const cat = r.category ?? 'Uncategorised';
  const notes = caveats(r);
  box.innerHTML = `
    <h2>${esc(r.name)} <span class="pcat">#${r.rank} of ${R.board_size}</span>${r.watchlist ? '<span class="flag">WATCHLIST</span>' : ''}</h2>
    <p class="sub">${esc(cat)} · ${esc(r.chains.join(', ') || 'no chains recorded')} · records no token in DefiLlama's snapshot of ${esc(R.as_of)}${r.listed_at ? ` · tracked since ${esc(r.listed_at)}` : ''} · farm plan written for ${esc(r.farm_chain)}</p>
    <div class="breakdown">
      <div class="stat"><div class="k">TVL</div><div class="v">${moneyFull(r.tvl_usd)}</div></div>
      <div class="stat"><div class="k">Peer multiple (median)</div><div class="v">${r.peer_multiple.toFixed(2)}× <small>(${cat})</small></div></div>
      <div class="stat"><div class="k">Peer band 25th–75th</div><div class="v">${r.peer_band_low.toFixed(2)}× – ${r.peer_band_high.toFixed(2)}×</div></div>
      <div class="stat"><div class="k">Evidence</div><div class="v"><span class="conf conf-${r.confidence}">${CONF_LABEL[r.confidence]}</span> <small>(${r.category_peers} trading peer${r.category_peers === 1 ? '' : 's'})</small></div></div>
      <div class="stat"><div class="k">Momentum factor</div><div class="v">${r.growth_multiplier.toFixed(2)}× <small>(7d ${pct(r.change_7d)})</small></div></div>
      <div class="stat"><div class="k">Seasoning factor</div><div class="v">${r.seasoning_multiplier.toFixed(2)}× <small>(${r.age_days === null ? 'age unrecorded' : `${r.age_days} days tokenless`})</small></div></div>
      <div class="stat"><div class="k">Implied launch value</div><div class="v" style="color:var(--teal)">${moneyFull(r.implied_value_usd)}</div></div>
      <div class="stat"><div class="k">Implied range</div><div class="v">${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</div></div>
      <div class="stat"><div class="k">Farm capital (its plan)</div><div class="v">${moneyFull(r.farm_capital_usd)}</div></div>
      <div class="stat"><div class="k">Implied per $1 farmed</div><div class="v">${money(r.implied_per_farm_dollar)} <small>per $1 of that capital</small></div></div>
    </div>
    <p class="eq">${moneyFull(r.tvl_usd)} TVL × ${r.peer_multiple.toFixed(2)} peer multiple × ${r.growth_multiplier.toFixed(2)} momentum × ${r.seasoning_multiplier.toFixed(2)} seasoning = <strong>${moneyFull(r.implied_value_usd)}</strong> if ${esc(r.name)} launched a token at its record today — and ${moneyFull(r.implied_low_usd)} to ${moneyFull(r.implied_high_usd)} across the middle half of its category's trading peers.</p>
    <h3>What the market must believe</h3>
    <p class="believe">${believeLines(r)}</p>
    ${peerTable(r)}
    <h3>Risk flags</h3>
    ${r.risk_flags.length > 0 ? `<ul class="caveats">${flagLines(r).map((n) => `<li>${n}</li>`).join('')}</ul>` : '<p class="sub">No flag test fires on this row\'s record — which is not the same as safe, only as unflagged on these tests.</p>'}
    ${notes.length > 0 ? `<ul class="caveats">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <h3>Farm plan — written for ${esc(r.farm_chain)}, the cheapest of its chains to transact on</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  box.hidden = false;
  if (scroll) box.scrollIntoView({ block: 'nearest' });
}

/* The worked example: the board's first row walked end to end with its own numbers — the
   record, the band its peers set, its own week and age, the price they make, and the plan. */
function renderRead() {
  const w = R.worked_example;
  const cat = w.category ?? 'Uncategorised';
  $('readbody').innerHTML = `
    <p>Take the board's first row, <strong>${esc(w.name)}</strong> (${esc(cat)}), and follow it the way the model does.</p>
    <ol class="walk">
      <li><strong>The record.</strong> ${esc(w.name)} holds ${moneyFull(w.tvl_usd)} of TVL and records no token — no market cap, no CoinGecko id, no symbol — so it belongs on this board, ranked by what its launch would be worth at today's record.</li>
      <li><strong>The band.</strong> ${cat} has ${w.peers} trading peer${w.peers === 1 ? '' : 's'} carrying both a TVL and a market cap (${CONF_LABEL[w.confidence]}). Their ratios' middle half, shrunk toward the global band, runs ${mult(w.band_low)} – ${mult(w.band_high)} per TVL dollar, median ${mult(w.peer_multiple)} — and the peer table in ${esc(w.name)}'s detail view names ${w.peers === 1 ? 'that peer' : 'every one of them'}, so the band can be recounted, not just believed.</li>
      <li><strong>Its own week and age.</strong> Its TVL moved ${pct(w.change_7d)} in seven days, which the asymmetric momentum rule turns into a factor of ${w.growth_multiplier.toFixed(2)}×; it has run ${w.age_days === null ? 'an unrecorded span' : `${w.age_days} days`} tokenless, which the concave seasoning curve turns into ${w.seasoning_multiplier.toFixed(2)}×.</li>
      <li><strong>The price.</strong> ${moneyFull(w.tvl_usd)} × ${mult(w.peer_multiple)} × ${w.growth_multiplier.toFixed(2)} × ${w.seasoning_multiplier.toFixed(2)} = <strong>${moneyFull(w.implied_value_usd)}</strong>, with the band giving the range ${moneyFull(w.implied_low_usd)} – ${moneyFull(w.implied_high_usd)}. Against the ${moneyFull(w.farm_capital_usd)} its farm plan commits, that is ${money(w.implied_per_farm_dollar)} of implied value per $1 farmed.</li>
      <li><strong>The plan.</strong> The plan is written for ${esc(w.farm_chain)}, the cheapest of its chains to transact on. It opens: ${esc(w.farm_steps[0] ?? '')}</li>
    </ol>
    <p>Every other row is read the same way: the chips under a name are its risk flags, the bar is its band, and its detail view shows the peers, the sensitivity and the full plan behind the price.</p>`;
}

function setView(view) {
  state.view = view;
  $('view-board').classList.toggle('on', view === 'board');
  $('view-live').classList.toggle('on', view === 'live');
  $('board').hidden = view !== 'board';
  $('live').hidden = view !== 'live';
  if (view === 'live') $('count').textContent = `${R.live_size} protocols whose token already trades — the market's own values, kept apart from the pre-token ranking; their Mcap/TVL column is the raw material the peer bands are calibrated from`;
  else renderBoard();
}

function init() {
  $('lede').innerHTML =
    `The snapshot (<strong>${esc(R.as_of)}</strong>, DefiLlama via make.fun) holds <strong>${R.board_size} protocols that record no token</strong>. ` +
    `This radar prices each one's launch from the spread of its category's trading peers and ranks it — <strong>${R.watchlist_size} watchlist protocols</strong> at or above ${money(R.floor_usd)} TVL and every early one below the floor — with the steps to farm each, written for the cheapest chain it runs on. ` +
    `Each row also states the implied value standing behind every $1 of the farm capital its own plan commits (sort by it), and each detail view states the peer multiple at which its price would halve or double, names every trading peer behind its band so the multiple can be recounted, and defines the risk flags its record earns. ` +
    `Trading protocols are set apart in the Live view.`;
  $('stat-rows').textContent = String(R.board_size);
  $('stat-watch').textContent = `${R.watchlist_size} of ${R.watchlist_size}`;
  $('stat-total').textContent = money(R.total_implied_usd);
  const g = R.calibration.global;
  $('stat-band').textContent = `${g.low.toFixed(2)}× – ${g.high.toFixed(2)}×`;
  const cats = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  fillSelect($('cat'), cats, 'All categories');
  fillSelect($('chain'), chains, 'All chains');
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('tier').value = state.tier;
  $('tvlband').value = state.tvlband;
  $('sort').value = state.sort;
  $('calibrows').innerHTML = R.calibration.categories
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${c.low.toFixed(3)}×</td><td class="num">${c.multiple.toFixed(3)}×</td><td class="num">${c.high.toFixed(3)}×</td></tr>`)
    .join('');
  $('fine').textContent =
    `Global peer band across ${R.calibration.pairs} trading pairs: ${g.low.toFixed(3)}× – ${g.multiple.toFixed(3)}× – ${g.high.toFixed(3)}× TVL (25th percentile, median, 75th). ` +
    `Source: ${R.source}. An implied value is this entry's own claim about a launch that may never happen — it prices the record, it does not predict a token.`;
  const onFilter = () => {
    state.q = $('q').value;
    state.cat = $('cat').value;
    state.chain = $('chain').value;
    state.tier = $('tier').value;
    state.tvlband = $('tvlband').value;
    state.sort = $('sort').value;
    renderBoard();
  };
  for (const id of ['q', 'cat', 'chain', 'tier', 'tvlband', 'sort']) $(id).addEventListener('input', onFilter);
  $('view-board').addEventListener('click', () => setView('board'));
  $('view-live').addEventListener('click', () => setView('live'));
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (tr) showDetail(tr.dataset.slug), renderBoard();
  });
  renderBoard();
  renderLive();
  renderRead();
  setView(state.view);
  if (state.detail) showDetail(state.detail, false);
}

init();
