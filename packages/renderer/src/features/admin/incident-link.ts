/** Strictly validate an incident inspector route before constructing any request.
 * Navigation and the API must still independently enforce administrator access.
 */
export function incidentIdFromInspect(value: string | null | undefined): string | null {
  const prefix = "operations-incident:";
  if (!value?.startsWith(prefix)) return null;
  const id = value.slice(prefix.length);
  return /^[A-Za-z0-9_.:-]{1,200}$/.test(id) ? id : null;
}
