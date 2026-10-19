# Final pull-request evidence

Use this workflow when a requested delivery needs concrete test results and
final videos, screenshots or photos. It does not run tests, create evidence,
close a work item, complete a PR or merge a branch. PR creation/update returns an
`unverified` checklist; prose in `validacoes` is not verified execution evidence.

1. Run the relevant checks with the project's real executor. Capture final
   scenario media only after the behavior is ready to review.
2. Call `tfs_prepare_pr_delivery` for the current source SHA, repository, PR and
   work item. Supply bounded reports/media under configured dedicated roots,
   their SHA256 hashes, and provenance: commit, executor, command, start/end UTC.
   CI evidence may retain its actual merge SHA when a supplied build matches the
   current repository and observed merge for the current source and target.
   Keep that provenance unchanged; do not relabel the merge as the source SHA.
   Historical/unassociated merges remain rejected.
   Use each report's optional bounded `label` to identify its suite/component in
   the concise table (for example `API unit` or `Android E2E`). Evidence from
   another repository or an unassociated commit belongs in its own PR; do not
   relabel its origin.
3. Review its evidence level, pending checks and digest. Change the files or PR
   source, target, status or observed merge tip: prepare again.
4. Call `tfs_publish_pr_delivery` with the same inputs, `plan_digest`,
   `evidence_level` and `final:true`. Use `dry_run:true` for a preview. High-impact
   targets retain the existing exact confirmation guard. Publish partial results
   explicitly when checks failed or remain unavailable; never label them green.

The public section uses a short commit, test-count table, readable media links
and pending checks. Full hashes and declared provenance remain in structured
preparation output and the private publication manifest. The PR and work-item
description each receive one managed section for this PR/work-item identity.
No progress thread or `System.History` entry is created. If discussion evidence
is enabled, one final receipt-owned comment is created and subsequently updated
in place. Existing manual review tools remain available for requested comments.

## Concise discussion and full work-item delivery

For an explicitly authorized full delivery, use the configured prefix for new
commits (`#{work_item_id}: ` by default), prepare a reviewable PR and publish
final evidence. This is guidance, not a Git executor: the MCP does not create
commits or run tests. Do not rewrite history. State, board column/lane/rank,
area and iteration remain unchanged; completion evidence never implies a board
transition, approval or PR merge.

Set `TFS_DELIVERY_DISCUSSION_ENABLED=true` to opt in. The default stays `false`
for installations without the Comments API. It uses the documented
[Comments Add](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/add?view=azure-devops-rest-7.0)
and [Update](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/comments/update?view=azure-devops-rest-7.0)
contracts (`7.0-preview.3`). An unsupported endpoint fails explicitly before
uploads, without falling back to noisy history entries.

The format is deliberately short:

- **Outcome:** one sentence (`summary`, optional, maximum 160 characters).
- **Tests:** suite counts from parsed reports; a successful build is insufficient.
- **Cases:** up to 12 `test_cases` with `title`, `result` (`passed`, `failed`,
  `blocked`) and `evidence_scenarios` referring to supplied media. These labels
  are caller-declared, not test execution inferred by this server.
- **Proof:** up to three inline images, readable media links, PR and short SHA.
- **Pending:** required checks that have not passed. Only verified evidence is
  titled validated; partial evidence remains explicitly partial.

Media may supply a readable `title`; `scenario` remains a stable ASCII identity.
Names become `Scenario - YYYY-MM-DD.mp4` (or the matching image extension).
The date comes from `provenance.finished_at` in `TFS_DELIVERY_TIME_ZONE`, not
publication time. `TFS_DELIVERY_LOCALE` supports `en` and `pt-BR` for discussion
labels. Configure installation preferences in ignored `.env`; tracked examples
remain neutral. Report hashes and upload receipts stay private. Renaming an
owned relation changes only its name attribute under revision control and reuses
the existing blob; unchanged media are not uploaded again. Do not remove and
re-add an identical attachment in one PATCH: some providers reject that as a
duplicate relation. Numeric image width uses the provider-stable HTML form.

