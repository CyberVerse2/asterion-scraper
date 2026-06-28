import { runQuery } from './Novel.js';

export interface IUser {
  id: number;
  clerkUserId: string;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILibraryEntry {
  id: number;
  userId: number;
  novelId: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBookmark {
  id: number;
  userId: number;
  novelId: number;
  chapterId: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IReadingProgress {
  id: number;
  userId: number;
  novelId: number;
  chapterId: number;
  currentLine: number;
  totalLines: number;
  percentage: number | null;
  updatedAt: Date;
}

export interface IReadingHistoryEntry {
  id: number;
  userId: number;
  novelId: number;
  chapterId: number;
  visitedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserPreferences {
  id: number;
  userId: number;
  readingGoal: number;
  darkMode: boolean;
  notificationsOn: boolean;
  fontSizePref: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserStats {
  chaptersRead: number;
  novelsInProgress: number;
  bookmarks: number;
}

function mapUserRow(row: any): IUser {
  return {
    id: Number(row.id),
    clerkUserId: String(row.clerk_user_id),
    email: row.email ?? null,
    username: row.username ?? null,
    avatarUrl: row.avatar_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLibraryRow(row: any): ILibraryEntry {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    novelId: Number(row.novel_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBookmarkRow(row: any): IBookmark {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    novelId: Number(row.novel_id),
    chapterId: Number(row.chapter_id),
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProgressRow(row: any): IReadingProgress {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    novelId: Number(row.novel_id),
    chapterId: Number(row.chapter_id),
    currentLine: Number(row.current_line),
    totalLines: Number(row.total_lines),
    percentage: row.percentage === null ? null : Number(row.percentage),
    updatedAt: row.updated_at,
  };
}

function mapHistoryRow(row: any): IReadingHistoryEntry {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    novelId: Number(row.novel_id),
    chapterId: Number(row.chapter_id),
    visitedAt: row.visited_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreferencesRow(row: any): IUserPreferences {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    readingGoal: Number(row.reading_goal),
    darkMode: Boolean(row.dark_mode),
    notificationsOn: Boolean(row.notifications_on),
    fontSizePref: String(row.font_size_pref),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function initUserTables(): Promise<void> {
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      clerk_user_id TEXT UNIQUE NOT NULL,
      email TEXT,
      username TEXT,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS user_library (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      novel_id BIGINT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, novel_id)
    );
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS user_bookmarks (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      novel_id BIGINT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS user_reading_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      novel_id BIGINT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      current_line INTEGER NOT NULL DEFAULT 0,
      total_lines INTEGER NOT NULL DEFAULT 0,
      percentage DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, novel_id)
    );
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS user_reading_history (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      novel_id BIGINT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_id BIGINT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await runQuery(`
    CREATE INDEX IF NOT EXISTS idx_user_history_user_id ON user_reading_history (user_id);
  `);

  await runQuery(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reading_goal INTEGER NOT NULL DEFAULT 0,
      dark_mode BOOLEAN NOT NULL DEFAULT false,
      notifications_on BOOLEAN NOT NULL DEFAULT false,
      font_size_pref TEXT NOT NULL DEFAULT 'medium',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function findOrCreateUser(clerkUserId: string): Promise<IUser> {
  const inserted = await runQuery(
    `INSERT INTO users (clerk_user_id) VALUES ($1)
     ON CONFLICT (clerk_user_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [clerkUserId]
  );

  if (inserted.rows.length > 0) {
    return mapUserRow(inserted.rows[0]);
  }

  const existing = await runQuery(
    'SELECT * FROM users WHERE clerk_user_id = $1 LIMIT 1',
    [clerkUserId]
  );

  return mapUserRow(existing.rows[0]);
}

export async function getUserById(userId: number): Promise<IUser | null> {
  const result = await runQuery(
    'SELECT * FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );

  if (result.rows.length === 0) return null;
  return mapUserRow(result.rows[0]);
}

export async function updateUser(
  userId: number,
  fields: { email?: string | null; username?: string | null; avatarUrl?: string | null }
): Promise<IUser | null> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (fields.email !== undefined) {
    sets.push(`email = $${idx++}`);
    values.push(fields.email);
  }
  if (fields.username !== undefined) {
    sets.push(`username = $${idx++}`);
    values.push(fields.username);
  }
  if (fields.avatarUrl !== undefined) {
    sets.push(`avatar_url = $${idx++}`);
    values.push(fields.avatarUrl);
  }

  if (sets.length === 0) {
    return getUserById(userId);
  }

  sets.push(`updated_at = NOW()`);
  values.push(userId);

  const result = await runQuery(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  if (result.rows.length === 0) return null;
  return mapUserRow(result.rows[0]);
}

export async function getUserStats(userId: number): Promise<IUserStats> {
  const progressResult = await runQuery(
    'SELECT COUNT(*)::INTEGER AS count FROM user_reading_progress WHERE user_id = $1',
    [userId]
  );

  const bookmarksResult = await runQuery(
    'SELECT COUNT(*)::INTEGER AS count FROM user_bookmarks WHERE user_id = $1',
    [userId]
  );

  return {
    chaptersRead: 0,
    novelsInProgress: Number(progressResult.rows[0]?.count ?? 0),
    bookmarks: Number(bookmarksResult.rows[0]?.count ?? 0),
  };
}

export async function getReadingProgress(
  userId: number,
  novelId?: number
): Promise<IReadingProgress[]> {
  if (novelId !== undefined) {
    const result = await runQuery(
      'SELECT * FROM user_reading_progress WHERE user_id = $1 AND novel_id = $2',
      [userId, novelId]
    );
    return result.rows.map(mapProgressRow);
  }

  const result = await runQuery(
    'SELECT * FROM user_reading_progress WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId]
  );
  return result.rows.map(mapProgressRow);
}

export async function upsertReadingProgress(
  userId: number,
  novelId: number,
  chapterId: number,
  currentLine: number,
  totalLines: number,
  percentage?: number | null
): Promise<IReadingProgress> {
  const result = await runQuery(
    `
      INSERT INTO user_reading_progress (user_id, novel_id, chapter_id, current_line, total_lines, percentage)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, novel_id) DO UPDATE SET
        chapter_id = EXCLUDED.chapter_id,
        current_line = EXCLUDED.current_line,
        total_lines = EXCLUDED.total_lines,
        percentage = EXCLUDED.percentage,
        updated_at = NOW()
      RETURNING *
    `,
    [userId, novelId, chapterId, currentLine, totalLines, percentage ?? null]
  );

  return mapProgressRow(result.rows[0]);
}

export async function getBookmarks(userId: number): Promise<IBookmark[]> {
  const result = await runQuery(
    'SELECT * FROM user_bookmarks WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows.map(mapBookmarkRow);
}

export async function createBookmark(
  userId: number,
  novelId: number,
  chapterId: number,
  note?: string | null
): Promise<IBookmark> {
  const result = await runQuery(
    'INSERT INTO user_bookmarks (user_id, novel_id, chapter_id, note) VALUES ($1, $2, $3, $4) RETURNING *',
    [userId, novelId, chapterId, note ?? null]
  );
  return mapBookmarkRow(result.rows[0]);
}

export async function deleteBookmark(bookmarkId: number, userId: number): Promise<boolean> {
  const result = await runQuery(
    'DELETE FROM user_bookmarks WHERE id = $1 AND user_id = $2',
    [bookmarkId, userId]
  );
  return result.rowCount ? result.rowCount > 0 : false;
}

export async function getLibrary(userId: number): Promise<ILibraryEntry[]> {
  const result = await runQuery(
    'SELECT * FROM user_library WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return result.rows.map(mapLibraryRow);
}

export async function addToLibrary(userId: number, novelId: number): Promise<ILibraryEntry> {
  const result = await runQuery(
    'INSERT INTO user_library (user_id, novel_id) VALUES ($1, $2) ON CONFLICT (user_id, novel_id) DO UPDATE SET updated_at = NOW() RETURNING *',
    [userId, novelId]
  );
  return mapLibraryRow(result.rows[0]);
}

export async function removeFromLibrary(userId: number, novelId: number): Promise<boolean> {
  const result = await runQuery(
    'DELETE FROM user_library WHERE user_id = $1 AND novel_id = $2',
    [userId, novelId]
  );
  return result.rowCount ? result.rowCount > 0 : false;
}

export async function getReadingHistory(
  userId: number,
  limit: number = 20,
  offset: number = 0
): Promise<IReadingHistoryEntry[]> {
  const result = await runQuery(
    'SELECT * FROM user_reading_history WHERE user_id = $1 ORDER BY visited_at DESC LIMIT $2 OFFSET $3',
    [userId, limit, offset]
  );
  return result.rows.map(mapHistoryRow);
}

export async function addReadingHistory(
  userId: number,
  novelId: number,
  chapterId: number
): Promise<IReadingHistoryEntry> {
  const result = await runQuery(
    'INSERT INTO user_reading_history (user_id, novel_id, chapter_id) VALUES ($1, $2, $3) RETURNING *',
    [userId, novelId, chapterId]
  );
  return mapHistoryRow(result.rows[0]);
}

export async function getUserPreferences(userId: number): Promise<IUserPreferences> {
  const result = await runQuery(
    'SELECT * FROM user_preferences WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  if (result.rows.length === 0) {
    const created = await runQuery(
      'INSERT INTO user_preferences (user_id) VALUES ($1) RETURNING *',
      [userId]
    );
    return mapPreferencesRow(created.rows[0]);
  }

  return mapPreferencesRow(result.rows[0]);
}

export async function updateUserPreferences(
  userId: number,
  fields: {
    readingGoal?: number;
    darkMode?: boolean;
    notificationsOn?: boolean;
    fontSizePref?: string;
  }
): Promise<IUserPreferences> {
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (fields.readingGoal !== undefined) {
    sets.push(`reading_goal = $${idx++}`);
    values.push(fields.readingGoal);
  }
  if (fields.darkMode !== undefined) {
    sets.push(`dark_mode = $${idx++}`);
    values.push(fields.darkMode);
  }
  if (fields.notificationsOn !== undefined) {
    sets.push(`notifications_on = $${idx++}`);
    values.push(fields.notificationsOn);
  }
  if (fields.fontSizePref !== undefined) {
    sets.push(`font_size_pref = $${idx++}`);
    values.push(fields.fontSizePref);
  }

  if (sets.length === 0) {
    return getUserPreferences(userId);
  }

  sets.push(`updated_at = NOW()`);
  values.push(userId);

  await runQuery(
    `UPDATE user_preferences SET ${sets.join(', ')} WHERE user_id = $${idx}`,
    values
  );

  return getUserPreferences(userId);
}
