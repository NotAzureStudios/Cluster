import { z } from "zod";
import { CLUSTER_EXPERTISE_LEVELS, CLUSTER_PROFILE_FIELD_TYPES, CLUSTER_PROFILE_FIELD_VISIBILITIES } from "@cluster/shared";

export const expertiseSchema = z.array(z.object({
  name: z.string().trim().min(1).max(80),
  level: z.enum(CLUSTER_EXPERTISE_LEVELS).default("working"),
  years: z.coerce.number().min(0).max(80).optional().nullable(),
  note: z.string().trim().max(240).optional().nullable(),
}).strict()).max(40);

const clockTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const intervalSchema = z.object({ start: clockTimeSchema, end: clockTimeSchema }).strict().refine((value) => value.start < value.end, "Working-hours intervals must end after they start.");
function validTimeZone(value: string) { try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0)); return true; } catch { return false; } }
export const workingHoursSchema = z.object({
  timezone: z.string().trim().max(120).refine(validTimeZone, "Choose a valid IANA timezone.").optional().nullable(),
  monday: z.array(intervalSchema).max(4).optional(),
  tuesday: z.array(intervalSchema).max(4).optional(),
  wednesday: z.array(intervalSchema).max(4).optional(),
  thursday: z.array(intervalSchema).max(4).optional(),
  friday: z.array(intervalSchema).max(4).optional(),
  saturday: z.array(intervalSchema).max(4).optional(),
  sunday: z.array(intervalSchema).max(4).optional(),
}).strict();

export const profileFieldDefinitionSchema = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,47}$/i),
  label: z.string().trim().min(1).max(80),
  type: z.enum(CLUSTER_PROFILE_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  visibility: z.enum(CLUSTER_PROFILE_FIELD_VISIBILITIES).optional().default("studio"),
  options: z.array(z.string().trim().min(1).max(80)).max(40).optional().default([]),
}).strict();

export const profileFieldDefinitionsSchema = z.array(profileFieldDefinitionSchema).max(30).superRefine((definitions, ctx) => {
  const seen = new Set<string>();
  definitions.forEach((definition, index) => {
    const key = definition.id.toLocaleLowerCase();
    if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: "Profile field keys must be unique." });
    seen.add(key);
    if (["select", "multi_select"].includes(definition.type) && !definition.options.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "options"], message: "Select profile fields need at least one option." });
    if (new Set(definition.options.map((option) => option.toLocaleLowerCase())).size !== definition.options.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, "options"], message: "Profile field options must be unique." });
  });
});

export function normalizeExpertise(value: unknown) {
  const parsed = expertiseSchema.parse(value ?? []);
  const seen = new Set<string>();
  return parsed.filter((item) => {
    const key = item.name.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function validateCustomProfileFields(value: unknown, definitions: unknown, includePrivate = true, enforceRequired = true) {
  const fields = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defs = profileFieldDefinitionsSchema.parse(Array.isArray(definitions) ? definitions : []);
  const output: Record<string, unknown> = {};
  for (const definition of defs) {
    if (!includePrivate && definition.visibility === "private") continue;
    const raw = fields[definition.id];
    if (raw === undefined || raw === null || raw === "") {
      if (definition.required && includePrivate && enforceRequired) throw new Error(`${definition.label} is required.`);
      continue;
    }
    if (definition.type === "number") output[definition.id] = z.coerce.number().finite().parse(raw);
    else if (definition.type === "multi_select") {
      const choices = z.array(z.string()).max(40).parse(raw);
      const allowed = new Set(definition.options);
      output[definition.id] = [...new Set(choices.filter((choice) => !allowed.size || allowed.has(choice)))];
    } else {
      const text = z.string().trim().max(definition.type === "text" ? 1000 : 320).parse(String(raw));
      if (definition.type === "url") z.string().url().parse(text);
      if (definition.type === "date") z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(text);
      if (definition.type === "select" && definition.options.length && !definition.options.includes(text)) throw new Error(`${definition.label} must use a configured option.`);
      output[definition.id] = text;
    }
  }
  return output;
}

export function parseJsonArray(value: unknown) { try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
export function parseJsonRecord(value: unknown) { try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
