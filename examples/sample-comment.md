<!-- promotion-gatekeeper -->
### 🛑 Blocked: `dev` → `uat`

- Merge conflict in 1 file
- 1 change with failing CI
- 1 untested change (no CI results)
- 2 changes missing backports to lower environments

| | Changes |
|---|---:|
| Included in this promotion | 4 |
| ✅ Tested | 2 |
| ❔ Untested | 1 |
| ⏳ Pending | 0 |
| ❌ Failed | 1 |
| Already in target via backport | 1 |

#### Changes needing attention

| Status | Commit | Change | Details |
|---|---|---|---|
| ❌ Failed | [`f5ddf1c`](https://github.com/example/demo-app/commit/f5ddf1cc777f7cdd48520bf89209d0068d676678) | feat: add export to CSV | test |
| ❔ Untested | [`7fbb0f4`](https://github.com/example/demo-app/commit/7fbb0f4989977a1f07a8bc4d388bd31dfde345a8) | feat: add dark mode toggle |  |

#### Conflicting files

- `app.txt`

#### Next hop: `uat` → `prod`

- Not previewed: this promotion already conflicts.

#### Missing backports (in a higher environment, absent from a lower one)

- [`558faaa`](https://github.com/example/demo-app/commit/558faaa4a3b7930554c52316f0ae76ba80c18d83) uat: tweak line 2 in app.txt (in `uat`; missing from `dev`)
- [`4978766`](https://github.com/example/demo-app/commit/49787661b7061b3f36f5ab34f1f0988b246fcb1a) hotfix: patch session expiry (in `prod`; missing from `dev`, `uat`)

<sub>Advisory, deterministic analysis: no AI involved. Computed for `2360687`.</sub>
