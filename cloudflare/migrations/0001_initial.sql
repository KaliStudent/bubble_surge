-- Payment accounting happens inside SQL statements, not read/modify/write JavaScript.
-- Keep each trigger on one line and avoid CASE...END: the remote D1 /query
-- parser differs from local SQLite. See workers-sdk issues #4727 and #15178.
CREATE TABLE wallets (user_id TEXT PRIMARY KEY, prisms INTEGER NOT NULL DEFAULT 0 CHECK(prisms >= 0), equipped TEXT);
-- statement-breakpoint
CREATE TABLE owned (user_id TEXT NOT NULL REFERENCES wallets(user_id), style TEXT NOT NULL, cost INTEGER NOT NULL CHECK(cost > 0), PRIMARY KEY(user_id, style));
-- statement-breakpoint
CREATE TABLE invoices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES wallets(user_id), pack TEXT NOT NULL, stars INTEGER NOT NULL, prisms INTEGER NOT NULL, created INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','refunded')));
-- statement-breakpoint
CREATE TABLE payments (charge TEXT PRIMARY KEY, invoice TEXT UNIQUE NOT NULL REFERENCES invoices(id), user_id TEXT NOT NULL REFERENCES wallets(user_id), prisms INTEGER NOT NULL, stars INTEGER NOT NULL, refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded IN (0,1)), created INTEGER NOT NULL);
-- statement-breakpoint
CREATE TABLE events (id INTEGER PRIMARY KEY, player TEXT NOT NULL, session TEXT NOT NULL, event TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
-- statement-breakpoint
CREATE INDEX events_created ON events(created);
-- statement-breakpoint
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
-- statement-breakpoint
CREATE INDEX rate_limits_expires ON rate_limits(expires);
-- statement-breakpoint
CREATE TRIGGER validate_credit BEFORE INSERT ON payments WHEN NOT EXISTS (SELECT 1 FROM invoices WHERE id=NEW.invoice AND user_id=NEW.user_id AND stars=NEW.stars AND prisms=NEW.prisms AND state='pending') BEGIN SELECT RAISE(ABORT, 'Invalid invoice'); END;
-- statement-breakpoint
CREATE TRIGGER apply_credit AFTER INSERT ON payments BEGIN UPDATE wallets SET prisms=prisms+NEW.prisms WHERE user_id=NEW.user_id; UPDATE invoices SET state='paid' WHERE id=NEW.invoice; END;
-- statement-breakpoint
CREATE TRIGGER apply_style AFTER INSERT ON owned BEGIN UPDATE wallets SET prisms=prisms-NEW.cost WHERE user_id=NEW.user_id; END;
-- statement-breakpoint
CREATE TRIGGER apply_refund AFTER UPDATE OF refunded ON payments WHEN OLD.refunded=0 AND NEW.refunded=1 BEGIN UPDATE wallets SET prisms=prisms+(SELECT COALESCE(SUM(cost),0) FROM owned WHERE user_id=NEW.user_id)-NEW.prisms, equipped=NULL WHERE user_id=NEW.user_id; DELETE FROM owned WHERE user_id=NEW.user_id; UPDATE invoices SET state='refunded' WHERE id=NEW.invoice; END;
