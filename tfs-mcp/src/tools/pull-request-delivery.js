import { getTfsScope, TFS_URL, DELIVERY_CONFIG, buildProjectUrl } from "../config.js";
import { getRequestContext } from "../request-context.js";
import { tfsGet, tfsPatch, tfsUploadAttachment, tfsReadAttachment } from "../tfs-client.js";
import { buildMutationPlan, detectHighImpact, executeGuardedMutation, normalizeMutationControls } from "../safety.js";
import { DeliveryInput, PublishDeliveryInput } from "../delivery-contract.js";
import { hash, hashObject, inspectEvidence, replaceManagedSection, sectionMarker, guardSectionReplay, beginSectionWrite } from "../evidence-manifest.js";
import { withDeliveryState } from "../delivery-state.js";
import { reconcileDeliveryWorkItem, deliveryAttachmentCount } from "./work-item-attachments.js";
import { evidenceAttachmentName, renderDiscussion } from '../delivery-presentation.js';
import { preflightDiscussion, reconcileDeliveryDiscussion } from './work-item-discussion.js';

const prPath = (input) => `/git/repositories/${encodeURIComponent(input.repo)}/pullrequests/${input.pull_request_id}`;
const envelope = (data, warnings = []) => ({ data, meta: { testsExecutedByServer: false }, warnings });
const boardPlacement = (item) => Object.fromEntries(Object.entries(item.fields ?? {}).filter(([key]) =>
  /^System\.(?:State|AreaPath|IterationPath|BoardColumn|BoardColumnDone|BoardLane)$/.test(key)
  || /^WEF_.*_Kanban\.(?:Column|Column\.Done|Lane)$/.test(key)
  || /^Microsoft\.VSTS\.Common\.(?:StackRank|BacklogPriority)$/.test(key)));
