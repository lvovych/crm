-- Derived search fields: never written by application commands.
ALTER TABLE inventory_parts ADD COLUMN "ledgerArticleKey" text GENERATED ALWAYS AS (regexp_replace(upper(normalize(COALESCE("partNumber",''),NFKC)),'[[:space:]./_-]','','g')) STORED;
ALTER TABLE inventory_parts ADD COLUMN "ledgerSearchText" text GENERATED ALWAYS AS (lower(COALESCE(name,'') || ' ' || COALESCE("partNumber",''))) STORED;
