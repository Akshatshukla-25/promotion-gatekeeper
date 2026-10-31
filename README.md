# Promotion Gatekeeper

A dependency-free GitHub Action for repos that promote code through environment branches (default `dev` → `uat` → `prod`). On every promotion pull request it answers four questions:

1. **What is in each environment?** A cross-environment ledger tracks each change by patch-id, so cherry-picks and backports are recognised even though their SHAs differ.
2. **Which changes are tested?** CI results are read per commit (check runs and commit statuses).
3. **What happens if I promote now?** A `git merge-tree` dry run reports conflicts, and previews the next hop (for example uat → prod).
4. **What is missing?** Changes present in a higher environment but absent from a lower one are listed as missing backports.

It posts one sticky comment, sets a `promotion-gatekeeper` commit status, and writes a report (`report.html`, `report.json`, `ledger.md`). The analysis is deterministic and advisory. It uses no AI and no network access other than the GitHub API.

See `examples/preview.html` and `examples/report.html` for what it looks like.

## Quick start

Copy `examples/consumer-workflow.yml` to `.github/workflows/promotion-gatekeeper.yml` in your repo, replace `OWNER`, and add the file to **every environment branch and the default branch**. The checkout step needs `fetch-depth: 0`.

## Inputs and outputs

| Input | Default | Meaning |
|---|---|---|
| `github-token` | `${{ github.token }}` | Reads checks, writes the comment and status |
| `environments` | `dev,uat,prod` | Environment branches, lowest to highest |
| `block-on-blocked` | `false` | `true` makes a Blocked verdict set the status to `failure` |
| `required-checks` | empty | Check or status names that define "tested" (all must pass) |
| `ignore-checks` | empty | Checks to disregard (`promotion-gatekeeper` is always ignored) |
| `report-dir` | `promotion-gatekeeper-report` | Where the report files are written |

Outputs: `verdict`, `report` (one-line JSON), `report-path`.

## Permissions

`contents: read`, `checks: read`, `pull-requests: write`, `statuses: write`. Pull requests from forks are skipped (their token is read-only).

## Verdicts

- **Blocked**: merge conflict, or any failing CI.
- **Caution**: untested or pending changes, missing backports, a conflicting next hop, or more than 100 commits (the rest are not checked).
- **Ready**: all changes tested, no conflicts, no missing backports.
- **Empty**: the target already has every change.

## How "tested" is defined

Strict and per commit: a commit is tested when all its checks passed (`neutral` and `skipped` count as passing). Because CI usually runs only on the pushed tip, an untested commit is shown as **tested by inference** when the next commit with CI results passed. A later failure is never inherited. With `required-checks` set, only those names count and all must be present and passing. Backport twins in the ledger inherit the best CI result of the group (failed > pending > tested > untested).

## Local use

```bash
node scripts/demo.js                      # seeds a demo repo, writes examples/
node src/cli.js --repo . --base uat --head dev --ci ci.json --ledger true
npm test
```

## Security model

Untrusted text (commit subjects, file and branch names) is stripped of control characters and escaped before it reaches the comment or the HTML report. The sticky comment is matched by marker and bot author, so a human pasting the marker cannot hijack it. Tokens are never logged. Requires git ≥ 2.38 and Node 24.

## Limits

- Twins are matched by patch-id. Squash merges and cherry-picks that needed conflict resolution change the patch, so they may not be linked.
- The merged result of a promotion is itself untested; a green verdict means each change passed, not their combination.
- Merge commits are not checked individually.
- GitHub Enterprise Server is supported through `GITHUB_API_URL` and `GITHUB_SERVER_URL`.

MIT licensed.