export function deliveryChecklist(workItemId) {
  return { evidenceLevel: 'unverified', next: ['Run the relevant tests using a real executor.',
    'Prepare current-commit reports and final scenario media with tfs_prepare_pr_delivery.',
    'Publish once with tfs_publish_pr_delivery; explicitly declare any partial evidence.',
    `For an authorized full work-item delivery, prefix new commits with ${DELIVERY_CONFIG.commitPrefix.replaceAll('{work_item_id}', workItemId ?? '{work_item_id}')} and preserve its board position, state, area and iteration.`,
    'Use a concise final discussion with tested cases, results and concrete media when discussion publishing is enabled; never post progress notes for each adjustment.'] };
}
async function observe(input) {
  const pr = await tfsGet(prPath(input));
  if (!pr.repository?.id || !pr.sourceRefName?.startsWith('refs/heads/') || !pr.targetRefName?.startsWith('refs/heads/')) throw new Error("PR repository/source/target identity missing.");
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(pr.repository.project?.id ?? '')) throw new Error("PR project identity is missing; cannot validate attachment receipt scope.");
  const refs = await tfsGet(`/git/repositories/${encodeURIComponent(pr.repository.id)}/refs`, { filter: pr.sourceRefName.slice(5), '$top': 2 });
  const ref = refs.value?.find((entry) => entry.name === pr.sourceRefName);
  if (!ref || ref.objectId !== input.source_sha) throw new Error("PR source changed; prepare evidence for its current commit.");
  const targetRefs = await tfsGet(`/git/repositories/${encodeURIComponent(pr.repository.id)}/refs`, { filter: pr.targetRefName.slice(5), '$top': 2 });
  const targetRef = targetRefs.value?.find((entry) => entry.name === pr.targetRefName);
  if (!targetRef?.objectId) throw new Error("PR target branch is missing.");
  const mergeSha = pr.lastMergeSourceCommit?.commitId === ref.objectId
    && pr.lastMergeTargetCommit?.commitId === targetRef.objectId ? (pr.lastMergeCommit?.commitId ?? null) : null;
  const builds = [];
  for (const id of input.build_ids) {
    const build = await tfsGet(`/build/builds/${id}`);
    const matching = build.repository?.id?.toLowerCase() === pr.repository.id.toLowerCase()
      && [ref.objectId, mergeSha].filter(Boolean).includes(build.sourceVersion);
    builds.push({ id, matching, sourceSha: build.sourceVersion ?? null, status: build.status ?? 'unknown', result: build.result ?? 'unknown' });
  }
  return { pr, sourceSha: ref.objectId, mergeSha, builds, placement: {
    repository: pr.repository.id, projectId: pr.repository.project.id, sourceRef: pr.sourceRefName, targetRef: pr.targetRefName,
    targetSha: targetRef.objectId, status: pr.status ?? 'unknown',
  } };
}
async function prepare(input) {
  const observed = await observe(input);
  const mergeBuild = observed.builds.some((build) => build.matching && build.sourceSha === observed.mergeSha);
  const files = await inspectEvidence(input, [input.source_sha, ...(mergeBuild ? [observed.mergeSha] : [])]);
  const pending = input.limitations.map((item) => `Declared limitation: ${item}`);
  for (const item of input.test_cases) {
    if (item.evidence_scenarios.some((scenario) => !files.media.some((media) => media.scenario === scenario))) throw new Error('A test case references missing evidence media.');
    if (item.result !== 'passed') pending.push(`Test case ${item.result}: ${item.title}.`);
  }
  if (!files.reports.length) pending.push('No current-commit parsed test report. A successful build alone does not prove tests ran.');
  if (files.reports.some((item) => !item.counts.total || item.counts.failed || item.counts.executionFailed)) pending.push('Tests contain failures, runtime errors or zero executed cases.');
  if (files.reports.some((item) => item.counts.skipped)) pending.push('Some reported tests were skipped.');
  if (observed.builds.some((build) => !build.matching || build.status !== 'completed' || build.result !== 'succeeded')) pending.push('A pipeline run is stale, incomplete or unsuccessful.');
  for (const scenario of input.required_scenarios) {
    if (!files.media.some((item) => item.scenario === scenario && (!input.require_video_per_scenario || item.kind === 'video'))) pending.push(`Missing final media for scenario: ${scenario}.`);
  }
  if (input.require_video_per_scenario) {
    const videos = input.required_scenarios.map((scenario) => files.media.find((item) => item.scenario === scenario && item.kind === 'video')?.sha256).filter(Boolean);
    if (new Set(videos).size !== videos.length) pending.push('Each required scenario needs a distinct video.');
  }
  const evidenceLevel = pending.length ? (files.reports.length || observed.builds.length || files.media.length ? 'partial' : 'unverified') : 'verified';
  const scope = getTfsScope();
  const identity = { installation: TFS_URL, collection: scope.collection.toLowerCase(), project: observed.pr.repository.project.id.toLowerCase(),
    repository: observed.pr.repository.id.toLowerCase(), pullRequestId: input.pull_request_id, workItemId: input.work_item_id };
  const key = hashObject(identity);
  const manifest = { schemaVersion: 1, identity, placement: observed.placement, sourceSha: input.source_sha, mergeSha: observed.mergeSha,
    summary: input.summary, testCases: input.test_cases,
    pullRequestUrl: buildProjectUrl(`/_git/${encodeURIComponent(observed.pr.repository.id)}/pullrequest/${input.pull_request_id}`),
    presentation: { locale: DELIVERY_CONFIG.locale, timeZone: DELIVERY_CONFIG.timeZone, discussion: DELIVERY_CONFIG.discussionEnabled },
    requirements: { scenarios: input.required_scenarios, videoPerScenario: input.require_video_per_scenario },
    reports: files.reports, media: files.media, builds: observed.builds, evidenceLevel, pending };
  return { observed, files, key, manifest, digest: hashObject(manifest) };
}
export async function toolPreparePRDelivery(args) {
  const input = DeliveryInput.parse(args);
  const result = await prepare(input);
  return envelope({ planDigest: result.digest, evidenceLevel: result.manifest.evidenceLevel,
    placement: result.observed.placement, mergeSha: result.observed.mergeSha,
    sourceSha: input.source_sha, pending: result.manifest.pending, reports: result.files.reports,
    media: result.files.media, builds: result.observed.builds,
    checklist: deliveryChecklist(input.work_item_id).next }, ['Local provenance is caller-declared; hashes prove file identity, not the truth of a test execution.']);
}
const escape = (value) => String(value).replace(/[&<>"']/g, (item) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[item]);
function renderDelivery(result, level, attachments, html = false) {
  const title = `Evidências — ${level}`, commit = result.manifest.sourceSha.slice(0, 12);
  const rows = result.manifest.reports.map((entry) => [entry.label ?? entry.format, entry.counts.passed, entry.counts.failed, entry.counts.skipped]);
  const notes = [...result.manifest.builds.map((entry) => `Build ${entry.id}: ${entry.status}/${entry.result}${entry.matching ? '' : ' (stale)'}.`),
    ...result.manifest.pending.map((entry) => `Pending: ${entry}`)];
  const provenanceNote = 'Relatórios conferidos; execução e origem declaradas pelo solicitante. O servidor não executa testes.';
  if (html) return `<h3>${title}</h3><p>Commit: ${commit}</p>`
    + (rows.length ? '<table><tr><th>Testes</th><th>Aprovados</th><th>Falhos</th><th>Ignorados</th></tr>' + rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('') + '</table>' : '')
    + notes.map((line) => `<p>${escape(line)}</p>`).join('')
    + attachments.map((entry) => `<p><a href="${escape(entry.url)}">${escape(entry.name)}</a></p>`).join('')
    + `<p>${provenanceNote}</p>`;
  const markdown = (value) => String(value).replace(/[\\`*_{}[\]()#+.!<>]/g, '\\$&');
  return [`### ${title}`, `Commit: \`${commit}\``,
    ...(rows.length ? ['| Testes | Aprovados | Falhos | Ignorados |\n|---|---:|---:|---:|\n' + rows.map((row) => `| ${row.join(' | ')} |`).join('\n')] : []),
    ...notes.map(markdown), attachments.map((entry) => `- [${markdown(entry.name)}](<${entry.url}>)`).join('\n'), provenanceNote].filter(Boolean).join('\n\n');
}
async function recheckPlacement(input, result) {
  const observed = await observe(input);
  if (hashObject(observed.placement) !== hashObject(result.manifest.placement) || observed.mergeSha !== result.manifest.mergeSha) {
    throw new Error("PR target/source/status or merge tip changed; prepare and review a fresh delivery plan.");
  }
  return observed;
}
async function publish(input, result) {
  return withDeliveryState(result.key, async ({ state, save, audit }) => {
    await audit({ stage: 'publishing', digest: result.digest, sourceSha: input.source_sha });
    const attachments = [];
    try {
      await recheckPlacement(input, result);
      const wiCurrent = await tfsGet(`/wit/workitems/${input.work_item_id}`, { '$expand': 'relations' });
      if (DELIVERY_CONFIG.discussionEnabled) await preflightDiscussion({ id: input.work_item_id, key: result.key,
        state, save, projectId: result.observed.placement.projectId, recoveredId: input.recovered_discussion_comment_id });
      if (state.ambiguousRelations) {
        if (!state.pendingAttachments?.length || !state.pendingAttachments.every((entry) => deliveryAttachmentCount(wiCurrent.relations ?? [], entry, { projectId: result.observed.placement.projectId }) === 1)) {
          throw new Error("Attachment markers are ambiguous; restore reviewed relations before retrying publication.");
        }
        state.ambiguousRelations = false;
        await save();
      }
      await guardSectionReplay(String(wiCurrent.fields?.['System.Description'] ?? ''), result.key, 'workItem', state, save,
        { workItemId: input.work_item_id, projectId: result.observed.placement.projectId });
      const prCurrent = await observe(input);
      await guardSectionReplay(prCurrent.pr.description ?? '', result.key, 'pullRequest', state, save);
      state.lastManifest = result.manifest;
      await save();
      for (const [index, entry] of result.files.media.entries()) {
        const receiptKey = hashObject({ source: input.source_sha, scenario: entry.scenario, kind: entry.kind, sha256: entry.sha256 });
        let receipt = state.receipts[receiptKey];
        if (receipt?.stage === 'uploading') {
          const recovery = input.recovered_uploads.find((item) => item.sha256 === entry.sha256);
          if (!recovery) throw new Error("Upload outcome unknown; supply its observed attachment_id for hash-verified recovery, never retry blindly.");
          const recovered = await tfsReadAttachment(recovery.attachment_id, DELIVERY_CONFIG.maxMediaBytes);
          if (hash(recovered.bytes) !== entry.sha256) throw new Error("Recovered attachment hash mismatch.");
          receipt = { stage: 'uploaded', id: recovery.attachment_id, url: recovered.url, sha256: entry.sha256 };
          state.receipts[receiptKey] = receipt;
          await save();
        }
        if (!receipt) {
          state.receipts[receiptKey] = { stage: 'uploading' };
          await save();
          try {
            receipt = { ...await tfsUploadAttachment(result.files.buffers[index], evidenceAttachmentName(entry), { projectId: result.observed.pr.repository.project.id }), stage: 'uploaded', sha256: entry.sha256 };
          } catch (error) {
            if (error.uploadRejected) { delete state.receipts[receiptKey]; await save(); }
            throw error;
          }
          state.receipts[receiptKey] = receipt;
          await save();
        }
        attachments.push({ url: receipt.url, name: evidenceAttachmentName(entry), sha256: entry.sha256,
          ...(entry.title ? { title: entry.title } : {}), capturedAt: entry.provenance.finishedAt, timeZone: DELIVERY_CONFIG.timeZone,
          scenario: entry.scenario, kind: entry.kind, marker: `${sectionMarker(result.key)}:${receiptKey}` });
      }
      // Recheck the source and description immediately before each publication stage.
      await recheckPlacement(input, result);
      const wi = await reconcileDeliveryWorkItem({ id: input.work_item_id, key: result.key,
        html: renderDelivery(result, input.evidence_level, attachments, true), attachments, state, save, projectId: result.observed.placement.projectId });
      const latest = await recheckPlacement(input, result);
      await guardSectionReplay(latest.pr.description ?? '', result.key, 'pullRequest', state, save);
      const description = replaceManagedSection(latest.pr.description ?? '', result.key, renderDelivery(result, input.evidence_level, attachments));
      if (description !== latest.pr.description) {
        await beginSectionWrite(latest.pr.description ?? '', description, 'pullRequest', state, save);
        await tfsPatch(prPath(input), { description });
      }
      const persisted = await recheckPlacement(input, result);
      if (persisted.pr.description !== description) {
        state.sectionWrites.pullRequest.ambiguous = true;
        await save();
        throw new Error("PR publication changed concurrently or stripped managed markers; reconcile before retry.");
      }
      const discussion = DELIVERY_CONFIG.discussionEnabled ? await reconcileDeliveryDiscussion({ id: input.work_item_id, key: result.key,
        body: renderDiscussion(result.manifest, input.evidence_level, attachments), state, save,
        projectId: result.observed.placement.projectId, recoveredId: input.recovered_discussion_comment_id }) : null;
      const finalItem = await tfsGet(`/wit/workitems/${input.work_item_id}`);
      if (hashObject(boardPlacement(finalItem)) !== hashObject(boardPlacement(wiCurrent))) throw new Error('Discussion/board placement changed externally during publication; preserved without automatic restoration.');
      state.lastPublication = { digest: result.digest, sourceSha: input.source_sha, evidenceLevel: input.evidence_level };
      await save();
      await audit({ stage: 'published', digest: result.digest, attachments: attachments.length });
      return { status: 'published', evidenceLevel: input.evidence_level, sourceSha: input.source_sha,
        planDigest: result.digest, attachments: attachments.length, workItemRevision: finalItem.rev ?? wi.revision,
        ...(discussion ? { discussionCommentId: discussion.id } : {}), pending: result.manifest.pending };
    } catch (error) {
      await audit({ stage: 'partial', digest: result.digest });
      return { status: 'partial', evidenceLevel: input.evidence_level, sourceSha: input.source_sha,
        planDigest: result.digest, attachments: attachments.length,
        pending: [...result.manifest.pending, /^(?:Discussion|Recovered discussion|PR target\/source\/status|Managed section|Attachment markers|Upload outcome unknown|Recovered attachment hash mismatch)/.test(error.message) ? error.message : 'Publication incomplete. Rerun the same plan to reconcile known uploads; inspect provider/revision errors before proceeding.'] };
    }
  }, { projectId: result.observed.pr.repository.project.id });
}
export async function toolPublishPRDelivery(args) {
  const input = PublishDeliveryInput.parse(args), result = await prepare(input);
  if (input.plan_digest !== result.digest) throw new Error("Preparation is stale; rerun tfs_prepare_pr_delivery.");
  if (input.evidence_level === 'verified' && result.manifest.evidenceLevel !== 'verified') throw new Error("Verified evidence has unresolved checks; publish explicitly partial/unverified instead.");
  if (input.evidence_level === 'unverified' && result.manifest.evidenceLevel !== 'unverified') throw new Error("Use the observed evidence level or explicitly partial.");
  if (input.evidence_level === 'partial' && result.manifest.evidenceLevel === 'unverified') throw new Error("No evidence observed; publish unverified rather than partial.");
  const controls = normalizeMutationControls(input), impact = detectHighImpact(result.observed.pr.targetRefName);
  const plan = buildMutationPlan({ tool: 'tfs_publish_pr_delivery', target: { repository: input.repo, pullRequestId: input.pull_request_id, workItemId: input.work_item_id,
    sourceRef: result.observed.placement.sourceRef, targetRef: result.observed.placement.targetRef, targetSha: result.observed.placement.targetSha,
    pullRequestStatus: result.observed.placement.status },
    operation: 'publish final evidence', changes: { sourceSha: input.source_sha, digest: result.digest, evidenceLevel: input.evidence_level,
      before: { managedMediaOnly: true }, after: { managedAttachments: result.files.media.length, managedSections: 2,
        discussion: DELIVERY_CONFIG.discussionEnabled, boardPlacement: 'preserved',
        attachmentNames: result.files.media.map((entry) => evidenceAttachmentName(entry)) } },
    controls, highImpact: impact.highImpact, highImpactMatch: impact.match, highImpactConfirmation: `${input.pull_request_id}:${result.digest}`,
    authAlias: getRequestContext().authAlias, repo: input.repo });
  const applied = await executeGuardedMutation({ plan, controls, apply: () => publish(input, result) });
  return envelope(applied, ['PR descriptions and discussion comments have no cross-process compare-and-swap guarantee; detected concurrent human edits require reconciliation.']);
}
