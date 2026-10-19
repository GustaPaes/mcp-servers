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
   Use each report's optional bounded `label` to identify its suite/component in
   the concise table (for example `API unit` or `Android E2E`). Evidence from a
   different repository/commit belongs in its own PR; do not relabel its origin.
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
No progress thread or `System.History` entry is created. Existing manual review
comment tools remain available when the user explicitly requests a comment.

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
matching both this ledger and this automation's exact marker. Humans and other
PRs are preserved. Blobs are never deleted. The PR description is re-read and
verified; its provider API has no cross-process CAS guarantee, so concurrent
human changes can require reconciliation instead of an atomic-transaction claim.

If an upload response is lost, publication returns `partial` and refuses to send
it again. Obtain the actual stored attachment identifier through authorized
provider inspection, then supply
`recovered_uploads:[{ "sha256":"<64 hex characters>", "attachment_id":"<uuid>" }]`.
Recovery downloads only that scoped attachment with byte/time bounds and verifies
its content hash before using it. Do not guess identifiers or delete blobs.
Without an observed receipt, the interrupted upload remains pending.

Lost work-item/PR PATCH responses are reconciled by re-reading the managed
section and exact relations. If a provider strips markers or a section becomes
ambiguous, the durable ledger blocks automatic reappend. Restore the reviewed
remote section/relations using the private intended hashes/receipts, then rerun;
do not remove the ledger or silently turn an unknown write into a second section.
If server-side HTML sanitization prevents marker preservation, this feature is
incompatible with that field until a supported persistent marker is available.
Audit/state failures stop publication or explicitly return partial; never claim
that a partially applied PR/work-item update finished successfully.
