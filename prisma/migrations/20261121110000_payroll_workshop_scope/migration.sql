ALTER TABLE "EmployeePayRule" DROP CONSTRAINT "EmployeePayRule_scope_check";
ALTER TABLE "EmployeePayRule" ADD CONSTRAINT "EmployeePayRule_scope_check"
  CHECK ("scope" IN ('performer','seller','manager','workshop'));
