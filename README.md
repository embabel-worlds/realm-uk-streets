# realm-uk-streets

**Street-level Britain, joined at a place.** Keyless official sources —
police-recorded crime, every registered property sale since 1995, the House
Price Index, ONS median pay, Census 2021 ethnicity, schools, food-hygiene
ratings, live flood alerts, and each place's MP with the seat's latest margin —
queryable as ONE graph, anchored on postcodes you choose.

```cypher
MATCH (p:UkPlace)-[:HAS_SEAT]->(s:Seat)
MATCH (p)-[:HAS_INCOME]->(i:AreaIncome)
RETURN s.party, round(avg(toFloat(i.annualPay))) AS avgDistrictPay
ORDER BY avgDistrictPay DESC
```

...is "what does a Labour street earn vs a Reform one", answered live from ONS
and Parliament's own record. No single public source serves that join; every
row of it is public data.

## The idea: the geo IS the join

A watched `UkPlace` resolves its geography once (postcodes.io, at save time)
and each stored field keys a different national dataset:

| Key on the place | Dataset | Edge → type |
|---|---|---|
| coordinates | data.police.uk street crime (1 mile, latest month) | `HAS_CRIME → CrimeIncident` |
| coordinates | FSA food hygiene (1 mile) | `HAS_FOOD → FoodPlace` |
| coordinates | Environment Agency flood alerts (live) | `HAS_FLOOD_ALERT → FloodAlert` |
| full postcode | HM Land Registry Price Paid (all sales since 1995) | `HAS_SALE → PropertySale` |
| LSOA code | Census 2021 ethnic composition | `HAS_ETHNICITY → EthnicGroupShare` |
| district code | ONS ASHE median full-time pay | `HAS_INCOME → AreaIncome` |
| district slug | UK House Price Index (13 months) | `HAS_HOUSE_PRICES → AreaHousePrice` |
| constituency | Parliament Members API | `HAS_SEAT → Seat` |
| *(the Seat itself)* | latest election result — majority, turnout | `HAS_RESULT → SeatResult` |
| WKT point | Wikidata schools (1.5 km, SPARQL) | `HAS_SCHOOL → School` |

Everything except `UkPlace` is **virtual** — fetched per query, cached at each
source's real cadence (crime 6 h, prices a day, census a week, floods 10
minutes), gone at rollback. `Seat → SeatResult` is a virtual node anchoring a
further virtual join: the graph chains across API calls.

**Two zoom levels**: watch `SE10 9JY` for street level (sales, census) or
`SE10` for the district view (crime and prices around the outcode centroid) —
the same dossier, different focal length.

## The community and organisation axes

The place a community-data platform charts is a statistic; here it is a set of
keys into the publishers themselves, and an organisation register beside them.

| Key on the place | Dataset | Edge → type |
|---|---|---|
| district code | OHID Fingertips — 14 indicators: school readiness (all, FSM), youth-justice first-time entrants, 16-17 NEET, children in low income, under-18 conceptions, Year 6 overweight, smoking at delivery, low birth weight, MMR, suicide, life expectancy, employment, disability-free life expectancy — with the publisher's own *compared to England* | `HAS_CHILD_INDICATOR` (upper-tier) / `HAS_LOCAL_INDICATOR` (lower-tier) → `AreaIndicator` |
| district code | NOMIS claimant count, latest month | `HAS_CLAIMANTS → ClaimantCount` |
| district code | ONS mid-year population, five age bands | `HAS_POPULATION → PopulationBand` |
| district code | Indices of Deprivation **2025** (lower-tier summaries) | `HAS_DEPRIVATION_2025 → DistrictDeprivation2025` |
| district code | DfE early-years profile (good level of development, with the FSM gap) · pupil absence · key stage 4 | `HAS_SCHOOL_READINESS → SchoolReadiness` · `HAS_PUPIL_ABSENCE → PupilAbsence` · `HAS_KS4_ATTAINMENT → Ks4Attainment` |
| district name | Charity Commission area-of-operation → the charity's daily register row → its event history (registrations, removals with reason, transfers) | `HAS_CHARITY_LINK → CharityAreaLink -[:HAS_CHARITY]-> Charity -[:HAS_EVENT]-> CharityEvent` |
| district name | 360Giving GrantNav — every published grant into the district, with recipient charity / company numbers | `HAS_GRANT → GrantIntoPlace` |
| an org-id | Find that Charity — the register record behind GB-CHC-… / GB-COH-… | `(:OrgLookup {orgId})-[:RESOLVES_TO]-> OrgRecord` |

