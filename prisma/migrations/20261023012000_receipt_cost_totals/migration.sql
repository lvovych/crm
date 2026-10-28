ALTER TABLE inventory_documents DROP CONSTRAINT document_totals;
ALTER TABLE inventory_documents ADD CONSTRAINT document_totals CHECK ("totalAmount"="subtotal"+"taxAmount"+"additionalCost"+"roundingAdjustment" AND "totalAmount">=0);
