# Issue tracker

Couch's work is tracked in GitHub Issues: https://github.com/abdullahnettoor/couch/issues. Use the `gh` CLI.

## Labels

Every issue gets one scope label and one triage label.

- **Scope:** `app` (the Couch app: Electron, native code, the Listener, the Remote) or `site` (the landing page in `site/`).
- **Triage:**
  - `ready-for-agent`: fully specified, so an agent can pick it up.
  - `ready-for-human`: needs the maintainer (accounts, purchases, real hardware).
  - `needs-triage`: needs planning first.
- **Extra:** `parked` (deliberately on hold; skip it unless asked), `bug`, `enhancement`.

## Operations

- **Create:** `gh issue create --title … --label <scope> --label <triage> --body-file …`. Create blockers first.
- **Blocking edges:** use GitHub's native dependencies:
  `gh api -X POST repos/abdullahnettoor/couch/issues/<n>/dependencies/blocked_by -F issue_id=<blocker's id>`.
  Get the blocker's id from `gh api repos/abdullahnettoor/couch/issues/<blocker> --jq .id`.
- **Sub-issues:** when tickets are cut from a parent spec issue, add each one as a sub-issue of it. Never close or edit the parent.
- **Claim:** assign yourself before starting (`gh issue edit <n> --add-assignee @me`).
- **Frontier:** `gh issue list --label ready-for-agent --state open`, leaving out `parked` issues and issues that still have open blockers.

## Household checks

Manual checks that need a person, a real phone, the TV or a Netflix account aren't issues. They stay in the household's local checklist.
