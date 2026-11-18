ALTER TABLE supplier_returns ADD COLUMN status TEXT NOT NULL DEFAULT 'posted', ADD COLUMN version INTEGER NOT NULL DEFAULT 1, ADD COLUMN "postedById" TEXT, ADD COLUMN "postedAt" TIMESTAMP(3);
UPDATE supplier_returns SET "postedById"="createdById", "postedAt"="createdAt";
ALTER TABLE supplier_returns ADD CONSTRAINT supplier_returns_status_check CHECK (status IN ('draft','posted'));
