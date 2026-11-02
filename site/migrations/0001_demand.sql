-- One row per platform: its name and an anonymous count. Nothing else is stored.
CREATE TABLE IF NOT EXISTS demand (
  platform TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
