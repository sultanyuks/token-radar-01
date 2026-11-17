# Launch Radar — token-radar-01 entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sultanyuks/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sultanyuks/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01):
it reads the sealed DefiLlama snapshot, finds the protocols that record no token yet, prices each
one's hypothetical launch from the spread of its category's trading peers, ranks them, and hands
the reader a farm plan for every row.

**Entry:** "Launch Radar" by @bright-otter-11 · Repository: https://github.com/sultanyuks/token-radar-01

## The model (radar-4, peer band + efficiency & sensitivity)

The snapshot prices its own future launches. Of its 758 protocols, 144 already trade; 128 of them
carry both a TVL and a market cap. Each category's peer band is the 25th percentile, median and
75th percentile of its trading protocols' market-cap/TVL ratios, each shrunk geometrically toward
the same global percentile with weight peers/(peers+8). A pre-token protocol's implied launch
value — and the range around it — is:

```
implied value = TVL × category median multiple × momentum factor × seasoning factor
implied range = TVL × category quartile multiple × momentum factor × seasoning factor
momentum: gains pass at 0.50 (clamped +100%, at most ×1.50); losses at 0.90 (clamped −50%, at least ×0.55);
          an unreported 7-day change is not read as zero — the factor is 1 and the row is flagged
seasoning = 0.80 + 0.45 × √(min(age_days, 1460) / 1460);  an unrecorded listing date is priced at
          the median recorded age of the ranked set, and the row is flagged
implied per $1 farmed = implied value ÷ the farm capital the row's own plan commits ($50–$500 by TVL)
halving / doubling multiple = the peer multiple at which the implied value halves / doubles
```

The asymmetry is the point: a doubling of TVL in a week can be rented with an incentive, while a
halving is rarely faked, so losses count for more than gains. The band is the point too: a price
sourced from one trading peer is shown with the wide range and the "thin evidence" label it
deserves, and a category with no trading peers is priced on the global band and says so.

Two instruments ride on the price. **Farm efficiency**: each row's plan commits a different
amount of capital ($50 against a small protocol, $500 against a giant), so the ranking alone
cannot say where a farming dollar works hardest — every row therefore also carries its implied
value per $1 of the farm capital its own plan commits, and the board sorts by it, to be read
beside the evidence grade and never instead of it. **Sensitivity**: the price is linear in the
peer multiple, so each detail view states what the market must believe — the multiple at which
the price halves and the one at which it doubles, and whether the category's own band already
crosses either line.

No protocol name is special-cased; every multiple is recomputed from the snapshot at run time, so
the same program re-run on a future snapshot finds future launches early. A protocol is ranked
only when it records no token **and** is not a wrapped, staked or bridged product of one that
trades (the watchlist rule's field-level checks: category, version markers, product words,
exchange prefixes) — that is what keeps WBTC, Binance staked ETH and USDT0 off the board. The
board ranks 198 protocols on this snapshot, all 40 watchlist protocols flagged among them, and
the dashboard keeps the trading protocols in a separate Live view at the market's own values,
Mcap/TVL column included — the raw material the bands are calibrated from.

Each row's farm plan is generated from the protocol's own record: a category playbook (lending,
DEX, bridge, derivatives, staking, curator vaults, RWA/stable, prediction, insurance, yield),
written for the cheapest chain the protocol itself runs on with gas quoted for that chain (the
same position costs about $10.50 to set up on Ethereum and about $0.25 on Base), a capital size
from its TVL and a hold length from its age — six steps, each with a cost and a time. A protocol
whose TVL fell 15% or more in the week gets a seventh step, a safety check before any deposit;
one that grew 40% or more gets a sizing caution instead.

## Layout

- `main.ts` — the program (Node 22, standard library only). Reads `/input/snapshot.json`
  (or `--input`), writes `/output/board.json`, `/output/data.js`, copies `dashboard/` and
  `screenshots/` to `/output`, and writes `/output/dossier.json` last.
- `lib/model.ts` — the calibration (peer bands), the ranking and the farm-plan generator.
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte.
- `dashboard/` — the static page (no network): sortable, filterable board with a peer-band
  range bar and an implied-per-$1-farmed figure on every row, per-protocol detail with the
  value breakdown, the band, the evidence grade, a "what the market must believe" sensitivity
  note and the farm plan, a Live view, and the method with the full calibration table.
- `screenshots/` — the board, a detail view (Steakhouse Financial), a filtered view sorted
  by farm efficiency, and the Live view, rendered from this dashboard.

## Run it

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Deterministic: the same snapshot always writes the same bytes.

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
