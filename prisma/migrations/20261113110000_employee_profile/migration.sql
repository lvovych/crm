ALTER TABLE technicians ADD COLUMN "givenName" TEXT, ADD COLUMN "familyName" TEXT, ADD COLUMN "hiredOn" DATE,
ADD CONSTRAINT employee_dates_in_order CHECK ("dismissedOn" >= "hiredOn");