The comment ID, author and intended content hashes are durable receipts.
Unknown POST outcomes never trigger a second POST: inspect the provider, then
pass `recovered_discussion_comment_id` whose full managed content matches the
saved intention. Lost PATCH responses are reconciled by readback. Changed or
deleted comments, unknown ownership and truncated discovery fail closed.
First publication inspects at most 100 recent comments; larger histories need
manual reconciliation. The publisher never deletes old comments or adopts a
human comment. Known IDs are read directly on later publications.

The Comments API has no documented cross-process CAS contract. Re-reads detect
known version/content changes before writing; readback detects mismatches.
This reduces races but cannot guarantee atomic protection against another
writer in the final interval. Stop and reconcile detected human edits rather
than automatically overwriting or re-appending.

For example, a final review could read: **Validated delivery** → “Draft resumes
at the confirmed step” → “Android: 8/8” → case/result/video → two screenshots.
Keep execution logs, exploratory failures and verbose chronology in private
artifacts. Historical notes may be retired only under specific authorization;
the generic publisher leaves them intact.

## Configuration and limits

`TFS_DELIVERY_ROOTS_JSON` defaults to `[]`, denying local evidence reads until
dedicated absolute roots are configured. Physical realpaths must stay inside a
root; symlink/junction escape, secret filenames (including quoted names),
credential/key files and non-files are rejected. Do not permit a home directory
or an entire source checkout. Media must be reviewed/redacted by the caller
(`redacted:true`); signature checking cannot detect secrets visible in a picture.

Default limits are 20 reports, 20 media files, 5 MiB per report, 25 MiB per media
file and 100 MiB total. Environment overrides and hard ceilings are listed in
`.env.example`. PNG/JPEG/WebP images and MP4/WebM videos require matching
extension, kind and binary signature. Media are uploaded as bounded octet
streams through the trusted TFS installation only, with timeouts and rejected
redirects. Reports are parsed locally and **never attached raw**. Original file
paths, test output, exception messages and command text are not published.

State defaults to ignored `data/delivery`, configurable with
`TFS_DELIVERY_STATE_DIRECTORY`. Each ledger is limited to 2 MiB; default ledger
quota is 1000 and append-only delivery audit quota is 10 MiB. Retain manifests
and receipts while attachments remain managed. Archive reviewed inactive state
privately before a quota is reached; automatic deletion would lose ownership
proof. Do not put state inside a public evidence root. File leases serialize
publishers across local processes; a crash leaves a lease requiring operator
inspection of its process and remote state before manual removal.

For isolated tests, use `TFS_MCP_LOAD_DOTENV=false`, a synthetic/absent
`TFS_MCP_CONFIG_FILE`, synthetic connection/PAT values and temporary roots. An
existing MCP client must reconnect to discover the two additional tools. No
client configuration or credentials are modified automatically.

## Report contracts and truthfulness

Reports are UTF-8 and accept these `format` values:

| Format | Required shape |
|---|---|
| `summary-json` | Strict `{ "schemaVersion":1, "total":2, "passed":2, "failed":0, "skipped":0 }` |
| `jest-json` | Jest aggregated counters (`numTotalTests`, `numPassedTests`, `numFailedTests`, `numPendingTests`, `success`); optional todo/runtime-error counters |
| `junit` | `testsuite`/`testsuites` containing concrete test cases, failure/error/skipped elements and consistent leaf totals |
| `trx` | `TestRun/Results/UnitTestResult` and `ResultSummary/Counters` with matching result counts/outcomes |

