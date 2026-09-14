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
# Usage:  EMBABEL_AUTH=user:pass [APPLIANCE_BASE=http://localhost:11043] [ADVERSARIAL_RUNS=3] tests/verify.sh
# Refuses to run without EMBABEL_AUTH — a harness that assumes credentials will
# eventually hammer someone else's box.
set -euo pipefail
cd "$(dirname "$0")"

: "${EMBABEL_AUTH:?set EMBABEL_AUTH=user:pass for the target appliance}"
BASE="${APPLIANCE_BASE:-http://localhost:11043}"
RUNS="${ADVERSARIAL_RUNS:-3}"

python3 - "$BASE" "$EMBABEL_AUTH" "$RUNS" <<'PY'
import base64, json, re, sys, time, urllib.request, urllib.error

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
        err = d.get("error")
        if err:
            fails.append(f"view {name}: error {err[:120]}")
            print(f"FAIL view {name}: {err[:120]}")
        else:
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

for item in questions:
    q, expect = item["question"], item["expect"]
    label = f"battery [{q[:48]}]"
    if "matchesView" not in expect:
        d = call("/api/v1/admin/kg/ask", {"question": q})
        rows = d.get("rows", [])
    if "matchesView" in expect:
        # BRACKETED reconciliation: some figures are live counters (petition signatures move
        # while you read them), so the view is invoked BEFORE and AFTER the ask and the answer
        # must be a reading of the same counter — within [min, max] of the two references.
        # For static figures the bracket collapses to equality.
        mv = expect["matchesView"]
        args = mv.get("args") or {}
        before = top_figure(call(f"/api/v1/admin/kg/views/{mv['name']}/run", args).get("rows", []), mv["column"])
        d = call("/api/v1/admin/kg/ask", {"question": q})
        rows = d.get("rows", [])
        after = top_figure(call(f"/api/v1/admin/kg/views/{mv['name']}/run", args).get("rows", []), mv["column"])
        if before is None or after is None:
            fails.append(f"{label}: view {mv['name']} gave no {mv['column']} to reconcile against")
            print(f"FAIL {label}: no reference figure")
        elif not rows:
            fails.append(f"{label}: ask returned no rows; view {mv['name']} says {before}..{after}")
            print(f"FAIL {label}: empty vs {before}..{after}")
        else:
            lo, hi = min(before, after) - 1e-6, max(before, after) + 1e-6
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
schema = call("/api/v1/admin/kg/schema")
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
]
for q in ADVERSARIAL:
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

print()
if fails:
    print(f"{len(fails)} FAILURE(S):")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("verify: all green")
PY
