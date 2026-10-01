-- US-012: an event is never rewritten or removed; only `synced_at` may be set after insert (the
-- sync service marking a push as acknowledged). Row triggers do not fire on TRUNCATE, so the test
-- database can still be cleared between cases.
CREATE FUNCTION events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'synced_at') IS DISTINCT FROM (to_jsonb(OLD) - 'synced_at') THEN
    RAISE EXCEPTION 'events is append-only';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON "events"
  FOR EACH ROW EXECUTE FUNCTION events_append_only();