National anchors: `IndicatorAcrossEngland {indicatorId}` ranks one indicator
across every upper-tier authority; `UkDistricts {set:'england-and-wales'}` now
also carries `HAS_CLAIMANTS` and `HAS_DEPRIVATION_2025`.

Views: `PlaceProfile` (the one-page community profile, each figure with its
period), `WhereThisPlaceStandsOut` (everything the authority is significantly
worse or better than England on — the publisher's test, not a score),
`IndicatorTrendAtPlace`, `WhoLivesHere`, `IndicatorAcrossEngland`,
`MostDeprivedDistricts2025`, `ClaimantsPayAndDeprivation`,
`CharitiesOperatingHere`, `CharityChangesHere` (arrivals and removals since a
date, with the Commission's reason), `WhoFundsThisPlace`,
`GrantsIntoPlaceByYear`, `BiggestGrantsHere`, `FundedOrganisationsHere`,
`WhatIsThisOrganisation`, `SchoolReadinessAtPlace`, `Ks4AttainmentAtPlace`,
`PupilAbsenceAtPlace`.

Three of the sources needed the engine to grow (me ≥ 2026-09-25): the Charity
Commission publishes a zip of tab-delimited parts with literal quotes inside
free text, and the DfE API serves gzip whether or not you asked. Both are now
sniffed from the bytes and handled once, in the tabular file cache and reader,
so no realm declares anything about them.

## What ships

- **`apps/street-lens.html`** — the map. Britain (vendored Natural Earth 50m
  outline — no tiles, no third-party fetch), watched places as dots, and a
  dossier per dot: the MP with the party's own brand colour and the seat's
  majority, median pay, average price with annual change, crime by category,
  the census mosaic, actual sales, schools (read through the graph join),
  the worst kitchens within a mile, live flood alerts. The search box speaks
  postcode, outcode and place names (ranked City > Town > hamlet).
- **15 saved views** — `PlaceDossier`, `CrimeVsIncome`, `IncomeByParty`,
  `SeatsAndMargins`, `PriceTrendAtMyPlaces`, `WhereNotToEat`,
  `NeighbourhoodMosaic`, `TopCrimeStreets` and more — each a cross-source
  question no single register answers.
- **`skills/uk-streets/`** — the chat skill: the join table, honesty rules
  (a Scottish zero is coverage, not safety), and the grounded-briefing recipe.
- **`tests/nl-queries.md` + `scripts/test-nl.py`** — runnable natural-language
  expectations against a live world.

## Coverage, honestly

- Police data covers England, Wales and NI — **not Scotland**.
- Street names are anonymised localities; points are snapped away from
  addresses by the police, by design.
- Sales key on full postcodes; commercial postcodes are legitimately empty.
- School coverage tracks Wikidata, not reality.
- Deprivation: the 2025 index is read from the gov.uk summaries (the 2019
  edition stays for the fitted crime model); LSOA-level IMD via
  opendatacommunities.org still refuses non-browser clients. Ofsted and EPC
  publish downloads, not keyless APIs.
- Children's-services indicators (school readiness, youth justice, NEET, DfE
  results) are published for upper-tier authorities. A place in a two-tier
  district finds them empty because the place does not yet store its county
  code — an honest gap, not a zero.
- The Charity Commission keys areas of operation on its own spelling of an
  authority's name; a district whose postcodes.io name differs finds no rows.
- GrantNav rate-limits scripted fetches: one district file a day, cached.

No API keys, no accounts, nothing to configure — the realm works the moment it
is installed.

## License

Apache-2.0. Data: © Crown copyright and database right (OGL v3) for the
government sources; ONS/OS via postcodes.io (OGL); Wikidata CC0.
