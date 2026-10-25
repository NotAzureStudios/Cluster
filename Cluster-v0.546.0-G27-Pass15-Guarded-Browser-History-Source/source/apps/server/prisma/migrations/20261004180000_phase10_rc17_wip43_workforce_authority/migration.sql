-- WIP43: converge People/Workforce persistence onto first-class authorities.
-- Cluster has no deployed pre-release instances, so duplicate mirror columns are removed directly.
ALTER TABLE "User"
  DROP COLUMN "title",
  DROP COLUMN "department",
  DROP COLUMN "teamName",
  DROP COLUMN "managerName",
  DROP COLUMN "employmentType",
  DROP COLUMN "workLocation",
  DROP COLUMN "timezone",
  DROP COLUMN "status",
  DROP COLUMN "statusMessage",
  DROP COLUMN "skills",
  DROP COLUMN "expertise",
  DROP COLUMN "workingHours",
  DROP COLUMN "managerUserId",
  DROP COLUMN "capacityHours",
  DROP COLUMN "minimumHours",
  DROP COLUMN "startDate";

ALTER TABLE "WorkingPattern"
  DROP COLUMN "capacityHours",
  DROP COLUMN "minimumHours";
