ALTER TABLE technicians ADD COLUMN "workRoles" TEXT[] NOT NULL DEFAULT ARRAY['mechanic']::text[],
  ADD COLUMN "dismissedOn" DATE;
