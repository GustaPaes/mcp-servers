import { z } from "zod";

export const INPUT_LIMITS = Object.freeze({
  shortText: 512,
  longText: 8_000,
  collection: 100,
  pageSize: 100,
  pageOffset: 100_000,
  snapshotBytes: 1_048_576,
});

export const shortTextSchema = z.string().trim().min(1).max(INPUT_LIMITS.shortText);
export const optionalShortTextSchema = z.string().trim().max(INPUT_LIMITS.shortText);
export const longTextSchema = z.string().trim().min(1).max(INPUT_LIMITS.longText);
export const optionalLongTextSchema = z.string().trim().max(INPUT_LIMITS.longText);
export const dateTextSchema = z.string().trim().min(1).max(64);
export const shortTextListSchema = z.array(shortTextSchema).max(INPUT_LIMITS.collection);
export const idListSchema = z.array(z.string().trim().min(1).max(128)).max(INPUT_LIMITS.collection);

export const safeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use apenas letras, numeros, "_" ou "-".');

export const paginationSchema = z.object({
  offset: z.number().int().min(0).max(INPUT_LIMITS.pageOffset).default(0),
  limit: z.number().int().min(1).max(INPUT_LIMITS.pageSize).default(50),
}).strict();

export function paginate(items, { offset = 0, limit = 50 } = {}) {
  return {
    items: items.slice(offset, offset + limit),
    pagination: {
      offset,
      limit,
      total: items.length,
      hasMore: offset + limit < items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null,
    },
  };
}
