import { useMemo, useState } from "react";
import { CLUSTER_ERROR_CODES } from "@cluster/shared";
import { ClusterTextInput } from "../../components/ClusterTextInput";

export function ErrorCodeReferencePanel() {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return CLUSTER_ERROR_CODES;
    return CLUSTER_ERROR_CODES.filter((item) => [item.code, item.title, item.message, item.action, item.severity, String("httpStatus" in item ? item.httpStatus : "")].join(" ").toLowerCase().includes(needle));
  }, [query]);

  return (
    <details className="settings-card-v092 span-2 error-code-reference-v311">
      <summary className="error-code-summary-v532">
        <span><strong id="cluster-error-code-title">Error code reference</strong><small>Diagnostic lookup</small></span>
        <span>{CLUSTER_ERROR_CODES.length} codes</span>
      </summary>
      <div className="error-code-reference-body-v532" aria-labelledby="cluster-error-code-title">
        <label className="error-code-search-v311">
          <span className="sr-only">Search error codes</span>
          <ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, message, status, or action" />
        </label>
        <div className="error-code-list-v311">
          {rows.map((item) => (
            <article key={item.code} data-severity={item.severity}>
              <div className="error-code-heading-v311">
                <code>{item.code}</code>
                <span>{"httpStatus" in item ? item.httpStatus : "Client"}</span>
                <b>{item.title}</b>
              </div>
              <p>{item.message}</p>
              <small>{item.action}</small>
              <em>{item.retryable ? "Safe to retry after the cause is resolved" : "Review the action before retrying"}</em>
            </article>
          ))}
          {!rows.length && <p className="muted tight">No error codes match that search.</p>}
        </div>
      </div>
    </details>
  );
}
