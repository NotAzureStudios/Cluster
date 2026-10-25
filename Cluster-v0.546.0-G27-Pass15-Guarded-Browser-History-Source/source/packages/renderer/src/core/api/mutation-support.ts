import { invalidateApiQueries } from "./cache";

export function persistentMutationHeaders(headers: Headers) {
  const safe = new Headers();
  for (const key of ["content-type", "if-match", "x-cluster-base-revision"]) {
    const value = headers.get(key);
    if (value) safe.set(key, value);
  }
  return Object.fromEntries(safe.entries());
}

export function invalidateMutationQueries(paths: string[] | undefined) {
  if (!paths?.length) {
    invalidateApiQueries();
    return;
  }
  paths.forEach((path) => invalidateApiQueries(path));
}
