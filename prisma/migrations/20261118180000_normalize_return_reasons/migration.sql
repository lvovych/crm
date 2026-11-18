-- Preserve amounts, stock movements and settlements; normalize document reasons.
-- Bump versions so an open draft cannot silently overwrite the normalized value.
UPDATE supplier_returns SET reason = 'Інше', version = version + 1
WHERE reason NOT IN ('Відмова клієнта', 'Неправильно підібраний товар', 'Брак/рекламація', 'Інше');
