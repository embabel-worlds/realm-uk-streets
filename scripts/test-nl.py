#!/usr/bin/env python3
"""Run the NL expectations in tests/nl-queries.md against a live world.

  EMBABEL_URL=http://localhost:11043 EMBABEL_USER=rod EMBABEL_PASS=... python3 scripts/test-nl.py

Prints each question, the generated cypher and the first rows — grading is
yours (or an LLM's); the table in tests/nl-queries.md states what counts.
"""
import base64, json, os, urllib.request

URL = os.environ.get('EMBABEL_URL', 'http://localhost:11043')
auth = 'Basic ' + base64.b64encode(
    f"{os.environ['EMBABEL_USER']}:{os.environ['EMBABEL_PASS']}".encode()).decode()

QUESTIONS = [
    "Which of my UK places has the highest income level?",
    "Which of my places has the best school coverage?",
    "Which of my places has many schools but below-average income?",
    "Which Labour seats among my places have the lowest crime?",
    "What do homes actually sell for near my places?",
    "Which of my places is in a marginal seat?",
    "Where have house prices fallen fastest?",
]

for q in QUESTIONS:
    req = urllib.request.Request(f'{URL}/api/v1/admin/kg/ask', method='POST',
        data=json.dumps({"question": q}).encode(),
        headers={'Authorization': auth, 'Content-Type': 'application/json'})
    d = json.loads(urllib.request.urlopen(req, timeout=290).read())
    print(f"\nQ: {q}")
    print(f"  rows={d.get('rowCount')} apiCalls={d.get('apiCalls')} error={d.get('error')}")
    print("  cypher:", (d.get('cypher') or '').replace('\n', ' ')[:180])
    for r in (d.get('rows') or [])[:4]:
        print("   ", json.dumps(r, ensure_ascii=False)[:200])
