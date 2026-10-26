import { z } from "zod";

export const cardIdParamsSchema = z.object({ cardId: z.string() });
export const checklistItemParamsSchema = z.object({ itemId: z.string() });
export const cardRevisionBodySchema = z.object({ expectedRevision: z.number().int().positive().optional() });
export const duplicateCardSchema = z.object({ title: z.string().min(1).max(240).optional() });

export const createCardSchema = z.object({
  listId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  dueDate: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  deferredUntil: z.string().optional().nullable(),
  completionCriteria: z.string().max(4000).optional().nullable(),
  labels: z.array(z.string()).default([]),
  category: z.string().max(80).optional().nullable(),
  coverColor: z.string().max(32).optional().nullable(),
  coverImage: z.string().max(2_500_000).optional().nullable(),
  estimatePoints: z.number().int().min(0).max(999).optional().nullable(),
  memberIds: z.array(z.string()).max(50).optional().default([]),
  watcherIds: z.array(z.string()).max(100).optional().default([]),
  assigneeId: z.string().optional().nullable(),
  externalUrl: z.string().optional().nullable(),
});

export const updateCardSchema = createCardSchema.omit({ listId: true }).partial().extend({
  ticketStage: z.enum(["new", "accepted", "working", "waiting", "review", "resolved", "rejected"]).optional(),
  title: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

export const moveCardSchema = z.object({
  listId: z.string(),
  index: z.number().int().min(0).max(10000).optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

export const createChecklistItemSchema = z.object({ text: z.string().min(1) });
export const updateChecklistItemSchema = z.object({ completed: z.boolean().optional(), text: z.string().min(1).optional() });
export const promoteChecklistItemSchema = z.object({ targetListId: z.string().optional() });
export const createCardCommentSchema = z.object({ body: z.string().min(1) });

export type CreateCardInput = z.infer<typeof createCardSchema>;
export type UpdateCardInput = z.infer<typeof updateCardSchema>;
export type MoveCardInput = z.infer<typeof moveCardSchema>;

// Persisted history commands deliberately require the revision and the exact
// operation the user reviewed. Never infer either from cached Board state.
export const savedCardHistoryCommandSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationId: z.string().trim().min(1).max(200),
}).strict();
