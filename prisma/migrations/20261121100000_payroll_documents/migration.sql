ALTER TABLE "PaySlip" ADD COLUMN "documentDate" DATE NOT NULL DEFAULT CURRENT_DATE;
UPDATE "PaySlip" SET "documentDate" = "createdAt"::date;
CREATE TABLE "EmployeePayRule" (
  "id" TEXT PRIMARY KEY,
  "technicianId" TEXT NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "ruleKey" TEXT NOT NULL,
  "effective" DATE NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "name" TEXT NOT NULL,
  "basis" TEXT NOT NULL CHECK ("basis" IN ('labor','partsSales','partsMargin','managerLabor','orderMargin')),
  "scope" TEXT NOT NULL CHECK ("scope" IN ('performer','seller','manager')),
  "rate" DECIMAL(6,2) NOT NULL CHECK ("rate" > 0 AND "rate" <= 100),
  "afterDiscount" BOOLEAN NOT NULL DEFAULT true,
  "deductMechanicPay" BOOLEAN NOT NULL DEFAULT false,
  "deductSubcontractCost" BOOLEAN NOT NULL DEFAULT true,
  "includeNegative" BOOLEAN NOT NULL DEFAULT false,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "EmployeePayRule_technicianId_ruleKey_effective_createdAt_idx"
  ON "EmployeePayRule" ("technicianId","ruleKey","effective","createdAt");

-- A reopened order belongs to the period in which it is closed again.
-- Previously posted salary documents retain their snapshots; posting checks
-- prevent paying the same employee for that order again.
CREATE OR REPLACE FUNCTION stamp_payroll_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'completed' AND NEW."payrollEarnedAt" IS NULL THEN
      NEW."payrollEarnedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
    END IF;
  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    NEW."payrollEarnedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  ELSIF NEW.status IS DISTINCT FROM 'completed' THEN
    NEW."payrollEarnedAt" := NULL;
  END IF;
  RETURN NEW;
END;
$$;
