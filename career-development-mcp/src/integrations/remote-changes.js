import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  atomicWriteJson,
  resolveInside,
  createSerialExecutor,
} from "@gustapaes/mcp-runtime";
import { canonicalHash, numericId } from "./idp-provider.js";

export function createRemoteChanges({
  config,
  provider,
  directory,
  clock = Date.now,
  persist = atomicWriteJson,
}) {
  const serial = createSerialExecutor();
  const scope = (owner) =>
    canonicalHash({
      provider: config.provider,
      origin: config.origin,
      routes: config.routes,
      owner,
    });
  const prepareDirectory = async () => {
    await fs.mkdir(directory, { recursive: true });
    // Resolve against the private parent after symlink resolution.
    resolveInside(path.dirname(directory), path.basename(directory));
  };
  const fileFor = (id) => resolveInside(directory, `${id}.json`);
  const save = async (record) => persist(fileFor(record.previewId), record);
  const currentFor = async (record) => {
    if (record.operation === "plan_create")
      return { employee: await provider.self(), data: null };
    return provider.get(record.target.planId, {
      comments:
        record.operation === "comment_add" ||
        record.changes.status === "COMPLETED",
      page: record.changes.commentPage ?? 0,
      limit: 100,
    });
  };
  function checkTarget(record, current) {
    if (
      record.target.actionId &&
      !current.data.actions.some((a) => a.id === record.target.actionId)
    )
      throw new Error("The action does not belong to the requested plan.");
    if (record.changes.status === "COMPLETED") {
      const comment = current.data.comments?.find(
        (c) => c.id === record.changes.commentId,
      );
      const action = current.data.actions.find(
        (a) => a.id === record.target.actionId,
      );
      if (
        !comment ||
        !comment.text.includes(action.title) ||
        !/https:\/\/[^\s<>]+/.test(comment.text)
      )
        throw new Error(
          "Completing an action requires an existing evidence comment naming the action and linking its evidence. Read the comment page and supply commentId.",
        );
      if (
        record.referenceCommentHash &&
        canonicalHash(comment) !== record.referenceCommentHash
      )
        throw new Error("The evidence comment changed. Prepare a new preview.");
      record.referenceCommentHash = canonicalHash(comment);
    }
  }
  return {
    async prepare(input) {
      await prepareDirectory();
      const entries = await fs.readdir(directory);
      if (
        entries.filter((x) => x.endsWith(".json")).length >= config.maxRecords
      )
        throw new Error(
          "Private remote preview retention limit reached. Archive reviewed records before preparing more changes.",
        );
      const record = {
        previewId: randomUUID(),
        operation: input.operation,
        target: {
          planId: input.planId ?? null,
          actionId: input.actionId ?? null,
        },
        changes: input.changes,
        createdAt: new Date(clock()).toISOString(),
        expiresAt: new Date(clock() + config.previewTtlMs).toISOString(),
        state: "prepared",
        audit: [],
      };
      const current = await currentFor(record);
      checkTarget(record, current);
      record.scope = scope(current.employee);
      record.expectedRevision = current.data?.revision ?? null;
      record.before =
        input.operation === "plan_create"
          ? null
          : input.actionId
            ? current.data.actions.find((a) => a.id === input.actionId)
            : current.data.plan;
      if (input.operation === "plan_update") {
        const start = input.changes.startDate ?? current.data.plan.startDate;
        const end = input.changes.endDate ?? current.data.plan.endDate;
        if (
          start &&
          end &&
          (start > end ||
            current.data.actions.some(
              (a) => a.dueDate && (a.dueDate < start || a.dueDate > end),
            ))
        )
          throw new Error(
            "The updated period conflicts with the plan or its action deadlines.",
          );
      }
      if (
        ["action_create", "action_update"].includes(input.operation) &&
        input.changes.dueDate
      ) {
        const due = input.changes.dueDate;
        if (
          (current.data.plan.startDate && due < current.data.plan.startDate) ||
          (current.data.plan.endDate && due > current.data.plan.endDate)
        )
          throw new Error(
            "The action deadline must remain inside the plan period.",
          );
      }
      if (input.operation === "comment_add" && input.actionId)
        record.changes.text = `Ação: ${record.before.title}\n\n${record.changes.text}`;
      if (record.changes.text?.length > 8000)
        throw new Error(
          "The action-linked comment exceeds 8000 characters. Shorten it before preparing.",
        );
      if (
        input.operation === "comment_add" &&
        current.data.comments?.some((c) => c.text === record.changes.text)
      )
        throw new Error(
          "An identical comment already exists on this page. Reuse its identifier instead of duplicating it.",
        );
      record.after = { ...(record.before ?? {}), ...record.changes };
      record.digest = canonicalHash({
        scope: record.scope,
        operation: record.operation,
        target: record.target,
        changes: record.changes,
        expectedRevision: record.expectedRevision,
        referenceCommentHash: record.referenceCommentHash ?? null,
      });
      await save(record);
      return {
        previewId: record.previewId,
        confirmationDigest: record.digest,
        operation: record.operation,
        target: record.target,
        before: record.before,
        after: record.after,
        expiresAt: record.expiresAt,
      };
    },
    apply({ previewId, confirmationDigest, confirm }) {
      return serial(async () => {
        if (confirm !== true)
          throw new Error(
            "Explicit confirmation of the displayed preview is required.",
          );
        await prepareDirectory();
        const lockPath = resolveInside(directory, "apply.lock");
        let lock;
        try {
          lock = await fs.open(lockPath, "wx", 0o600);
        } catch {
          throw new Error(
            "Another remote change is active or an interrupted operation needs reconciliation. No remote write was attempted.",
          );
        }
        try {
          let record;
          try {
            record = JSON.parse(await fs.readFile(fileFor(previewId), "utf8"));
          } catch {
            throw new Error(
              "Preview not found or unreadable. Prepare the change again.",
            );
          }
          if (
            record.digest !== confirmationDigest ||
            record.previewId !== previewId
          )
            throw new Error("Confirmation does not match the prepared change.");
          if (record.state === "applied")
            return {
              previewId,
              operation: record.operation,
              applied: true,
              replayed: true,
              receipt: record.receipt,
            };
          if (record.state !== "prepared")
            throw new Error(
              "This write was already attempted and its outcome needs reconciliation. It will not be retried automatically.",
            );
          if (clock() > Date.parse(record.expiresAt))
            throw new Error("Preview expired. Prepare a fresh change.");
          const current = await currentFor(record);
          if (
            record.scope !== scope(current.employee) ||
            record.expectedRevision !== (current.data?.revision ?? null)
          )
            throw new Error(
              "Remote identity or plan changed after the preview. Prepare a new preview; nothing was written.",
            );
          checkTarget(record, current);
          const integrity = canonicalHash({
            scope: record.scope,
            operation: record.operation,
            target: record.target,
            changes: record.changes,
            expectedRevision: record.expectedRevision,
            referenceCommentHash: record.referenceCommentHash ?? null,
          });
          if (integrity !== record.digest)
            throw new Error(
              "Preview integrity check failed. Prepare it again.",
            );
          record.state = "attempted";
          record.audit.push({
            event: "attempted",
            at: new Date(clock()).toISOString(),
            digest: record.digest,
          });
          // Persist the intent before transmitting; failure aborts the mutation.
          await save(record);
          let result;
          try {
            result = await provider.execute(
              record.operation,
              record.target,
              record.changes,
              current,
            );
          } catch {
            record.state = "uncertain";
            record.audit.push({
              event: "uncertain",
              at: new Date(clock()).toISOString(),
            });
            await save(record);
            throw new Error(
              "Remote write failed or its outcome is unknown. Read the remote state and reconcile before preparing another operation; do not resend the comment/create blindly.",
            );
          }
          let receipt = {};
          try {
            const body = result?.data ?? result;
            if (record.operation === "comment_add")
              receipt = {
                commentId: numericId(body?.id ?? body?.comment?.id ?? body),
              };
            else if (record.operation === "plan_create")
              receipt = {
                planId: numericId(body?.plan?.id ?? body?.id ?? body),
              };
            else if (record.operation === "action_create")
              receipt = {
                actionId: numericId(body?.action?.id ?? body?.id ?? body),
              };
            else {
              const after = await provider.get(record.target.planId);
              const entity = record.target.actionId
                ? after.data.actions.find(
                    (a) => a.id === record.target.actionId,
                  )
                : after.data.plan;
              const keys = Object.keys(record.changes).filter(
                (key) => !["commentId", "commentPage"].includes(key),
              );
              if (
                !entity ||
                keys.some((key) => entity[key] !== record.changes[key])
              )
                throw new Error();
              receipt = { revision: after.data.revision };
            }
            if (receipt.commentId) {
              const after = await provider.get(record.target.planId, {
                comments: true,
                page: 0,
                limit: 100,
              });
              const written = after.data.comments?.find(
                (c) => c.id === receipt.commentId,
              );
              if (!written || written.text !== record.changes.text.trim())
                throw new Error();
            }
            if (receipt.planId) {
              const after = await provider.get(receipt.planId);
              if (
                ["title", "description", "startDate", "endDate"].some(
                  (key) => after.data.plan[key] !== record.changes[key],
                ) ||
                record.changes.actions.some(
                  (expected) =>
                    !after.data.actions.some(
                      (a) =>
                        a.title === expected.title &&
                        a.description === expected.description &&
                        a.dueDate === expected.dueDate,
                    ),
                )
              )
                throw new Error();
            }
            if (receipt.actionId) {
              const after = await provider.get(record.target.planId);
              const written = after.data.actions.find(
                (a) => a.id === receipt.actionId,
              );
              if (
                !written ||
                ["title", "description", "dueDate"].some(
                  (key) => written[key] !== record.changes[key],
                )
              )
                throw new Error();
            }
          } catch {
            record.state = "uncertain";
            record.audit.push({
              event: "verification_pending",
              at: new Date(clock()).toISOString(),
            });
            await save(record);
            throw new Error(
              "The provider accepted the write but confirmation could not be verified. Read the remote state; this preview cannot be resent.",
            );
          }
          record.state = "applied";
          record.receipt = receipt;
          record.audit.push({
            event: "applied",
            at: new Date(clock()).toISOString(),
          });
          try {
            await save(record);
          } catch {
            throw new Error(
              "The remote write succeeded, but its audit receipt could not be persisted. Reconcile remote state before any retry.",
            );
          }
          return {
            previewId,
            operation: record.operation,
            applied: true,
            replayed: false,
            receipt,
          };
        } finally {
          await lock.close();
          await fs.rm(lockPath);
        }
      });
    },
  };
}
