type WorkforceProfileInput = {
  department?: string | null;
  title?: string | null;
  managerUserId?: string | null;
  employmentType?: string | null;
  workLocation?: string | null;
  startDate?: string | Date | null;
  archived?: boolean;
  capacityHours?: number | null;
  minimumHours?: number | null;
  timezone?: string | null;
  workingHours?: Record<string, unknown> | null;
  availability?: string | null;
  availabilityMessage?: string | null;
  connectionVisibility?: "visible" | "invisible" | null;
  expertise?: Array<{ name: string; level?: string; years?: number | null }>;
  skills?: string[];
};

function touched(value: unknown) { return value !== undefined; }
function textOrNull(value: unknown) { const valueText = String(value ?? "").trim(); return valueText || null; }

async function resolveDepartment(tx: any, workspaceId: string, value: string | null | undefined) {
  if (!touched(value)) return undefined;
  const name = textOrNull(value);
  if (!name) return null;
  return tx.department.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: { archived: false },
    create: { workspaceId, name },
  });
}

async function resolveJobRole(tx: any, workspaceId: string, departmentId: string | null | undefined, value: string | null | undefined) {
  if (!touched(value)) return undefined;
  const name = textOrNull(value);
  if (!name) return null;
  return tx.jobRole.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: { archived: false, ...(departmentId ? { departmentId } : {}) },
    create: { workspaceId, name, departmentId: departmentId || null },
  });
}

function normalizedSkillRows(input: WorkforceProfileInput) {
  if (input.expertise !== undefined) return (input.expertise || []).map((item) => ({ name: String(item.name || "").trim(), level: item.level || "working", years: item.years ?? null })).filter((item) => item.name);
  if (input.skills !== undefined) return (input.skills || []).map((name) => ({ name: String(name || "").trim(), level: "working", years: null })).filter((item) => item.name);
  return null;
}

export async function syncUserWorkforceAuthorities(tx: any, args: { workspaceId: string; userId: string; input: WorkforceProfileInput; create?: boolean }) {
  const { workspaceId, userId, input, create = false } = args;
  const department = await resolveDepartment(tx, workspaceId, input.department);
  const existingEmployment = await tx.employment.findUnique({ where: { userId }, select: { departmentId: true } });
  const effectiveDepartmentId = department === undefined ? existingEmployment?.departmentId : department?.id || null;
  const jobRole = await resolveJobRole(tx, workspaceId, effectiveDepartmentId, input.title);

  const employmentTouched = create || [input.department, input.title, input.managerUserId, input.employmentType, input.workLocation, input.startDate, input.archived, input.capacityHours, input.minimumHours].some(touched);
  if (employmentTouched) {
    const update: any = { revision: { increment: 1 } };
    if (department !== undefined) update.departmentId = department?.id || null;
    if (jobRole !== undefined) update.jobRoleId = jobRole?.id || null;
    if (touched(input.managerUserId)) update.managerUserId = input.managerUserId || null;
    if (touched(input.employmentType)) update.employmentType = textOrNull(input.employmentType);
    if (touched(input.workLocation)) update.workLocation = textOrNull(input.workLocation);
    if (touched(input.startDate)) update.startDate = input.startDate ? new Date(input.startDate) : null;
    if (touched(input.capacityHours)) update.capacityHours = input.capacityHours ?? null;
    if (touched(input.minimumHours)) update.minimumHours = input.minimumHours ?? null;
    if (touched(input.archived)) update.active = !input.archived;
    await tx.employment.upsert({
      where: { userId },
      update,
      create: {
        workspaceId, userId,
        departmentId: department?.id || null,
        jobRoleId: jobRole?.id || null,
        managerUserId: input.managerUserId || null,
        employmentType: textOrNull(input.employmentType),
        workLocation: textOrNull(input.workLocation),
        startDate: input.startDate ? new Date(input.startDate) : null,
        capacityHours: input.capacityHours ?? null,
        minimumHours: input.minimumHours ?? null,
        active: input.archived === undefined ? true : !input.archived,
      },
    });
  }

  const workingPatternTouched = create || [input.timezone, input.workingHours].some(touched);
  if (workingPatternTouched) {
    const existing = await tx.workingPattern.findUnique({ where: { userId } });
    const currentHours = (() => { try { return JSON.parse(String(existing?.hoursJson || "{}")); } catch { return {}; } })();
    const hours = input.workingHours === undefined ? currentHours : (input.workingHours || {});
    const update: any = { revision: { increment: 1 } };
    if (touched(input.timezone)) update.timezone = textOrNull(input.timezone);
    if (touched(input.workingHours)) update.hoursJson = JSON.stringify(hours);
    await tx.workingPattern.upsert({
      where: { userId },
      update,
      create: {
        userId,
        timezone: textOrNull(input.timezone) || textOrNull((hours as any)?.timezone),
        hoursJson: JSON.stringify(hours),
      },
    });
  }

  const statusTouched = create || touched(input.availability) || touched(input.availabilityMessage) || touched(input.connectionVisibility);
  if (statusTouched) {
    const update: any = { updatedByUserId: userId };
    if (touched(input.availability)) update.availability = input.availability || "available";
    if (touched(input.availabilityMessage)) update.availabilityMessage = textOrNull(input.availabilityMessage);
    if (touched(input.connectionVisibility)) update.connectionVisibility = input.connectionVisibility || "visible";
    await tx.workforceStatus.upsert({
      where: { userId },
      update,
      create: {
        userId,
        availability: input.availability || "available",
        availabilityMessage: textOrNull(input.availabilityMessage),
        connectionVisibility: input.connectionVisibility || "visible",
        updatedByUserId: userId,
      },
    });
  }

  const skillRows = normalizedSkillRows(input);
  if (skillRows) {
    await tx.personSkill.deleteMany({ where: { userId } });
    for (const item of skillRows) {
      const skill = await tx.skill.upsert({
        where: { workspaceId_name: { workspaceId, name: item.name } },
        update: { archived: false },
        create: { workspaceId, name: item.name },
      });
      await tx.personSkill.create({ data: { userId, skillId: skill.id, level: item.level || "working", years: item.years ?? null } });
    }
  }
}
