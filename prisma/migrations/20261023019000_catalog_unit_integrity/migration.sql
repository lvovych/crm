ALTER TABLE units_of_measure ADD CONSTRAINT standard_unit_precision CHECK (
 (lower(btrim(code)) NOT IN ('pcs','шт','шт.','stk','vnt.','set','компл','компл.','уп','уп.') OR precision=0)
 AND (lower(btrim(code)) NOT IN ('l','л','ml','мл','kg','кг','g','г','m','м','cm','см','qt','gal','fl oz','lb','oz','ft','in') OR precision=3)
);
CREATE OR REPLACE FUNCTION ledger_unit_precision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.code IS DISTINCT FROM OLD.code AND EXISTS(SELECT 1 FROM inventory_parts WHERE "organizationId"=OLD."organizationId" AND ("unitId"=OLD.id OR unit=OLD.code)) THEN
  RAISE EXCEPTION 'Код одиниці використовується товарами. Створіть нову одиницю.';
 END IF;
 IF ROW(NEW.code,NEW.precision) IS DISTINCT FROM ROW(OLD.code,OLD.precision)
 AND EXISTS(SELECT 1 FROM inventory_parts p JOIN stock_lots l ON l."inventoryPartId"=p.id AND l."organizationId"=p."organizationId" WHERE p."organizationId"=OLD."organizationId" AND (p."unitId"=OLD.id OR p.unit=OLD.code)) THEN
  RAISE EXCEPTION 'Одиниця з історичними рухами незмінна';
 END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION ledger_product_unit_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."unitId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM units_of_measure WHERE id=NEW."unitId" AND "organizationId"=NEW."organizationId" AND code=NEW.unit) THEN
  RAISE EXCEPTION 'Одиниця товару має відповідати вибраному запису довідника';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_product_unit_consistency BEFORE INSERT OR UPDATE ON inventory_parts FOR EACH ROW EXECUTE FUNCTION ledger_product_unit_consistency();
