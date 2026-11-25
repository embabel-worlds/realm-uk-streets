#!/usr/bin/env bash
# tests/verify.sh — ground truth to answer surface in one command (realm-spec README, `tests/`).
#
# Three passes, exit nonzero on any drift:
#   1. VIEWS   — invoke every saved view on its defaults; an error is a failure, a view
#                that names a required, defaultless param is skipped by name.
#   2. BATTERY — replay tests/questions.yml through the ask surface; assert each
#                expectation (nonEmpty / minRows / matchesView reconciliation).
#   3. ADVERSARIAL — questions this DATA cannot answer (constituency-level ethnicity,
#                land area, school ratings), each asked REPEATEDLY because generation
#                is stochastic. Every response is schema-checked: a query referencing a
#                property its label does not declare, or an answer column claiming a
#                question word nothing in the query selects, is a FABRICATION and fails
#                the run. A typed refusal, an honestly-named answer, or a claim the
#                envelope flags in `warnings` all pass. These once produced petition
#                signatures dressed as an "asian population estimate" (me#1214/#1223).
#
# Always run: pass 1 (VIEWS) and the SOURCE check — median pay for every Westminster seat read
# through the realm cold, against NOMIS directly (L2), in one source call (L3). Passes 2 and 3
# ask questions about watched places and call a model, so they are stochastic, cost money and
# need watched places: they run with FULL=1. Keyless, except CareNearMyPlaces, which reads CQC
# with CQC_SUBSCRIPTION_KEY and says so when it is missing. The last line on success is exactly
# `ALL CHECKS PASS`.
#
# Usage:  APPLIANCE=http://localhost:11043 AUTH=user:pass [FULL=1] [ADVERSARIAL_RUNS=3] tests/verify.sh
#         (EMBABEL_AUTH=user:pass and APPLIANCE_BASE still work)
# Refuses to run without EMBABEL_AUTH — a harness that assumes credentials will
# eventually hammer someone else's box.
set -euo pipefail
cd "$(dirname "$0")"

EMBABEL_AUTH="${AUTH:-${EMBABEL_AUTH:-}}"
: "${EMBABEL_AUTH:?set AUTH=user:pass for the target appliance}"
BASE="${APPLIANCE:-${APPLIANCE_BASE:-${APPLIANCE_URL:-http://localhost:11043}}}"
RUNS="${ADVERSARIAL_RUNS:-3}"

BATTERY_LIB="$(dirname "$0")/lib" python3 - "$BASE" "$EMBABEL_AUTH" "$RUNS" <<'PY'
import base64, json, os, re, sys, time, urllib.request, urllib.error
FULL = bool(os.environ.get("FULL"))

base, auth, runs = sys.argv[1], sys.argv[2], int(sys.argv[3])
hdr = {"Authorization": "Basic " + base64.b64encode(auth.encode()).decode(),
       "Content-Type": "application/json"}

def call(path, body=None):
    req = urllib.request.Request(base + path, headers=hdr,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)

try:
    import yaml
    questions = yaml.safe_load(open("questions.yml"))
except ImportError:
    sys.exit("pyyaml is required to read questions.yml: pip install pyyaml")

fails = []

# A figure is only this realm's when the engine says the answer is whole. short() is the battery
# library's (tests/lib, pinned from embabel-worlds/realm-spec): None when whole, else the line that
# stands in for the figure, "REFUSED: <why>" or "PARTIAL <figure>: <the engine's reason>".
import os as _os, sys as _sys
_sys.path.insert(0, _os.environ["BATTERY_LIB"])
from short import short  # noqa: E402

def whole(d, what, figure=None):
    """Flag a short answer as a failure with the engine's reason; True when the answer is whole."""
    s = short(d, figure)
    if s:
        fails.append(f"{what}: {s}")
        print(f"FAIL {what}: {s}")
    return s is None

# ── 1. VIEWS ────────────────────────────────────────────────────────────────────────
# THIS realm's views only: the world carries other realms' and the host's views too, and a
# harness that smoke-tests a neighbour's surface fails on defects it has no right to fix.
import glob
names = sorted({m.group(1) for f in glob.glob("../views/*.yml")
                for m in re.finditer(r"^- name:\s*(\S+)", open(f).read(), re.M)})
for name in names:
    try:
        d = call(f"/api/v1/admin/kg/views/{name}/run", {})
        rows = len(d.get("rows", []))
        if whole(d, f"view {name}", rows):
            print(f"ok   view {name}: {rows} row(s)")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:200]
        if "param" in body.lower():
            print(f"skip view {name}: requires a param with no default")
        else:
            fails.append(f"view {name}: HTTP {e.code} {body}")
            print(f"FAIL view {name}: HTTP {e.code} {body}")

# ── 2. BATTERY ──────────────────────────────────────────────────────────────────────
def top_figure(rows, column):
    if not rows:
        return None
    v = rows[0].get(column)
    return float(v) if isinstance(v, (int, float)) else None

def numeric_cells(row):
    return [float(v) for v in row.values() if isinstance(v, (int, float))]

