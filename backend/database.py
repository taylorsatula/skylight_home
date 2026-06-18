"""
Skylight Home - Database Layer
SQLite with WAL mode for concurrent read/write access.
"""

import sqlite3
import os
from datetime import datetime

DB_DIR = os.path.join(os.path.dirname(__file__), 'data')
DB_PATH = os.path.join(DB_DIR, 'skylight.db')

SCHEMA_VERSION = 1

CREATE_TABLES_SQL = """
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memo (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movie (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL DEFAULT '',
    year INTEGER,
    poster_url TEXT,
    rating REAL,
    blurb TEXT NOT NULL DEFAULT '',
    tmdb_id INTEGER,
    validated INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT
);
"""

SEED_DATA_SQL = """
-- Seed initial rows (INSERT OR IGNORE prevents duplicates on re-run)
INSERT OR IGNORE INTO memo (id, title, content) VALUES (
    1,
    'For Annika',
    'I love the life we have built together. My favorite part of falling asleep is reaching over and giving you a hug before I drift off. Having you in my life has been one of the greatest joys I have experienced.'
);

INSERT OR IGNORE INTO movie (id, title, year, poster_url, rating, blurb, validated) VALUES (
    1,
    'The Place Beyond the Pines',
    2012,
    NULL,
    7.3,
    'A motorcycle stunt rider turns to robbing banks as a way to provide for his lover and their newborn child, a decision that puts him on a collision course with an ambitious rookie cop navigating a department ruled by a corrupt detective.',
    1
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('display_override', NULL);
"""


def get_db():
    """Get a database connection with row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    """Initialize database, create tables, seed data if empty."""
    os.makedirs(DB_DIR, exist_ok=True)

    conn = get_db()
    try:
        conn.executescript(CREATE_TABLES_SQL)
        conn.executescript(SEED_DATA_SQL)
        conn.commit()
    finally:
        conn.close()
