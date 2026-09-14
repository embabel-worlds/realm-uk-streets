# tests/

- **`questions.yml` + `verify.sh`** — the natural-language battery and the harness that replays
  it, plus an adversarial pass (questions the data cannot answer, repeated, schema-checked).
  `EMBABEL_AUTH=user:pass tests/verify.sh`

- **`crime-predictors.spec.mjs`** — drives `apps/crime-predictors.html` in a real browser against
  `fixtures/` captured from live view runs. curl cannot click, and this app's whole safety
  property is an interaction: the ALONE figure must never render without its IN-MODEL figure.
  `npx playwright install chromium` once, then `node --test tests/crime-predictors.spec.mjs`.

  Re-capture fixtures after changing the model view:

      curl -s -u $EMBABEL_AUTH -X POST localhost:11043/api/v1/tools/view_run \
        -H 'content-type: application/json' \
        -d '{"name":"CrimeModelWithPredictors","params":{...}}' \
      | python3 -c 'import json,sys; json.dump(json.load(sys.stdin)["result"], open("fixtures/<name>.json","w"), indent=1)'

  Store the **unwrapped** envelope: the browser shim returns `body.result`, so a fixture of the
  wrapped shape would test a contract the app never meets.
