import { studioAudienceSchema, visibleStudioFormFieldIds } from "@cluster/shared";
import { parseStudioJson } from "../access/studio-audience.js";

export function serializeStudioFormVersion(version: any, options: { publicView?: boolean } = {}) {
  const schema = parseStudioJson(version.schemaJson, { fields: [] });
  const safeSchema = options.publicView
    ? { ...schema, fields: Array.isArray(schema.fields) ? schema.fields.map(({ profileMappingKey: _mapping, ...field }: any) => field) : [] }
    : schema;
  return { ...version, schema: safeSchema, settings: parseStudioJson(version.settingsJson, {}), schemaJson: undefined, settingsJson: undefined };
}

export function serializeStudioForm(form: any, options: { publicView?: boolean } = {}) {
  return {
    ...form,
    audience: options.publicView ? undefined : studioAudienceSchema.parse(parseStudioJson(form.audienceJson, { mode: "all", targets: [] })),
    audienceJson: undefined,
    versions: Array.isArray(form.versions) ? form.versions.map((version: any) => serializeStudioFormVersion(version, options)) : undefined,
  };
}

function answerPresent(value: unknown) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function validateStudioFormAnswers(definition: any, answers: Record<string, unknown>, options: { partial?: boolean } = {}) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return { ok: false, error: "Form answers must be an object." } as const;
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  const known = new Set(fields.map((field: any) => String(field.id)));
  const visible = visibleStudioFormFieldIds(fields, answers);
  const unknown = Object.keys(answers).filter((key) => !known.has(key));
  if (unknown.length) return { ok: false, error: `Unknown form field: ${unknown[0]}` } as const;
  for (const field of fields) {
    const id = String(field.id);
    if (!visible.has(id)) continue;
    const label = String(field.label || id);
    const value = Object.prototype.hasOwnProperty.call(answers, id) ? answers[id] : undefined;
    // A required acknowledgement must be true, not merely a supplied boolean.
    if (!options.partial && field.type === "acknowledgement" && field.required && value !== true)
      return { ok: false, error: `${label} must be acknowledged.` } as const;
    if (!options.partial && field.type === "checkbox" && field.required && value !== true)
      return { ok: false, error: `${label} must be checked.` } as const;
    if (!options.partial && field.required && !answerPresent(value)) return { ok: false, error: `${label} is required.` } as const;
    if (typeof value === "string" && value.length > (field.type === "long_text" ? 20_000 : 2_000)) return { ok: false, error: `${label} is too long.` } as const;
    if (!answerPresent(value)) continue;
    if (["short_text", "long_text", "email", "url", "date", "select", "radio", "initials", "signature"].includes(field.type) && typeof value !== "string")
      return { ok: false, error: `${label} must be text.` } as const;
    if (typeof value === "string") {
      if (value.length > (field.type === "long_text" ? 20_000 : 2_000)) return { ok: false, error: `${label} is too long.` } as const;
      if (!options.partial && field.required && !value.trim()) return { ok: false, error: `${label} is required.` } as const;
    }
    if (!options.partial && field.type === "email" && typeof value === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return { ok: false, error: `${label} must be a valid email address.` } as const;
    if (!options.partial && field.type === "url" && typeof value === "string") { try { const parsed = new URL(value); if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(); } catch { return { ok: false, error: `${label} must be a valid web address.` } as const; } }
    if (!options.partial && field.type === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) return { ok: false, error: `${label} must be a valid date.` } as const;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return { ok: false, error: `${label} must be a number.` } as const;
    if (["checkbox", "acknowledgement"].includes(field.type) && typeof value !== "boolean") return { ok: false, error: `${label} must be a boolean.` } as const;
    if (field.type === "multi_select" && (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== "string") || new Set(value).size !== value.length)) return { ok: false, error: `${label} must be a list of distinct options.` } as const;
    if (["select", "radio"].includes(field.type) && Array.isArray(field.options) && !field.options.includes(value)) return { ok: false, error: `${label} contains an invalid option.` } as const;
    if (field.type === "multi_select" && Array.isArray(field.options) && (value as string[]).some((entry) => !field.options.includes(entry))) return { ok: false, error: `${label} contains an invalid option.` } as const;
  }
  return { ok: true } as const;
}

export function applicationRespondentMetadata(definition: any, answers: Record<string, unknown>) {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  let name: string | null = null;
  let email: string | null = null;
  for (const field of fields) {
    const value = answers[String(field.id)];
    if (typeof value !== "string" || !value.trim()) continue;
    const mapping = String(field.profileMappingKey || "");
    if (!email && (mapping === "email" || field.type === "email")) email = value.trim();
    if (!name && ["displayName", "preferredName", "legalName"].includes(mapping)) name = value.trim();
  }
  return { respondentName: name, respondentEmail: email };
}
