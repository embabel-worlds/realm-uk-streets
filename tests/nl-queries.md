# Natural-language query expectations

Run these through the world's ask surface (`POST /api/v1/admin/kg/ask`,
`{"question": …}`) with a few watched places spanning parties and regions.
Each row states what a CORRECT answer must contain — grade the rows, not the
phrasing. `scripts/test-nl.py` automates the run.

| Question | A correct answer must |
|---|---|
| Which of my UK places has the highest income level? | Rank by district median pay; the top row is the place whose district ASHE pay is highest. |
| Which of my places has the best school coverage? | Count HAS_SCHOOL per place; more schools first. Must not invent ratings — the source knows where schools are, not how good they are. |
| Which of my places has many schools but below-average income? | Join HAS_SCHOOL counts with HAS_INCOME pay; filter pay below the average across places. |
| Which Labour seats among my places have the lowest crime? | Filter to places whose Seat party is Labour BEFORE ranking by crime — a non-Labour place in the answer is a failure. |
| Which of my places' districts is largest with low crime? | Use district-level context; must not claim land area, which no joined source provides — population or explicit "cannot say" both acceptable. |
| What do homes actually sell for near my places? | Real Land Registry prices, not estimates; empty for commercial postcodes is correct. |
| Which of my places is in a marginal seat? | Use SeatResult.majority; smallest majority = most marginal. |
| Where has house prices falling fastest? | UKHPI annual change per district, most negative first. |

## Non-negotiables (from the type descriptions — check they hold)

- A Scottish place's zero crimes must be reported as a COVERAGE fact.
- Street names are anonymised localities, never exact addresses.
- School counts reflect Wikidata coverage, not school quality.
