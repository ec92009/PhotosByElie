CREATE TABLE google_oauth_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  binding TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX google_oauth_transactions_expiry ON google_oauth_transactions(expires_at);
