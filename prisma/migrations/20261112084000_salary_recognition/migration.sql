ALTER TABLE service_records ADD COLUMN "payrollEarnedAt" TIMESTAMP(3);
UPDATE service_records SET "payrollEarnedAt" = "serviceDate" WHERE status = 'completed';
CREATE FUNCTION stamp_payroll_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW."payrollEarnedAt" IS NULL THEN
    NEW."payrollEarnedAt" := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_completion BEFORE INSERT OR UPDATE OF status ON service_records
FOR EACH ROW EXECUTE FUNCTION stamp_payroll_completion();
CREATE INDEX service_records_payroll_period ON service_records ("organizationId","payrollEarnedAt");
