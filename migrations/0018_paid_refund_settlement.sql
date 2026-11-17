-- Additive per-order exclusion in the same ACCESS_DB serialization plane as
-- lifecycle readiness, capabilities and email claims. No legacy refund is
-- inferred, no existing order/entitlement is backfilled, and holds never expire.
CREATE TABLE pbe_paid_order_settlements (
  order_id TEXT PRIMARY KEY,
  checkout_session_id TEXT NOT NULL,
  payment_intent_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  currency TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preparing', 'ready', 'refund')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
  order_json TEXT CHECK(order_json IS NULL OR json_valid(order_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(state != 'refund' OR order_json IS NOT NULL)
);

CREATE TRIGGER pbe_refund_excludes_ready_insert
BEFORE INSERT ON pbe_lifecycle_fulfillments
WHEN NEW.state = 'ready' AND EXISTS (
  SELECT 1 FROM pbe_paid_order_settlements WHERE order_id = NEW.order_id AND state = 'refund'
) BEGIN SELECT RAISE(ABORT, 'refund_blocks_fulfillment'); END;

-- A lifecycle abort/restoration must not revive a refunded order or abort work
-- on unrelated orders in that same batch. Keep its previous blocked state.
CREATE TRIGGER pbe_refund_excludes_ready_update
BEFORE UPDATE OF state ON pbe_lifecycle_fulfillments
WHEN NEW.state = 'ready' AND EXISTS (
  SELECT 1 FROM pbe_paid_order_settlements WHERE order_id = NEW.order_id AND state = 'refund'
) BEGIN SELECT RAISE(IGNORE); END;

CREATE TRIGGER pbe_ready_wins_refund_insert
AFTER INSERT ON pbe_lifecycle_fulfillments WHEN NEW.state = 'ready'
BEGIN UPDATE pbe_paid_order_settlements SET state = 'ready', updated_at = NEW.updated_at
  WHERE order_id = NEW.order_id AND state = 'preparing'; END;

CREATE TRIGGER pbe_ready_wins_refund_update
AFTER UPDATE OF state ON pbe_lifecycle_fulfillments WHEN NEW.state = 'ready'
BEGIN UPDATE pbe_paid_order_settlements SET state = 'ready', updated_at = NEW.updated_at
  WHERE order_id = NEW.order_id AND state = 'preparing'; END;

CREATE TRIGGER pbe_refund_excludes_capability
BEFORE INSERT ON pbe_lifecycle_download_capabilities WHEN EXISTS (
  SELECT 1 FROM pbe_paid_order_settlements WHERE order_id = NEW.order_id AND state = 'refund'
) BEGIN SELECT RAISE(ABORT, 'refund_blocks_fulfillment'); END;

CREATE TRIGGER pbe_refund_excludes_email
BEFORE INSERT ON pbe_lifecycle_email_dispatches WHEN EXISTS (
  SELECT 1 FROM pbe_paid_order_settlements WHERE order_id = NEW.order_id AND state = 'refund'
) BEGIN SELECT RAISE(ABORT, 'refund_blocks_fulfillment'); END;
