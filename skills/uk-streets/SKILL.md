---
name: uk-streets
description: Street-level Britain — crime, property sales and prices, income, Census 2021 ethnicity, schools, food hygiene, flood alerts, and each place's MP with the seat's margin. Activate for "is X safe", "what do homes go for in X", "who is the MP for X", "air of the place" questions about UK places, UK postcode lookups, or "brief me on X". Coverage notes matter: police data excludes Scotland; sales key on full postcodes. Every source is keyless — never tell the user this needs an API key.
---

# UK Streets

Eleven keyless official sources joined at the places the user watches. All calls go
through `gateway.<ns>.<method>(args)` from inside `code_mode` — never as
top-level tools.

## The one idea

A watched `UkPlace` stores its geography ONCE (resolved from postcodes.io at
save time) and every stored field is a JOIN KEY into a different national
dataset:

| Stored on the place | Joins to | Edge |
|---|---|---|
| `latitude`/`longitude` | police.uk crime · FSA hygiene · EA floods | `HAS_CRIME` `HAS_FOOD` `HAS_FLOOD_ALERT` |
| `postcode` (full, UPPERCASE) | Land Registry Price Paid sales | `HAS_SALE` |
| `lsoa` (E01… GSS code) | Census 2021 ethnicity | `HAS_ETHNICITY` |
| `districtCode` (E09…/E06…) | ONS ASHE median pay | `HAS_INCOME` |
| `districtCode` (E09…/E06…) | ONS official crime rates per 1,000 (Table C5) | `HAS_DISTRICT_CRIME` |
| `districtSlug` (`tower-hamlets`) | UK House Price Index | `HAS_HOUSE_PRICES` |
| `constituency` | Parliament: MP + party → `(:Seat)-[:HAS_RESULT]->(:SeatResult)` with majority and turnout | `HAS_SEAT` |
| `wkt` (`Point(lon lat)`) | Wikidata schools | `HAS_SCHOOL` |

Two zoom levels: a FULL postcode (`SE10 9JY`) carries every key; an OUTCODE
(`SE10`) carries the coordinate and district keys only — sales and census are
street-level facts and stay empty there, which is correct, not missing.

## Saved views — reach for these first

`PlaceDossier` (everything, one row per place) · `CrimeAroundMyPlaces` ·
`SafestPlace` · `TopCrimeStreets` · `ViolenceAndRobbery` · `CrimeByParty` ·
`CrimeVsIncome` · `IncomeByParty` · `SeatsAndMargins` · `NeighbourhoodMosaic` ·
`WhatHomesActuallySold` · `PriceTrendAtMyPlaces` · `WhereNotToEat` ·
`SchoolsNearMyPlaces` · `FloodWatch`. Run via
`gateway.view.run({ name, params })`.