for item in (questions if FULL else []):
    q, expect = item["question"], item["expect"]
    label = f"battery [{q[:48]}]"
    if "matchesView" not in expect:
        d = call("/api/v1/admin/kg/ask", {"question": q})
        rows = d.get("rows", [])
        if not whole(d, label, len(rows)):
            continue
    if "countOfView" in expect:
        # The COUNT form reconciles against the LIST form: the answer's figure must equal
        # the named view's row count.
        ref = call(f"/api/v1/admin/kg/views/{expect['countOfView']}/run", {})
        if not whole(ref, f"{label}: reference view {expect['countOfView']}", len(ref.get("rows", []))):
            continue
        want = float(len(ref.get("rows", [])))
        # Two honest shapes for a count question: the FIGURE, or the enumerated set itself
        # (view selection may route "how many X" to the roster view — 2 rows a reader counts
        # is a correct answer; 72 rows of something else was the defect this assertion killed).
        if rows and any(abs(c - want) < 1e-6 for c in numeric_cells(rows[0])):
            print(f"ok   {label}: counts {int(want)} — matches {expect['countOfView']}'s row count")
        elif len(rows) == int(want):
            print(f"ok   {label}: enumerates exactly the {int(want)} — the set is the count")
        else:
            fails.append(f"{label}: expected the count {int(want)} ({expect['countOfView']}'s rows); got {len(rows)} row(s): {rows[:1]}")
            print(f"FAIL {label}: {len(rows)} row(s) != count {int(want)}")
    elif "matchesView" in expect:
        # BRACKETED reconciliation: some figures are live counters (petition signatures move
        # while you read them), so the view is invoked BEFORE and AFTER the ask and the answer
        # must be a reading of the same counter — within [min, max] of the two references.
        # For static figures the bracket collapses to equality.
        mv = expect["matchesView"]
        # Params nest under "args": an un-nested body is ACCEPTED and the view's
        # defaults quietly apply, so a reconciliation would compare against the wrong
        # invocation and still pass.
        args = {"args": mv["args"]} if mv.get("args") else {}
        try:
            ref_before = call(f"/api/v1/admin/kg/views/{mv['name']}/run", args)
            d = call("/api/v1/admin/kg/ask", {"question": q})
            rows = d.get("rows", [])
            ref_after = call(f"/api/v1/admin/kg/views/{mv['name']}/run", args)
            # Each of the three readings is flagged on its own: a short one is no bracket end.
            short_seen = [not whole(r, f"{label}: {what}", len(r.get("rows", [])))
                          for r, what in ((ref_before, f"view {mv['name']} before"), (d, "ask"), (ref_after, f"view {mv['name']} after"))]
            if any(short_seen):
                continue
            before = top_figure(ref_before.get("rows", []), mv["column"])
            after = top_figure(ref_after.get("rows", []), mv["column"])
        except urllib.error.HTTPError as e:
            fails.append(f"{label}: view {mv['name']} unreachable: HTTP {e.code}")
            print(f"FAIL {label}: view {mv['name']} HTTP {e.code}")
            continue
        if before is None or after is None:
            fails.append(f"{label}: view {mv['name']} gave no {mv['column']} to reconcile against")
            print(f"FAIL {label}: no reference figure")
        elif not rows:
            fails.append(f"{label}: ask returned no rows; view {mv['name']} says {before}..{after}")
            print(f"FAIL {label}: empty vs {before}..{after}")
        else:
            # An optional percentage widens the bracket for figures fetched through DIFFERENT
            # producer-cache entries (the ask's query and the view carry different cache keys,
            # so a live counter can be read at two moments even inside the bracket).
            pct = float(mv.get("withinPct", 0)) / 100.0
            lo, hi = min(before, after) - 1e-6, max(before, after) + 1e-6
            lo, hi = lo - abs(lo) * pct, hi + abs(hi) * pct
            if not any(lo <= c <= hi for c in numeric_cells(rows[0])):
                fails.append(f"{label}: top row {rows[0]} carries no figure in {mv['name']}.{mv['column']} bracket [{before}, {after}]")
                print(f"FAIL {label}: {rows[0]} not in [{before}, {after}]")
            else:
                print(f"ok   {label}: reconciles with {mv['name']}.{mv['column']} in [{before}, {after}]")
    elif expect.get("nonEmpty") or "minRows" in expect:
        need = expect.get("minRows", 1)
        if len(rows) >= need:
            print(f"ok   {label}: {len(rows)} row(s)")
        else:
            fails.append(f"{label}: {len(rows)} row(s), needed {need}; hint={str(d.get('hint'))[:100]}")
            print(f"FAIL {label}: {len(rows)} row(s), needed {need}")

# ── 3. ADVERSARIAL ─────────────────────────────────────────────────────────────────
schema = call("/api/v1/admin/kg/schema") if FULL else {"labels": []}
props_by_label = {l["label"].lower(): {p["name"].lower() for p in l["properties"]}
                  for l in schema["labels"] if l["properties"]}
