/** The server must authorize Command Search disclosures for every request. */
export function requiresFreshSearchAuthorization(path: string): boolean {
  return /^\/api\/command\/search(?:\?|$)/.test(path);
}
