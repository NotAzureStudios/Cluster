import { isClosedBoardWorkItem } from "@cluster/shared";
import type { Board, BuildArtifactRecord, Card, QASessionRecord } from "../application/application-models";
import { projectQaReadiness } from "./project-quality-models";
import { ClusterButton } from "../../components/ClusterButton";
import { CoverageMatrix, TrendIndicator } from "../../components/ClusterVisualIntelligence";

function matrixKey(session: Pick<QASessionRecord, "platform" | "configuration" | "suite">) {
  return `${session.platform || "Unspecified"}::${session.configuration || "default"}::${session.suite || "general"}`;
}

function sessionPassRate(rows: QASessionRecord[]) {
  const totals = rows.reduce((sum, row) => ({ passed: sum.passed + row.passed, failed: sum.failed + row.failed, blocked: sum.blocked + row.blocked }), { passed: 0, failed: 0, blocked: 0 });
  const tested = totals.passed + totals.failed + totals.blocked;
  if (tested > 0) return Math.round((totals.passed / tested) * 100);
  if (rows.some((row) => row.decision === "go" || row.status === "passed")) return 100;
  return 0;
}

function sessionTone(session: QASessionRecord | null) {
  if (!session) return "neutral" as const;
  if (session.decision === "no-go" || session.status === "failed" || session.status === "blocked") return "danger" as const;
  if (session.decision === "go" || session.status === "passed") return "success" as const;
  if (session.status === "running" || session.decision === "conditional") return "warning" as const;
  return "info" as const;
}

export function ProjectQaCoveragePanel({ boards, cards, artifacts, sessions, onOpenBoard }: { boards: Board[]; cards: Card[]; artifacts: BuildArtifactRecord[]; sessions: QASessionRecord[]; onOpenBoard: (id: string) => void }) {
  const readiness = projectQaReadiness(sessions, artifacts);
  const sortedBuilds = [...artifacts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const matrixBuilds = sortedBuilds.slice(0, 6).reverse();
  const rowKeys = Array.from(new Set(sessions.map(matrixKey)));
  if (!rowKeys.length) {
    for (const artifact of matrixBuilds) rowKeys.push(`${artifact.platform || "Unspecified"}::default::general`);
  }
  const rows = rowKeys.map((key) => {
    const [platform, configuration, suite] = key.split("::");
    return { id: key, label: `${platform} · ${configuration} · ${suite}` };
  });
  const columns = matrixBuilds.map((build) => ({ id: build.id, label: build.version }));
  const values = Object.fromEntries(rows.flatMap((row) => columns.map((column) => {
    const matches = sessions
      .filter((session) => session.buildId === column.id && matrixKey(session) === row.id)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const latest = matches[0] || null;
    const detail = latest ? `${latest.status}${latest.decision !== "pending" ? ` · ${latest.decision}` : ""}${latest.retestOfSessionId ? " · retest" : ""}` : "Not tested";
    return [`${row.id}:${column.id}`, { id: `${row.id}:${column.id}`, label: `${row.label} on ${matrixBuilds.find((build) => build.id === column.id)?.version || "Build"}`, value: latest ? sessionPassRate([latest]) : 0, detail, tone: sessionTone(latest) }];
  })));
  const latestBuild = sortedBuilds[0] || null;
  const previousBuild = sortedBuilds[1] || null;
  const latestRate = latestBuild ? sessionPassRate(sessions.filter((session) => session.buildId === latestBuild.id)) : readiness.passRate;
  const previousRate = previousBuild ? sessionPassRate(sessions.filter((session) => session.buildId === previousBuild.id)) : latestRate;
  const environments = Array.from(new Set(sessions.map((session) => session.environment).filter(Boolean)));
  const retests = sessions.filter((session) => Boolean(session.retestOfSessionId)).length;
  const regressionRuns = sessions.filter((session) => Boolean(session.regressionBaseBuildId) || session.scope === "regression").length;
  const doneListIds = new Set(boards.flatMap((board) => (board.lists || []).filter((list) => list.isDone).map((list) => list.id)));
  const openQaCards = cards.filter((card) => !isClosedBoardWorkItem({ ...card, listIsDone: doneListIds.has(card.listId) })).length;

  return <div className="qa-coverage-grid-v309">
    <section className="panel flat-panel-v159">
      <h3>Board coverage</h3>
      {boards.map((board) => <ClusterButton unstyled type="button" className="coverage-row-v309" key={board.id} onClick={() => onOpenBoard(board.id)}><strong>{board.name}</strong><span>{board.lists.length} lists</span></ClusterButton>)}
      <div className="coverage-row-v309"><strong>Open QA reports</strong><span>{openQaCards}</span></div>
    </section>
    <section className="panel flat-panel-v159">
      <h3>Build readiness</h3>
      <div className="quality-score-v309"><strong>{readiness.passRate}%</strong><span>{readiness.decision} sign-off</span></div>
      {sortedBuilds.slice(0, 6).map((artifact) => <div className="coverage-row-v309" key={artifact.id}><strong>{artifact.version}</strong><span>{artifact.platform} · {artifact.qaStatus} · {artifact.sourceRevision.slice(0, 10)}</span></div>)}
    </section>
    <section className="panel flat-panel-v159">
      <div className="section-heading"><div><h3>Configuration matrix</h3><p className="muted tight">Latest QA result for each platform / configuration / suite against recent Builds.</p></div><span className="soft-pill">{retests} retests · {regressionRuns} regression runs</span></div>
      <TrendIndicator label="Latest Build QA pass rate" current={latestRate} previous={previousRate} />
      {rows.length && columns.length ? <CoverageMatrix rows={rows} columns={columns} values={values} /> : <p className="muted">Create a Build and QA session to populate coverage.</p>}
      <h4>Environments</h4><p className="muted">{environments.join(", ") || "No environments recorded"}</p>
    </section>
  </div>;
}
