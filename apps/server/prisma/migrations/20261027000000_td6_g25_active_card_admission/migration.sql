-- TD6 G25 closeout: active Card/Ticket admission and Board/List archiving must
-- serialize on the SAME parent rows. App-side "check then create" is not enough.
-- PostgreSQL row locks protect all producers, including automations and imports.
CREATE FUNCTION "cluster_guard_active_card_destination"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  list_archived boolean;
  board_archived boolean;
BEGIN
  IF NEW."archived" IS NOT TRUE THEN
    -- FOR SHARE conflicts with the parent UPDATE during archive, so either
    -- admission observes the archive or the archive transaction detects a
    -- newly inserted active Card. Under SERIALIZABLE, a raced snapshot aborts.
    SELECT l."archived", b."archived"
      INTO list_archived, board_archived
      FROM "BoardList" AS l
      JOIN "Board" AS b ON b."id" = l."boardId"
      WHERE l."id" = NEW."listId"
      FOR SHARE OF l, b;
    -- The normal FK reports a missing parent with its own error; don't mask it.
    IF FOUND AND (list_archived OR board_archived) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'Card_active_destination_unarchived',
        MESSAGE = 'Active Cards and Tickets cannot be saved in archived Boards or columns';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Card_guard_active_destination"
BEFORE INSERT OR UPDATE OF "listId", "archived" ON "Card"
FOR EACH ROW
EXECUTE FUNCTION "cluster_guard_active_card_destination"();
