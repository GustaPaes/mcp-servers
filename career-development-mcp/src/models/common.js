import { z } from "zod";

export const safeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use apenas letras, numeros, "_" ou "-".');
