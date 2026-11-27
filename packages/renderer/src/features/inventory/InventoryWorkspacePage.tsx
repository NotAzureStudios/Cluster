import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { MyInventoryLicensesPanel } from "../settings/MyInventoryLicensesPanel";
import { StudioInventoryKeyPools, StudioInventoryPanel } from "../settings/StudioInventoryVaultPanel";
import { StudioInventoryApprovalPanel } from "../settings/StudioInventoryApprovalPanel";
import { VaultManager } from "./VaultManager";
import { DomainsManager } from "../domains/DomainsManager";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import "./inventory-workspace.css";

export type InventorySection = "mine" | "assets" | "domains" | "keys" | "vault" | "approvals";
type Person = { id: string; displayName: string; username: string; profileRevision: number };

/** A genuine tool route, not an admin settings subsection. The server remains the authority for mutations. */
export function InventoryWorkspacePage({ isAdmin, pinConfigured, initialSection }: { isAdmin: boolean; pinConfigured: boolean; initialSection?: InventorySection }) {
  const [section, setSection] = useState<InventorySection>(initialSection && (isAdmin || initialSection === "mine") ? initialSection : isAdmin ? "assets" : "mine");
  const [people, setPeople] = useState<Person[]>([]);
  const [peopleError, setPeopleError] = useState("");
  useEffect(() => {
    if (!isAdmin || section !== "keys") return;
    let active = true;
    void api<{ people: Person[] }>("/api/admin/inventory/access-requests/options")
      .then((result) => { if (active) { setPeople(result.people || []); setPeopleError(""); } })
      .catch((error) => { if (active) setPeopleError(error instanceof Error ? error.message : "People directory unavailable"); });
    return () => { active = false; };
  }, [isAdmin, section]);

  return <main className="cluster-resource-workspace inventory-tool-workspace" aria-label="Inventory workspace">
    <ToolPageHeader title="Inventory" icon="inventory" actions={
      <nav className="cluster-resource-workspace__tabs" aria-label="Inventory sections">
        <ClusterSegmentedControl value={section} onChange={(value) => setSection(value as InventorySection)} label="Inventory sections" size="compact" options={[
          { value: "mine", label: "My items" },
          ...(isAdmin ? [{ value: "assets", label: "Catalog" }, { value: "domains", label: "Domains" }, { value: "keys", label: "Key pools" }, { value: "vault", label: "Vault" }, { value: "approvals", label: "Approvals" }] : []),
        ]} />
      </nav>
    } />
    <section className="cluster-resource-workspace__body" aria-live="off">
      {section === "mine" && <MyInventoryLicensesPanel pinConfigured={pinConfigured} />}
      {section === "assets" && isAdmin && <StudioInventoryPanel includeKeyPools={false} />}
      {section === "domains" && isAdmin && <DomainsManager />}
      {section === "vault" && isAdmin && <VaultManager />}
      {section === "approvals" && isAdmin && <StudioInventoryApprovalPanel />}
      {section === "keys" && isAdmin && <>
        {peopleError && <p role="alert">{peopleError} <ClusterButton size="compact" onClick={() => setSection("assets")}>Manage assets instead</ClusterButton></p>}
        <StudioInventoryKeyPools people={people} />
      </>}
    </section>
  </main>;
}
