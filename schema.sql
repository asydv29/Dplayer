CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT,picture TEXT,password_hash TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,drive_file_id TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS likes (user_id TEXT NOT NULL,video_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY (user_id,video_id));
CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL,video_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY (user_id,video_id));
CREATE TABLE IF NOT EXISTS views (user_id TEXT NOT NULL,video_id TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS video_thumbnails (user_id TEXT NOT NULL,video_id TEXT NOT NULL,mime_type TEXT NOT NULL,image_data BLOB NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY (user_id,video_id));
CREATE TABLE IF NOT EXISTS video_shorts (user_id TEXT NOT NULL,video_id TEXT NOT NULL,is_short INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY (user_id,video_id));
