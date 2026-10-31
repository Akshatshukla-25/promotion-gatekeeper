### Cross-environment ledger

Environments: `dev` → `uat` → `prod`. ✅ present · ♻️ patch-equivalent twin present · — absent · ▶ included in this PR. Changes present everywhere are omitted.

| | Change | Commit | dev | uat | prod | CI | Cherry-pick check |
|---|---|---|---|---|---|---|---|
| ▶ | feat: add search box | [`cce19a2`](https://github.com/example/demo-app/commit/cce19a2b159eff054019752bc9dfabb8aedbe7aa) | ✅ | — | — | ✅ tested | clean on uat |
| ▶ | feat: add dark mode toggle | [`7fbb0f4`](https://github.com/example/demo-app/commit/7fbb0f4989977a1f07a8bc4d388bd31dfde345a8) | ✅ | — | — | ❔ untested | clean on uat |
| ▶ | feat: add export to CSV | [`f5ddf1c`](https://github.com/example/demo-app/commit/f5ddf1cc777f7cdd48520bf89209d0068d676678) | ✅ | — | — | ❌ failed | clean on uat |
| ▶ | feat: reword line 2 in app.txt | [`2360687`](https://github.com/example/demo-app/commit/23606878f91039e2f51b495d3d362dac6f928f81) | ✅ | — | — | ✅ tested | ⚠️ conflicts on uat: `app.txt` |
|  | fix: handle empty input | [`983c586`](https://github.com/example/demo-app/commit/983c5867735250ed662dccc8dfdde52dee7db2bb) | ✅ | ✅ | — | ✅ tested (twin c33fbac) | clean on prod |
|  | uat: tweak line 2 in app.txt | [`558faaa`](https://github.com/example/demo-app/commit/558faaa4a3b7930554c52316f0ae76ba80c18d83) | — | ✅ | — | ❔ untested | ⚠️ conflicts on dev: `app.txt` |
|  | hotfix: patch session expiry | [`4978766`](https://github.com/example/demo-app/commit/49787661b7061b3f36f5ab34f1f0988b246fcb1a) | — | — | ✅ | ❔ untested | clean on dev |
