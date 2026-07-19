-- FIX (DATA-007): audit_logs was "append-only by convention" — no DB-level
-- enforcement. The hash chain (prevHash + hash) makes tampering DETECTABLE
-- by verifyAuditChain, but not PREVENTED. A compromised admin with direct
-- SQL access (or a future bug that adds an UPDATE path) could
-- UPDATE audit_logs SET ... and re-compute the chain forward to cover
-- their tracks — verifyAuditChain would still pass because it re-derives
-- from the current rows. These triggers block UPDATE and DELETE at the
-- DB layer, so the only way to tamper is to DROP the trigger first
-- (which is itself an auditable DDL event).

CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — UPDATE and DELETE are not allowed';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
