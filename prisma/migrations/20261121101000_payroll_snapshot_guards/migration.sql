CREATE FUNCTION protect_salary_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'completed' AND OLD.lines->>'version' = '2' THEN
    RAISE EXCEPTION 'Posted payroll documents are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payroll_snapshot_immutable BEFORE UPDATE OR DELETE ON "PaySlip"
FOR EACH ROW EXECUTE FUNCTION protect_salary_snapshot();

CREATE FUNCTION protect_salary_rule_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payroll rule versions are append-only';
END;
$$;
CREATE TRIGGER payroll_rule_history_immutable BEFORE UPDATE OR DELETE ON "EmployeePayRule"
FOR EACH ROW EXECUTE FUNCTION protect_salary_rule_history();
