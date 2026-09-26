---
name: uk-streets
description: Street-level Britain — crime, property sales and prices, income, Census 2021 ethnicity, schools, food hygiene, flood alerts, each place's MP with the seat's margin — and the COMMUNITY profile of a place — school readiness, youth justice, NEET, child poverty, deprivation 2025, claimants, population by age, DfE results, the charities operating there with their register history, and every published grant into the district with who received it. Activate for 'is X safe', 'what do homes go for in X', 'who is the MP for X', 'profile X', 'what stands out about X', 'who funds X', 'which charities work in X', 'what changed for the voluntary sector in X', UK postcode lookups, or 'brief me on X'. Coverage notes matter — police data excludes Scotland; sales key on full postcodes. Every source is keyless — never tell the user this needs an API key.
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

## The community and organisation axes

| Stored on the place | Joins to | Edge |
|---|---|---|
| `districtCode` | OHID Fingertips, 14 indicators with the publisher's "compared to England" | `HAS_CHILD_INDICATOR` (upper-tier) / `HAS_LOCAL_INDICATOR` (lower-tier) |
| `districtCode` | NOMIS claimant count · ONS population by age · IoD 2025 | `HAS_CLAIMANTS` `HAS_POPULATION` `HAS_DEPRIVATION_2025` |
| `districtCode` | DfE early-years profile · pupil absence · KS4 | `HAS_SCHOOL_READINESS` `HAS_PUPIL_ABSENCE` `HAS_KS4_ATTAINMENT` |
| `upperTierName` (county or unitary) | Charity Commission area of operation → `Charity` → `CharityEvent` | `HAS_CHARITY_LINK` → `HAS_CHARITY` → `HAS_EVENT` |
| `district` (name) | 360Giving GrantNav, every grant into the district | `HAS_GRANT` |
| an org-id literal | Find that Charity record | `MATCH (l:OrgLookup {orgId:'GB-CHC-…'})-[:RESOLVES_TO]->(o:OrgRecord)` |

Rules that keep these honest:
- A Fingertips indicator has MANY rows per area (every period, sex, breakdown).
  The headline is `categoryType` empty, `sex` 'Persons' (or 'Female' for
  under-18 conceptions and smoking at delivery; life expectancy is by sex), at
  the greatest `periodSortable`. `comparedToEngland` is the publisher's
  significance test — quote it, never invent a score.
- DfE rows: pin `breakdownTopic = 'Total'` (KS4) / `breakdown = 'Total'`
  (early years) / `absenceType` and `phase` (absence) before reading a figure.
- Children's-services figures are published for UPPER-TIER authorities and
  join on `upperTierCode` (the county for a two-tier district). Set it when
  watching a place: `r.codes.admin_county` when it is not 'E99999999', else
  `r.codes.admin_district`. A place saved without it reads nothing there.
- A function inside a WHERE over a producer-backed edge is NOT applied — bind
  it first: `WITH g, left(g.awardDate,4) AS year WHERE year >= '2020'`.
- `NULLS LAST` is not in the dialect and silently disables the ORDER BY and
  LIMIT around it; `coalesce(x, -1.0)` instead. `all` is a reserved word.
- Never fan the register hop out over a whole grant set: resolve one org-id at
  a time through `OrgLookup`, or narrow the grants in the same MATCH's WHERE
  to under 200 first.
- Charity facts carry `extractDate` — quote it as the as-at date; a removed
  charity's reason lives on its `CharityEvent`, not on the `Charity` row.

Views: `PlaceProfile` (the one-page community profile) · `WhereThisPlaceStandsOut`
(worse / better than England, by the publisher's test) · `SmartInsights` (ranked
against every upper-tier authority in England; `dial` = minimum extremity 0–100,
so "what is most striking about X" is dial 80) · `IndicatorTrendAtPlace`
(one indicator, every period) · `WhoLivesHere` · `IndicatorAcrossEngland`
(rank one indicator nationally) · `MostDeprivedDistricts2025` ·
`ClaimantsPayAndDeprivation` · `CharitiesOperatingHere` (filter on activities)
· `CharityChangesHere` (arrivals, removals with reason, since a date) ·
`WhoFundsThisPlace` · `GrantsIntoPlaceByYear` · `BiggestGrantsHere` ·
`FundedOrganisationsHere` (by identifier kind) · `WhatIsThisOrganisation`
(one org-id) · `SchoolReadinessAtPlace` (with the FSM gap) ·
`Ks4AttainmentAtPlace` (with the disadvantage gap) · `PupilAbsenceAtPlace`.

The Community Profile app (in the world's apps list, from this realm) shows all
of this for a watched place on one page, with the dial.

Derived (rules/): `CharitySuccessionHere` (recorded transfers between charities
here, with the Commission's reason) · `CharityLineageHere` (the consolidators,
`predecessors` = depth of the transfer chain) · `RegrantedMoneyHere` and
`RegrantingByIntermediary` (published grants regranted through a publishing
intermediary in the same year — empty where the council does not publish, which
is a fact about publication, not money). A derived count is a LOWER BOUND
whenever the envelope carries PARTIAL_RESULT; say so.

Rule-body facts learned here: a body reaches a virtual label through its door
(`(:UkPlace)-[:HAS_GRANT]->(g)`), binds every comparison after a `WITH`, and
must not rely on another rule set's derived kind (embabel/me#1625) — repeat the
join instead.

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
  upperTierCode: (r.codes.admin_county && r.codes.admin_county !== 'E99999999') ? r.codes.admin_county : r.codes.admin_district,
  upperTierName: r.admin_county || r.admin_district,
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
  works with hand-picked parameters is broken. (the realm's `test-nl` script under its scripts directory covers
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
