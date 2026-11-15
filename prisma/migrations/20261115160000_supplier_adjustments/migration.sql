ALTER TABLE supplier_entries
  DROP CONSTRAINT supplier_entry_kind,
  ADD CONSTRAINT supplier_entry_kind CHECK (kind IN (
    'receipt', 'payment', 'opening_debt', 'opening_credit', 'adjustment_debt', 'adjustment_credit'
  ));
