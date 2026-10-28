CREATE TABLE ledger_import_tasks (
 id text PRIMARY KEY, "organizationId" text NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
 "createdById" text REFERENCES users(id) ON DELETE SET NULL, "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
 "supplierId" text NOT NULL, "sourceName" text NOT NULL, format text NOT NULL CHECK(format IN ('csv','xlsx')),
 "fileHash" text NOT NULL, "storageKey" text NOT NULL, size integer NOT NULL CHECK(size>0 AND size<=10485760),
 mapping jsonb NOT NULL, status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','READY','FAILED')),
 attempts integer NOT NULL DEFAULT 0, "leaseUntil" timestamptz(3), error text, "previewJobId" text,
 UNIQUE("organizationId",id),
 FOREIGN KEY("organizationId","supplierId") REFERENCES suppliers("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY("organizationId","previewJobId") REFERENCES ledger_import_jobs("organizationId",id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX ledger_import_tasks_queue ON ledger_import_tasks(status,"createdAt");
