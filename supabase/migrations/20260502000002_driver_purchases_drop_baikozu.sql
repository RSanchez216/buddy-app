-- Phase 2A adjustment: drop 'baikozu' from purchase_type.
-- Baikozu is an entity, not a purchase type. The overlap pattern
-- (Monas has a bank loan + sold to driver) is now expressed as
-- purchase_type='cash' + entity_id=BAIKOZU INC + underlying_loan_id set.
ALTER TABLE driver_purchases
  DROP CONSTRAINT IF EXISTS driver_purchases_purchase_type_check;

ALTER TABLE driver_purchases
  ADD CONSTRAINT driver_purchases_purchase_type_check
  CHECK (purchase_type IN ('cash','driver_bank_loan'));