NATIONAL cross-section (the official ONS district crime table — no places
needed): `DistrictCrimeLeague` (ranked rates per 1,000, worst first) ·
`DistrictCrimeAtMyPlaces` (each place's district row) ·
`CrimeVsIncomeAcrossDistricts` (~290 districts, crime beside median pay) ·
`WhatTracksDistrictCrime` (correlation + least-squares fit with named
outliers; needs an engine with correlate/regress). The national anchor is
literal-seeded: `MATCH (u:UkDistricts {set:'england-and-wales'})`. Westminster
tops raw league tables partly by daytime population — say so; City of London
is null (supplier data unavailable); rates are the PUBLISHER'S per-1,000
figures, so they rank directly.

## Watching a place

Resolve geography FIRST, store it all — the keys are the realm:

```javascript
const r = (await gateway.postcodesIo.lookupPostcode({ postcode: 'SE10 9JY' })).result
await gateway.repository.createEntry({ type: 'UkPlace', data: {
  name: 'Greenwich', level: 'postcode', postcode: r.postcode.toUpperCase(),
  latitude: r.latitude, longitude: r.longitude,
  latlon: r.latitude + ',' + r.longitude, wkt: `Point(${r.longitude} ${r.latitude})`,
  outcode: r.outcode, district: r.admin_district, districtCode: r.codes.admin_district,
  districtSlug: r.admin_district.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  lsoa: r.codes.lsoa, lsoaName: r.lsoa, ward: r.admin_ward,
  constituency: r.parliamentary_constituency, region: r.region || r.country,
}})
```

For an outcode use `lookupOutcode`; for a bare name use `searchPlaces` and
prefer `local_type` City > Town > Village — the index is not ranked by
significance and bare "York" first matches a hamlet. **Never invent
coordinates or codes** — a wrong key returns a confident answer about the
wrong place.

## Rules that keep answers honest

- **Slow fan-outs must narrate, never freeze.** A whole-watchlist question fires
  one producer call per place per source and can take tens of seconds cold.
  The STANDARD approach: say what is fanning out BEFORE running ("checking N
  places against the crime register…"); in an app, subscribe to the live event
  stream — `new EventSource('/api/v1/virtual-cypher/events')`, one
  `producer.fetch` event per source call — and show the count; for anything
  deep (a `periods:` history, an open sweep) start a FILL
  (`POST /api/v1/admin/kg/fills`) and report its ticking progress instead of
  blocking anyone.
- **Compare crime as a RATE, never a raw radius count.** Incidents-within-a-mile
  rewards emptiness. The realm's denominator: census density (HAS_DENSITY,
  persons/km²) x 8.14 km² (the 1-mile circle) estimates residents in the
  radius; EVERY cross-place crime view (`SafestPlace`,
  `ViolenceAndRobbery`, `CrimeAroundMyPlaces`, `CrimeVsIncome`, `CrimeByParty`,
  `PlaceDossier`) leads with that rate; raw counts are context, never the
  ranking. `TopCrimeStreets` alone stays raw — an anonymised street locality
  has no population — so compare its streets within one place only. State the assumption when presenting — the neighbourhood's
  density is assumed to hold across the mile — and fall back to raw counts
  (saying so) where density is absent (outcode-level places, Scotland).

- **Every saved view MUST be tested with its DEFAULT parameters** against a
  world with a realistic number of watched places before it ships or changes —
  defaults are what the ask layer and the app actually run. A view that only
  works with hand-picked parameters is broken. (`scripts/test-nl.py` covers
  the ask layer; run each view via `gateway.view.run({ name })` for the rest.)

- **Aggregate, don't enumerate.** A city-centre place is thousands of crime
  rows a month. Count by category or street; never paste incident lists.
- **A zero is not always safety.** Scotland is absent from police.uk, and so
  is GREATER MANCHESTER (GMP stopped publishing street-level data in 2019); a
  commercial postcode has no sales; Wikidata's school coverage is partial.
  State the coverage fact.
- **Projected values arrive as STRINGS** — `toFloat()`/`toInteger()` before
  ordering or arithmetic, always.
- Street names are anonymised localities; points are snapped from addresses.
- FSA `RatingValue` is a string and not always numeric ('AwaitingInspection').
- Land Registry postcodes are CASE-SENSITIVE uppercase with the space.
- EA `severityLevel`: LOWER is worse.

## Briefing like a local journalist (the subjective layer)

The numbers are the sources; the LLM writes the story ONLY from them:

```javascript
const dossier = await gateway.view.run({ name: 'PlaceDossier' })
const trend = await gateway.view.run({ name: 'PriceTrendAtMyPlaces' })
const brief = await gateway.ai.complete({ prompt:
  'Write a five-sentence local-affairs brief for each place below. Use ONLY these
   figures; attribute each claim to its dataset; no speculation.\n' +
  JSON.stringify({ dossier: dossier.rows, prices: trend.rows }) })
```

Never let the model add facts the rows don't carry — the whole value of this
realm is that every claim traces to an official register.

## Civic surfaces

- **Petitions**: `MATCH (f:PetitionFeed {state:'open'})-[:LISTS]->(pt:Petition)`
  is the country's most-signed asks (literal-seeded anchor, nothing stored);
  one more hop (`HAS_SIGNATURES`) splits any petition across all 650 seats by
  ONS code — ALWAYS `ORDER BY signatures DESC LIMIT n` the petitions first.
  Views: `WhatBritainSigns`, `WhatMySeatsCareAbout`.
- **Contract awards**: `MATCH (w:AwardWindow {window:'from/to'})-[:PUBLISHED]->
  (c:ContractAward)` — ISO instants, daily-partitioned, fetched completely.
  The feed filters NOTHING server-side; narrow after. A supplier's address is
  its REGISTERED office (say so). Views: `BiggestAwardsThisMonth`,
  `AwardsNearMyPlaces`.
- **Care quality (CQC)**: `HAS_CARE` gives every registered care location in a
  place's outward code with its OFFICIAL rating — but only once the free
  `CQC_SUBSCRIPTION_KEY` is set (api-portal.service.cqc.org.uk). Until then
  say the credential is missing; never say there is no care nearby.

## Chaining with other realms

- **gov-uk**: a company's registered postcode → `lookupPostcode` →
  crime/prices/income around its office — a three-call chain.
- **realm-weather / realm-planet**: the same coordinates feed
  `gateway.openMeteo.forecast` and `gateway.openMeteoAir.airQuality` —
  one place, one panel: crime, weather, air.

## Deliberately not here (asked and answered)

- **Deprivation (IMD)**: opendatacommunities.org blocks non-browser agents.
- **Ofsted judgements, EPC certificates**: downloads or keyed APIs only.
- **Dog breeds by postcode**: no such public dataset exists; DEFRA published
  dogs-per-postcode-district once (2015, CSV). Say so rather than improvise.