Counters are bounded to one million, JUnit nesting to 20, XML nesting to 32 and
top-level suites to 1000. DTD/entity declarations are rejected; XML entity
processing is disabled. The pinned parser's security options are described in
its [official repository](https://github.com/NaturalIntelligence/fast-xml-parser)
and [security advisories](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories).
File-size bounds are checked before parsing; malformed/incomplete reports fail.

- `unverified`: no report, media or observed build evidence.
- `partial`: failed, skipped, zero/runtime-error tests; stale/incomplete builds;
  missing required media; or explicit caller `limitations`.
- `verified`: parsed nonzero passing reports and declared requirements satisfied
  for the current commit, with no recorded pending checks. This describes the
  supplied evidence, not independent proof that a command actually executed.

Hashes prove byte identity. Provenance is mandatory and caller-declared, not
cryptographic proof of execution. The server never promises a test runner.
Observed build runs must match the repository and exact current source SHA or
the PR's observed merge tip associated with that source. Same PR ID, branch,
historical merge SHA or successful build alone do not prove current tests ran.

Use `required_scenarios` and `require_video_per_scenario:true` when each declared
scenario needs a separate video. Reusing the same video hash for different
required scenarios leaves the plan partial. A successful build without a parsed
test report also leaves it partial. Supply `limitations` for checks outside the
available executor or evidence scope.

## Safe publication and recovery

The attachment API follows Microsoft's
[bounded binary-upload contract](https://learn.microsoft.com/en-us/rest/api/azure/devops/wit/attachments/create?view=azure-devops-rest-7.1).
Project-name, current-project-GUID and collection receipt URLs are checked
against the trusted installation. The permitted project GUID comes from the
observed PR repository, never an arbitrary UUID; receipts normalize to the
configured project-name URL. Private reused receipts/ownership records are
validated again before linking. Malformed ledgers fail closed;
credentials are never redirected. Uploads have no automatic retry.

A private ledger key binds installation, collection/project, repository, PR and
work item. Per-upload keys additionally bind source SHA, scenario, media kind
and content SHA. Known receipts are reused across retries. New files are
uploaded first; a revision-tested work-item patch replaces only relations
matching this ledger's trusted installation/project/attachment identity and
exact marker and filename. Project-name, authoritative project-GUID and
collection URL forms identify the same attachment; a matching UUID alone does
not establish ownership. Humans and other
PRs are preserved. Blobs are never deleted. The PR description is re-read and
verified; its provider API has no cross-process CAS guarantee, so concurrent
human changes can require reconciliation instead of an atomic-transaction claim.
Duplicate equivalent owned relations also require reconciliation; the publisher
does not adopt or remove duplicates automatically.

If an upload response is lost, publication returns `partial` and refuses to send
it again. Obtain the actual stored attachment identifier through authorized
provider inspection, then supply
`recovered_uploads:[{ "sha256":"<64 hex characters>", "attachment_id":"<uuid>" }]`.
Recovery downloads only that scoped attachment with byte/time bounds and verifies
its content hash before using it. Do not guess identifiers or delete blobs.
Without an observed receipt, the interrupted upload remains pending.

The PR's Markdown section uses comment markers. The work item's HTML section
uses links to that same work item, with begin/end fragments in its heading and
footer, so comment stripping does not remove ownership boundaries. Within that
owned HTML section only, reconciliation tolerates ASCII whitespace inserted
before closing `p`, `h3`, `td` and `th` tags and equivalent scoped attachment
URLs. Code/preformatted content, meaningful text, attributes and human content
outside the section remain exact. Missing, duplicated or foreign markers fail
closed.
Descriptions and generated replacements are limited to 256 KiB of UTF-8.
HTML scanning advances through bounded tokens, including malformed or unclosed
tags; unsupported input fails closed rather than triggering unbounded rescans.

Lost work-item/PR PATCH responses are reconciled by re-reading the managed
section and scoped relations. If a provider strips markers or a section becomes
ambiguous, the durable ledger blocks automatic reappend. Restore the reviewed
remote section/relations using the private intended hashes/receipts, then rerun;
do not remove the ledger or silently turn an unknown write into a second section.
Legacy ambiguous records retain their original exact hashes; the publisher
does not infer or silently migrate a stripped section. New work-item writes
record the `work-item-html-v1` normalization version in private state. If the
provider also removes the persistent links, the field remains unsupported
until the reviewed remote content can be restored.
Audit/state failures stop publication or explicitly return partial; never claim
that a partially applied PR/work-item update finished successfully.
