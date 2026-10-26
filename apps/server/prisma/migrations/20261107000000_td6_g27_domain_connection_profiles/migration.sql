-- A saved access plan is NOT an assertion of DNS, gateway, TLS, or reachability.
ALTER TABLE "StudioManagedDomain"
  ADD COLUMN "connectionMode" TEXT,
  ADD COLUMN "connectionProvider" TEXT,
  ADD COLUMN "connectionWebPort" INTEGER,
  ADD COLUMN "connectionApiPort" INTEGER,
  ADD COLUMN "connectionPublicPort" INTEGER;
