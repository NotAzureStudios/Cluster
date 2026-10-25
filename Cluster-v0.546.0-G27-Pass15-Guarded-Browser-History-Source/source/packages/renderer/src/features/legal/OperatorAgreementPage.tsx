import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "../../core/api";
import { openPrivacyChoices } from "../../core/privacy-consent";
import "./privacy-policy.css";
import { PolicyLoadingState } from "../../components/LoadingState";
import { ClusterButton } from "../../components/ClusterButton";

type OperatorAgreement = {
  id: string;
  kind: "operator_agreement";
  version: string;
  title: string;
  summary?: string | null;
  bodyMarkdown: string;
  contentHash: string;
  status: string;
  effectiveAt?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type PublicOperatorAgreementPayload = { ok: true; studioName: string; policy: OperatorAgreement };

function inlineMarkdown(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)]+\))/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push(text.slice(cursor, index));
    const token = match[0];
    if (token.startsWith("**")) {
      result.push(<strong key={`b-${index}`}>{token.slice(2, -2)}</strong>);
    } else {
      const parsed = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (parsed) result.push(<a key={`a-${index}`} href={parsed[2]} target={parsed[2].startsWith("mailto:") ? undefined : "_blank"} rel="noreferrer">{parsed[1]}</a>);
      else result.push(token);
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

function PolicyMarkdown({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => markdown.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean), [markdown]);
  return <div className="privacy-policy-body-v362">
    {blocks.map((block, index) => {
      const heading = /^(#{1,3})\s+(.+)$/.exec(block);
      if (heading) {
        const content = inlineMarkdown(heading[2]);
        if (heading[1].length === 1) return <h1 key={index}>{content}</h1>;
        if (heading[1].length === 2) return <h2 key={index}>{content}</h2>;
        return <h3 key={index}>{content}</h3>;
      }
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length && lines.every((line) => /^[-*]\s+/.test(line))) {
        return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>)}</ul>;
      }
      return <p key={index}>{inlineMarkdown(lines.join(" "))}</p>;
    })}
  </div>;
}

export default function OperatorAgreementPage() {
  const [payload, setPayload] = useState<PublicOperatorAgreementPayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<PublicOperatorAgreementPayload>("/api/public/legal/operator-agreement")
      .then((value) => { setPayload(value); document.title = `${value.policy.title} · Cluster`; })
      .catch((reason) => {
        if (reason instanceof ApiError && reason.status === 404) setMissing(true);
        else setError(reason instanceof Error ? reason.message : "Operator agreement could not be loaded.");
      });
  }, []);

  if (!payload && !missing && !error) return <PolicyLoadingState label="Loading Server Operator Agreement" />;

  return <main className="privacy-policy-shell-v362">
    <div className="privacy-policy-frame-v362">
      <div className="privacy-policy-top-v362">
        <a className="privacy-policy-brand-v362" href="/"><img src="/cluster-logo.png" alt="" /><span>Cluster</span></a>
        <div className="privacy-policy-actions-v363"><a className="privacy-policy-back-v362" href="/legal/privacy">Privacy Policy</a><a className="privacy-policy-back-v362" href="/legal/terms">Terms of Service</a><a className="privacy-policy-back-v362" href="/legal/copyright">Copyright</a><a className="privacy-policy-back-v362" href="/legal/security">Security</a><ClusterButton unstyled type="button" className="privacy-policy-back-v362" onClick={openPrivacyChoices}>Privacy choices</ClusterButton><a className="privacy-policy-back-v362" href="/">Back to Cluster</a></div>
      </div>
      <article className="privacy-policy-card-v362">
        {payload ? <>
          <header className="privacy-policy-heading-v362">
            <span className="eyebrow">{payload.studioName}</span>
            <h1>{payload.policy.title}</h1>
            {payload.policy.summary && <p className="muted">{payload.policy.summary}</p>}
            <div className="privacy-policy-meta-v362">
              <span>Version {payload.policy.version}</span>
              {payload.policy.effectiveAt && <span>Effective {new Date(payload.policy.effectiveAt).toLocaleDateString()}</span>}
              <span>Document {payload.policy.contentHash.slice(0, 12)}</span>
            </div>
          </header>
          <PolicyMarkdown markdown={payload.policy.bodyMarkdown} />
        </> : <div className="privacy-policy-empty-v362">
          <h1>{missing ? "Operator agreement not published" : error ? "Operator agreement unavailable" : "Loading operator agreement…"}</h1>
          <p>{missing ? "This Cluster server has not published a Server Operator Agreement yet. The agreement is intended for the organization operating this deployment." : error || "Loading the current published agreement."}</p>
        </div>}
      </article>
    </div>
  </main>;
}
