CREATE TABLE "SalaryRule" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "rate" DECIMAL(14,2) NOT NULL,
  UNIQUE ("organizationId","name")
);
ALTER TABLE "PayPlan" ADD COLUMN "ruleIds" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "PaySlip" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed' CHECK ("status" IN ('new','completed'));
