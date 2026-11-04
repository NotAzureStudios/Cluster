import type { CSSProperties } from "react";
import { ResourceIdentityMark } from "./ResourceIdentityMark";
import "./department-identity.css";

export type DepartmentIdentity = {
  id?: string;
  name: string;
  color?: string | null;
  iconId?: string | null;
};

/**
 * A single visual contract for workforce departments. Department identity
 * belongs to the department record, NOT the user's role or personal avatar.
 * This component performs no IO and must be fed authorized, scoped data.
 */
export function DepartmentIdentityMark({
  department, label = false, size = 24, className = "",
}: {
  department: DepartmentIdentity;
  label?: boolean;
  size?: number;
  className?: string;
}) {
  const color = /^#[0-9a-fA-F]{6}$/.test(department.color || "") ? department.color! : "#57c1ff";
  return <span className={`cluster-department-identity-v11 ${className}`.trim()}
    style={{ "--cluster-dept-accent": color } as CSSProperties}>
    <span className="cluster-department-identity-icon-v11" style={{ width: size, height: size }}>
      <ResourceIdentityMark iconId={department.iconId || "glyph:users"} label={department.name} accentColor={color} />
    </span>
    {label && <span className="cluster-department-identity-label-v11">{department.name}</span>}
  </span>;
}
