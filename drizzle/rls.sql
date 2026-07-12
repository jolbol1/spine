-- Row-level security policies for app tables.
-- drizzle-kit push does not reliably emit policy expressions, so this file is
-- the source of truth. Re-run after any schema push: psql -d movie -f drizzle/rls.sql

ALTER TABLE films ENABLE ROW LEVEL SECURITY;
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS films_owner ON films;
CREATE POLICY films_owner ON films
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS wishlist_owner ON wishlist_items;
CREATE POLICY wishlist_owner ON wishlist_items
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

DROP POLICY IF EXISTS user_settings_owner ON user_settings;
CREATE POLICY user_settings_owner ON user_settings
  FOR ALL
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
