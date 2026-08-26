# realm-uk-streets

**Street-level Britain, joined at a place.** Ten keyless official sources —
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
- Deprivation (IMD) is absent because opendatacommunities.org refuses
  non-browser clients; Ofsted and EPC publish downloads, not keyless APIs.

No API keys, no accounts, nothing to configure — the realm works the moment it
is installed.

## License

Apache-2.0. Data: © Crown copyright and database right (OGL v3) for the
government sources; ONS/OS via postcodes.io (OGL); Wikidata CC0.