VAR_LABEL = re.compile(r"\((\w+)\s*:\s*(\w+)")
VAR_PROP = re.compile(r"\b(\w+)\.(\w+)\b")
ALIAS = re.compile(r"\bAS\s+([A-Za-z_][A-Za-z0-9_]*)", re.I)

def fabricated(cypher):
    v2l = {m.group(1).lower(): m.group(2).lower() for m in VAR_LABEL.finditer(cypher)}
    return sorted({f"{m.group(1)}.{m.group(2)}" for m in VAR_PROP.finditer(cypher)
                   if (p := props_by_label.get(v2l.get(m.group(1).lower())))
                   and m.group(2).lower() not in p})

def alias_tokens(alias):
    parts = []
    for chunk in alias.split("_"):
        parts += re.split(r"(?<=[a-z0-9])(?=[A-Z])", chunk)
    return sorted({t for t in (re.sub(r"[^a-z]", "", p.lower()) for p in parts) if len(t) >= 4})

def mentions(text, token):
    return token[: max(4, len(token) - 2)] in text

def unearned(cypher, question):
    aliases = ALIAS.findall(cypher)
    ground = ALIAS.sub("AS _", cypher)
    for a in set(aliases):
        ground = re.sub(r"(?<![.\w])" + re.escape(a) + r"(?![\w])", "_", ground, flags=re.I)
    ground = ground.lower()
    q = question.lower()
    return [a for a in aliases
            if any(mentions(q, t) and not mentions(ground, t) for t in alias_tokens(a))]

ADVERSARIAL = [
    "which of all constituencies has the highest asian population",
    "which constituencies have the highest proportion of asians",
    "which of my places has the largest land area",
    "what are the school ratings near my places",
    # Not unanswerable — the regression view holds the answer — but its 'constituency'
    # wording is a standing alias trap, so it earns the repeated fabrication checks.
    "what are the best predictors of crime in a constituency, use linear algebra",
]
for q in (ADVERSARIAL if FULL else []):
    for i in range(runs):
        d = call("/api/v1/admin/kg/ask", {"question": q})
        label = f"adversarial [{q[:44]}] run {i + 1}"
        cypher, warns = d.get("cypher") or "", " ".join(d.get("warnings") or [])
        if d.get("reason"):
            print(f"ok   {label}: refusal {d['reason']}")
            continue
        fab = fabricated(cypher)
        une = unearned(cypher, q)
        if fab:
            fails.append(f"{label}: FABRICATED {fab}: {cypher[:160]}")
            print(f"FAIL {label}: fabricated {fab}")
        elif une and "overstate" not in warns:
            fails.append(f"{label}: UNEARNED unflagged {une}: {cypher[:160]}")
            print(f"FAIL {label}: unearned {une}")
        else:
            note = " (flagged)" if une else ""
            print(f"ok   {label}: honest{note}, rows={d.get('rowCount')}")

# ── SOURCE: L2 against NOMIS, L3 one call ─────────────────────────────────────────
# Median full-time pay (ASHE) for every Westminster seat: through the realm read cold
# (`ai: {fresh: true}`), and from NOMIS directly with the producer's own arguments.
NOMIS = ("https://www.nomisweb.co.uk/api/v01/dataset/NM_30_1.data.json?"
         "geography=TYPE172&sex=8&item=2&pay=7&measures=20100&time=latest")
with urllib.request.urlopen(NOMIS, timeout=120) as r:
    want = {o["geography"]["geogcode"]: float(o["obs_value"]["value"]) for o in json.load(r)["obs"]
            if isinstance(o["obs_value"]["value"], (int, float))}
d = call("/api/v1/admin/kg/execute", {"cypher":
    "MATCH (u:UkConstituencies {set:'westminster-2024'})-[:HAS_CONSTITUENCY_PAY {ai: {fresh: true}}]->(cp:ConstituencyPay) "
    "RETURN cp.constituencyCode AS code, toFloat(cp.annualPay) AS pay"})
# A short read is the source's or the engine's say-so that seats are missing: flagged, not compared.
whole(d, "source: constituency pay", len(d.get("rows", [])))
got = {r["code"]: r["pay"] for r in d.get("rows", []) if r.get("pay") is not None}
diff = {k: (got.get(k), want.get(k)) for k in set(got) | set(want) if got.get(k) != want.get(k)}
ok = not diff and len(got) > 600
print(f"{'ok  ' if ok else 'FAIL'} source: pay for {len(got)} seats = NOMIS's {len(want)}" + ("" if ok else f"  {dict(list(diff.items())[:3])}"))
if not ok:
    fails.append(f"source: constituency pay differs from NOMIS on {len(diff)} seat(s)")
calls = d.get("apiCalls")
print(f"{'ok  ' if calls == 1 else 'FAIL'} source: every seat's pay in {calls} source call(s)")
if calls != 1:
    fails.append(f"source: constituency pay took {calls} calls, not 1")

print()
if fails:
    print(f"{len(fails)} FAILURE(S):")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("ALL CHECKS PASS")
PY
