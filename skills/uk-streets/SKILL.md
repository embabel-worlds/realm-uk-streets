---
name: uk-streets
description: UK street-level crime, postcodes and place geography. Activate for "is X safe", "crime in/near X", "what's the crime like around my places", UK postcode lookups, or navigating UK places. Coverage is England, Wales and NI — never present a Scottish zero as safety. Every source is keyless — never tell the user this needs an API key.
---

# UK Streets

Two keyless APIs over places the user watches in the UK. All calls go through
`gateway.<ns>.<method>(args)` from inside `code_mode` — never as top-level tools.

| Surface | Shape |
|---|---|
| `gateway.postcodesIo.lookupPostcode({ postcode })` | Postcode → coordinates + district. 404 when the postcode does not exist. |
| `gateway.postcodesIo.searchPlaces({ q })` | Town/suburb name → candidate places with coordinates. |
| `gateway.policeUk.streetCrimes({ lat, lng })` | All recorded crimes within a mile, latest month. A JSON array — city centres return THOUSANDS. |
| `gateway.policeUk.locateNeighbourhood({ q: 'lat,lng' })` | The force + neighbourhood ids; `neighbourhoodDetails({ force, id })` for the name. |
| `gateway.view.run({ name: 'CrimeAroundMyPlaces' })` | Category breakdown per watched place. Also: `SafestPlace`, `TopCrimeStreets`, `ViolenceAndRobbery`. |
| `gateway.repository.createEntry({ type: 'UkPlace', data })` | Watch a place — resolve coordinates via postcodes.io FIRST and store them on the place. |

## Rules that keep answers honest

- **Aggregate, don't enumerate.** `streetCrimes` at a city-centre point is
  thousands of rows. Count by `category` (and by `location.street.name` when
  asked about streets); never paste raw incident lists into chat.
- **A zero is not always safety.** Scotland's forces are not in this source, and
  the latest month may simply not be published yet. Check
  `gateway.policeUk.crimeLastUpdated({})` before calling anywhere quiet a haven.
- **Street names are anonymised localities** ("On or near Shopping Area") and
  points are snapped away from addresses by design — present them as areas,
  never as exact locations.
- **Never invent coordinates.** Resolve through `lookupPostcode` or
  `searchPlaces`; a wrong pair returns a real, confident-looking answer about
  the wrong place.

## Chaining with other realms

- **gov-uk installed?** A company's registered address gives a postcode →
  `lookupPostcode` → `streetCrimes`: "what's the area like around this
  company's registered office" is a three-call chain.
- **realm-weather / realm-planet installed?** The same coordinates feed
  `gateway.openMeteo.forecast` and `gateway.openMeteoAir.airQuality` — one
  place, one panel: crime, weather, air.
