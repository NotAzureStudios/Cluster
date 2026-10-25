import {
  breakMinutes as calculateBreakMinutes,
  minutesBetween,
  netEntryMinutes,
} from "../../core/time.js";
import {
  parseScheduleStringList,
  scheduleBlockUserIds,
  serializeScheduleReservations,
} from "./scheduler-planning.js";

export function createTimeRouteSerializers(serializeUserLite: (user: any) => any) {
  function serializeTimeBreak(item: any) {
    const startedAt = new Date(item.startedAt);
    const endedAt = item.endedAt ? new Date(item.endedAt) : null;
    return {
      ...item,
      running: !endedAt,
      computedDurationMinutes: item.durationMinutes ?? minutesBetween(startedAt, endedAt || new Date()),
    };
  }

  function serializeTimeEntry(entry: any) {
    const startedAt = new Date(entry.startedAt);
    const endedAt = entry.endedAt ? new Date(entry.endedAt) : null;
    const breaks = Array.isArray(entry.breaks) ? entry.breaks : [];
    const activeBreak = breaks.find((item: any) => !item.endedAt) || null;
    const breakTotal = calculateBreakMinutes(breaks);
    const grossDurationMinutes = minutesBetween(startedAt, endedAt || new Date());
    return {
      ...entry,
      user: serializeUserLite(entry.user),
      project: entry.project ? { id: entry.project.id, name: entry.project.name } : null,
      board: entry.board ? { id: entry.board.id, name: entry.board.name } : null,
      card: entry.card ? { id: entry.card.id, title: entry.card.title, priority: entry.card.priority, dueDate: entry.card.dueDate } : null,
      breaks: breaks.map(serializeTimeBreak),
      activeBreak: activeBreak ? serializeTimeBreak(activeBreak) : null,
      running: !endedAt,
      grossDurationMinutes,
      breakMinutes: breakTotal,
      computedDurationMinutes: netEntryMinutes({ ...entry, breaks }),
    };
  }

  function serializeScheduleBlock(block: any) {
    return {
      ...block,
      user: serializeUserLite(block.user),
      project: block.project ? { id: block.project.id, name: block.project.name, projectType: block.project.projectType } : null,
      board: block.board ? { id: block.board.id, name: block.board.name } : null,
      card: block.card ? { id: block.card.id, title: block.card.title, priority: block.card.priority, dueDate: block.card.dueDate } : null,
      participantIds: parseScheduleStringList(block.participantIds),
      resources: serializeScheduleReservations(block),
      calendarEvent: block.calendarEvent ? { id: block.calendarEvent.id, title: block.calendarEvent.title, startsAt: block.calendarEvent.startsAt, endsAt: block.calendarEvent.endsAt, status: block.calendarEvent.status } : null,
      durationMinutes: minutesBetween(new Date(block.startsAt), new Date(block.endsAt)),
    };
  }

  function buildScheduleInsights(blocks: any[], users: any[], projects: any[], resources: any[], start: Date, end: Date) {
    const conflicts: Array<{ id: string; kind: "person" | "resource"; userId?: string; resourceId?: string; blockIds: string[]; severity: "medium" | "high"; message: string }> = [];
    const byUser = new Map<string, any[]>();
    for (const block of blocks) {
      if (block.status === "cancelled") continue;
      for (const userId of scheduleBlockUserIds(block)) {
        const list = byUser.get(userId) || [];
        list.push(block);
        byUser.set(userId, list);
      }
    }
    for (const [userId, userBlocks] of byUser) {
      const ordered = [...userBlocks].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const a = ordered[i];
          const b = ordered[j];
          if (new Date(b.startsAt).getTime() >= new Date(a.endsAt).getTime()) break;
          const unavailable = [a.type, b.type].some((type) => ["time-off", "unavailable"].includes(type));
          conflicts.push({
            id: `person:${userId}:${a.id}:${b.id}`,
            kind: "person",
            userId,
            blockIds: [a.id, b.id],
            severity: unavailable ? "high" : "medium",
            message: unavailable ? `${a.title} overlaps ${b.title} while time is unavailable.` : `${a.title} overlaps ${b.title}.`,
          });
        }
      }
    }

    for (const resource of resources || []) {
      const events: Array<{ at: number; kind: "start" | "end"; block: any; quantity: number }> = [];
      for (const block of blocks) {
        if (block.status === "cancelled") continue;
        const reservation = (block.resourceReservations || []).find((item: any) => item.resourceId === resource.id);
        if (!reservation) continue;
        const quantity = Math.max(1, Number(reservation.quantity || 1));
        events.push(
          { at: new Date(block.startsAt).getTime(), kind: "start", block, quantity },
          { at: new Date(block.endsAt).getTime(), kind: "end", block, quantity },
        );
      }
      events.sort((a, b) => a.at - b.at || (a.kind === "end" ? -1 : 1));
      const active = new Map<string, { block: any; quantity: number }>();
      let running = 0;
      for (const event of events) {
        if (event.kind === "end") {
          const current = active.get(event.block.id);
          if (current) running -= current.quantity;
          active.delete(event.block.id);
          continue;
        }
        active.set(event.block.id, { block: event.block, quantity: event.quantity });
        running += event.quantity;
        const capacityTotal = Math.max(1, Number(resource.quantityTotal || 1));
        if (running > capacityTotal) {
          const blockIds = Array.from(active.keys()).sort();
          conflicts.push({ id: `resource:${resource.id}:${event.at}:${blockIds.join(":")}`, kind: "resource", resourceId: resource.id, blockIds, severity: "high", message: `${resource.name} exceeds capacity (${running}/${capacityTotal}).` });
        }
      }
    }

    const capacity = users.map((user: any) => {
      const userBlocks = blocks.filter((block: any) => block.status !== "cancelled" && scheduleBlockUserIds(block).includes(user.id));
      const plannedMinutes = userBlocks
        .filter((block: any) => !["time-off", "unavailable", "availability"].includes(block.type))
        .reduce((sum: number, block: any) => sum + minutesBetween(new Date(block.startsAt), new Date(block.endsAt)), 0);
      const unavailableMinutes = userBlocks
        .filter((block: any) => ["time-off", "unavailable"].includes(block.type))
        .reduce((sum: number, block: any) => sum + minutesBetween(new Date(block.startsAt), new Date(block.endsAt)), 0);
      const capacityMinutes = Math.max(0, Number(user.employment?.capacityHours ?? 40) * 60);
      return {
        userId: user.id,
        name: user.displayName || user.username,
        plannedMinutes,
        unavailableMinutes,
        capacityMinutes,
        loadPercent: capacityMinutes ? Math.round((plannedMinutes / capacityMinutes) * 100) : 0,
      };
    });

    const milestones = projects
      .filter((project: any) => project.targetDate && !project.archived)
      .filter((project: any) => {
        const target = new Date(project.targetDate).getTime();
        return target >= start.getTime() - 7 * 86400000 && target < end.getTime() + 14 * 86400000;
      })
      .sort((a: any, b: any) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime())
      .slice(0, 12)
      .map((project: any) => ({
        projectId: project.id,
        projectName: project.name,
        projectType: project.projectType,
        targetDate: project.targetDate,
        priority: project.priority,
        status: project.status,
      }));

    return { conflicts, capacity, milestones };
  }

  return { serializeTimeBreak, serializeTimeEntry, serializeScheduleBlock, buildScheduleInsights };
}
