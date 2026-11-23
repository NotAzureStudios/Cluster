-- Collections can carry an icon from the shared icon library (same ids as
-- project and folder icons, e.g. "icon:simple-icons:unrealengine").
ALTER TABLE "LibraryCollection" ADD COLUMN "icon" TEXT;
