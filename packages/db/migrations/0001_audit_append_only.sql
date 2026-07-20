-- FIX (DATA-007 + SEC-003 + INFRA-007): audit_logs was "append-only by convention".
-- The hash chain (prevHash + hash) makes tampering DETECTABLE, but the
-- BEFORE UPDATE/DELETE triggers make it PREVENTED at the DB layer.
--
-- SEC-003 / INFRA-007: the original trigger blocked ALL DELETEs, which meant
-- the archive-old-records cron couldn't prune 7-year-old rows. The trigger
-- now allows DELETE when the session flag `app.audit_retention_purge = 'on'`
-- is set (the cron sets this inside its DELETE transaction). UPDATE is always
-- blocked — there is no legit reason to mutate a tamper-evident row.

CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $$
DECLARE
    purge_flag text;
BEGIN
    -- Allow DELETE only when the retention cron has set the session flag.
    -- UPDATE is always blocked (no legit reason to mutate a tamper-evident row).
    purge_flag := current_setting('app.audit_retention_purge', true);
    IF TG_OP = 'DELETE' AND purge_flag = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_logs is append-only — % not allowed (purge_flag=%)', TG_OP, purge_flag;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

DROP TRIGGER IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
