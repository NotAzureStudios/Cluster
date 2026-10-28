import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { MyInventoryLicensesPanel } from "../settings/MyInventoryLicensesPanel";
import { StudioInventoryKeyPools, StudioInventoryPanel } from "../settings/StudioInventoryVaultPanel";
import { StudioInventoryApprovalPanel } from "../settings/StudioInventoryApprovalPanel";
import { VaultManager } from "./VaultManager";
import { ClusterIcon } from "../../components/ClusterIcon";
import "./inventory-workspace.css";

type InventorySection = "mine" | "assets" | "keys" | "approvals";
type Person = { id: string; displayName: string; username: string; profileRevision: number };

/** A genuine tool route, not an admin settings subsection. The server remains the authority for mutations. */
export function InventoryWorkspacePage({ isAdmin, pinConfigured }: { isAdmin: boolean; pinConfigured: boolean }) {
  const [section, setSection] = useState<InventorySection>(isAdmin ? "assets" : "mine");
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
    <header className="cluster-resource-workspace__header">
      <div><h1><ClusterIcon name="inventory" treatment="duotone" /> Inventory</h1></div>
    </header>
    <nav className="cluster-resource-workspace__tabs" aria-label="Inventory sections">
      <ClusterButton variant={section === "mine" ? "primary" : "secondary"} onClick={() => setSection("mine")}><ClusterIcon name="user" /> My items</ClusterButton>
      {isAdmin && <ClusterButton variant={section === "assets" ? "primary" : "secondary"} onClick={() => setSection("assets")}><ClusterIcon name="inventory" /> Catalog</ClusterButton>}
      {isAdmin && <ClusterButton variant={section === "keys" ? "primary" : "secondary"} onClick={() => setSection("keys")}><ClusterIcon name="lock" /> Key pools</ClusterButton>}
      {isAdmin && <ClusterButton variant={section === "approvals" ? "primary" : "secondary"} onClick={() => setSection("approvals")}><ClusterIcon name="check" /> Approvals</ClusterButton>}
    </nav>
    <section className="cluster-resource-workspace__body" aria-live="off">
      {section === "mine" && <MyInventoryLicensesPanel pinConfigured={pinConfigured} />}
      {section === "assets" && isAdmin && <StudioInventoryPanel includeKeyPools={false} />}
      {section === "approvals" && isAdmin && <StudioInventoryApprovalPanel />}
      {section === "keys" && isAdmin && <>
        {peopleError && <p role="alert">{peopleError} <ClusterButton size="compact" onClick={() => setSection("assets")}>Manage assets instead</ClusterButton></p>}
        <StudioInventoryKeyPools people={people} />
      </>}
    </section>
  </main>;
}

export function VaultWorkspacePage() {
  return <main className="cluster-resource-workspace vault-tool-workspace" aria-label="Vault workspace">
    <header className="cluster-resource-workspace__header">
      <div><h1><ClusterIcon name="lock" treatment="duotone" /> Vault</h1></div>
    </header>
    <VaultManager />
  </main>;
}
