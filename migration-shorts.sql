-- Adds manual Shorts override support. Automatic classification (videos
-- <=60s) needs no schema change; this table only stores explicit
-- user overrides in either direction (force-in or force-out of Shorts).
CREATE TABLE IF NOT EXISTS video_shorts (
  user_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  is_short INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id,video_id)
);
