/* Launch Radar page: renders window.RADAR (written by main.ts beside this page) with no network.
   Board view: every pre-token protocol, filterable and sortable, each row opening a detail view
   with its value breakdown and farm plan. Live view: the protocols whose token already trades,
   kept apart at the market's own values. Query parameters (?cat=, ?tier=, ?q=, ?detail=, ?view=,
   ?sort=) set the opening state, which is how the entry's screenshots were taken. */
'use strict';

const R = window.RADAR;
const $ = (id) => document.getElementById(id);
const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString('en-US')}`);
const moneyFull = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const params = new URLSearchParams(location.search);
const state = {
  q: params.get('q') ?? '',
  cat: params.get('cat') ?? 'all',
  chain: params.get('chain') ?? 'all',
  tier: params.get('tier') ?? 'all',
  sort: params.get('sort') ?? 'rank',
  view: params.get('view') ?? 'board',
  detail: params.get('detail') ?? null,
};

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

function filtered() {
  const q = state.q.trim().toLowerCase();
  let rows = R.rows.filter((r) => {
    if (state.cat !== 'all' && (r.category ?? 'Uncategorised') !== state.cat) return false;
    if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
    if (state.tier === 'watchlist' && !r.watchlist) return false;
    if (state.tier === 'early' && r.watchlist) return false;
    if (q && !r.name.toLowerCase().includes(q) && !r.slug.includes(q)) return false;
    return true;
  });
  const by = {
    rank: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    multiple: (a, b) => b.peer_multiple - a.peer_multiple,
  }[state.sort];
  rows.sort(by);
  return rows;
}

function renderBoard() {
  const rows = filtered();
  $('count').textContent = `${rows.length} of ${R.board_size} pre-token protocols shown · ranked by implied launch value`;
  $('rows').innerHTML = rows
    .map(
      (r) => `<tr class="row${state.detail === r.slug ? ' sel' : ''}" data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="flag">WATCHLIST</span>' : ''}<br><span class="pcat">${esc(r.category ?? 'Uncategorised')}</span></td>
      <td class="chains">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
      <td class="num">${r.age_days === null ? '—' : `${r.age_days}d`}</td>
      <td class="num">${r.peer_multiple.toFixed(2)}×</td>
      <td class="num implied">${money(r.implied_value_usd)}</td>
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
      <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'}">${pct(r.change_7d)}</td>
    </tr>`,
    )
    .join('');
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
  box.innerHTML = `
    <h2>${esc(r.name)} <span class="pcat">#${r.rank} of ${R.board_size}</span>${r.watchlist ? '<span class="flag">WATCHLIST</span>' : ''}</h2>
    <p class="sub">${esc(cat)} · ${esc(r.chains.join(', ') || 'no chains recorded')} · records no token in DefiLlama's snapshot of ${esc(R.as_of)}${r.listed_at ? ` · tracked since ${esc(r.listed_at)}` : ''}</p>
    <div class="breakdown">
      <div class="stat"><div class="k">TVL</div><div class="v">${moneyFull(r.tvl_usd)}</div></div>
      <div class="stat"><div class="k">Peer multiple</div><div class="v">${r.peer_multiple.toFixed(2)}× <small>(${cat}, ${r.category_peers} trading peer${r.category_peers === 1 ? '' : 's'})</small></div></div>
      <div class="stat"><div class="k">Growth factor</div><div class="v">${r.growth_multiplier.toFixed(2)}× <small>(7d ${pct(r.change_7d)})</small></div></div>
      <div class="stat"><div class="k">Seasoning factor</div><div class="v">${r.seasoning_multiplier.toFixed(2)}× <small>(${r.age_days === null ? 'age unrecorded' : `${r.age_days} days tokenless`})</small></div></div>
      <div class="stat"><div class="k">Implied launch value</div><div class="v" style="color:var(--teal)">${moneyFull(r.implied_value_usd)}</div></div>
    </div>
    <p class="eq">${moneyFull(r.tvl_usd)} TVL × ${r.peer_multiple.toFixed(2)} peer multiple × ${r.growth_multiplier.toFixed(2)} growth × ${r.seasoning_multiplier.toFixed(2)} seasoning = <strong>${moneyFull(r.implied_value_usd)}</strong> if ${esc(r.name)} launched a token at its record today.</p>
    <h3>Farm plan</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  box.hidden = false;
  if (scroll) box.scrollIntoView({ block: 'nearest' });
}

function setView(view) {
  state.view = view;
  $('view-board').classList.toggle('on', view === 'board');
  $('view-live').classList.toggle('on', view === 'live');
  $('board').hidden = view !== 'board';
  $('live').hidden = view !== 'live';
  $('count').hidden = view !== 'board';
  if (view === 'live') $('count').hidden = false, ($('count').textContent = `${R.live_size} protocols whose token already trades — the market's own values, kept apart from the pre-token ranking`);
}

function init() {
  $('lede').innerHTML =
    `The snapshot (<strong>${esc(R.as_of)}</strong>, DefiLlama via make.fun) holds <strong>${R.board_size} protocols that record no token</strong>. ` +
    `This radar prices each one's launch from the snapshot's own trading peers and ranks it — <strong>${R.watchlist_size} watchlist protocols</strong> at or above ${money(R.floor_usd)} TVL and every early one below the floor — with the steps to farm each. ` +
    `Trading protocols are set apart in the Live view.`;
  const cats = [...new Set(R.rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  fillSelect($('cat'), cats, 'All categories');
  fillSelect($('chain'), chains, 'All chains');
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('tier').value = state.tier;
  $('sort').value = state.sort;
  $('calibrows').innerHTML = R.calibration.categories
    .map((c) => `<tr><td>${esc(c.category)}</td><td class="num">${c.peers}</td><td class="num">${c.multiple.toFixed(3)}×</td></tr>`)
    .join('');
  $('fine').textContent =
    `Global median across ${R.calibration.pairs} trading pairs: ${R.calibration.global_multiple.toFixed(3)}× TVL. ` +
    `Source: ${R.source}. An implied value is this entry's own claim about a launch that may never happen — it prices the record, it does not predict a token.`;
  const onFilter = () => {
    state.q = $('q').value;
    state.cat = $('cat').value;
    state.chain = $('chain').value;
    state.tier = $('tier').value;
    state.sort = $('sort').value;
    renderBoard();
  };
  for (const id of ['q', 'cat', 'chain', 'tier', 'sort']) $(id).addEventListener('input', onFilter);
  $('view-board').addEventListener('click', () => setView('board'));
  $('view-live').addEventListener('click', () => setView('live'));
  $('rows').addEventListener('click', (e) => {
    const tr = e.target.closest('tr.row');
    if (tr) showDetail(tr.dataset.slug), renderBoard();
  });
  renderBoard();
  renderLive();
  setView(state.view);
  if (state.detail) showDetail(state.detail, false);
}

init();
