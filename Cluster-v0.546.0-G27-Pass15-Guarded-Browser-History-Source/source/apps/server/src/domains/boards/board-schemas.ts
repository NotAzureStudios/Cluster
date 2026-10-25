import { z } from "zod";

export const projectIdParamsSchema = z.object({ projectId: z.string() });
export const boardIdParamsSchema = z.object({ boardId: z.string() });
export const listIdParamsSchema = z.object({ listId: z.string() });
export const revisionBodySchema = z.object({ expectedRevision: z.number().int().positive().optional() });

export const createBoardSchema = z.object({
  name: z.string().min(1).default("New Board"),
  description: z.string().optional().nullable(),
  assignedUserIds: z.array(z.string()).optional().default([]),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  backgroundStyle: z.enum(["soft", "solid", "gradient"]).optional().default("soft"),
  labelDefinitions: z.array(z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(40).optional().default([]),
  columns: z.array(z.string().min(1).max(80)).max(20).optional(),
  template: z.enum(["project-default"]).optional(),
});

export const updateBoardSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  assignedUserIds: z.array(z.string()).optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  backgroundStyle: z.enum(["soft", "solid", "gradient"]).optional(),
  labelDefinitions: z.array(z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(80), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })).max(40).optional(),
  archived: z.boolean().optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

export const createListSchema = z.object({
  title: z.string().min(1).default("New List"),
  description: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  wipLimit: z.number().int().min(1).max(999).optional().nullable(),
  isDone: z.boolean().optional(),
  collapsed: z.boolean().optional(),
  assignedUserIds: z.array(z.string()).optional().default([]),
});

export const updateListSchema = createListSchema.partial().extend({
  title: z.string().min(1).optional(),
  expectedRevision: z.number().int().min(1).optional(),
});

export const reorderListSchema = z.object({ direction: z.enum(["left", "right"]), expectedRevision: z.number().int().min(1) });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
