import { Pool } from 'pg';

export interface INovel {
  _id: number;
  title: string;
  novelUrl: string | null;
  author: string | null;
  rank: string | null;
  totalChapters: string | null;
  views: string | null;
  bookmarks: string | null;
  status: string | null;
  genres: string[];
  summary: string | null;
  chaptersUrl: string | null;
  imageUrl: string | null;
  rating: number | null;
  lastScraped: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IChapter {
  _id: number;
  novelId: number;
  chapterNumber: number;
  url: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NovelUpdatePayload {
  title: string;
  author: string | null;
  rank: string | null;
  totalChapters: string | null;
  views: string | null;
  bookmarks: string | null;
  status: string | null;
  genres: string[];
  summary: string | null;
  chaptersUrl: string | null;
  imageUrl: string | null;
  rating: number | null;
  lastScraped: Date;
}

const connectionString = process.env.DATABASE_URL;
const pool = new Pool(connectionString ? { connectionString } : undefined);
let schemaInitialized = false;

function mapNovelRow(row: any): INovel {
  return {
    _id: row.id,
    title: row.title,
    novelUrl: row.novel_url,
    author: row.author,
    rank: row.rank,
    totalChapters: row.total_chapters,
    views: row.views,
    bookmarks: row.bookmarks,
    status: row.status,
    genres: Array.isArray(row.genres) ? row.genres : [],
    summary: row.summary,
    chaptersUrl: row.chapters_url,
    imageUrl: row.image_url,
    rating: row.rating === null ? null : Number(row.rating),
    lastScraped: row.last_scraped,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapChapterRow(row: any): IChapter {
  return {
    _id: row.id,
    novelId: row.novel_id,
    chapterNumber: row.chapter_number,
    url: row.url,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function initializeSchema(): Promise<void> {
  if (schemaInitialized) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS novels (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      novel_url TEXT UNIQUE,
      author TEXT,
      rank TEXT,
      total_chapters TEXT,
      views TEXT,
      bookmarks TEXT,
      status TEXT,
      genres TEXT[] NOT NULL DEFAULT '{}',
      summary TEXT,
      chapters_url TEXT,
      image_url TEXT,
      rating DOUBLE PRECISION,
      last_scraped TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT rating_range CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10))
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chapters (
      id BIGSERIAL PRIMARY KEY,
      novel_id BIGINT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
      chapter_number INTEGER NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (novel_id, chapter_number)
    );
  `);

  schemaInitialized = true;
}

export async function connectDB(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL is not defined in .env file');
    process.exit(1);
  }

  try {
    await initializeSchema();
    console.log('PostgreSQL connected successfully.');
  } catch (err) {
    console.error('PostgreSQL connection error:', err);
    process.exit(1);
  }
}

export async function disconnectDB(): Promise<void> {
  await pool.end();
}

export async function upsertNovelByUrl(
  novelUrl: string,
  payload: NovelUpdatePayload
): Promise<INovel | null> {
  const result = await pool.query(
    `
      INSERT INTO novels (
        title, novel_url, author, rank, total_chapters, views, bookmarks, status,
        genres, summary, chapters_url, image_url, rating, last_scraped
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (novel_url) DO UPDATE SET
        title = EXCLUDED.title,
        author = EXCLUDED.author,
        rank = EXCLUDED.rank,
        total_chapters = EXCLUDED.total_chapters,
        views = EXCLUDED.views,
        bookmarks = EXCLUDED.bookmarks,
        status = EXCLUDED.status,
        genres = EXCLUDED.genres,
        summary = EXCLUDED.summary,
        chapters_url = EXCLUDED.chapters_url,
        image_url = EXCLUDED.image_url,
        rating = EXCLUDED.rating,
        last_scraped = EXCLUDED.last_scraped,
        updated_at = NOW()
      RETURNING *
    `,
    [
      payload.title,
      novelUrl,
      payload.author,
      payload.rank,
      payload.totalChapters,
      payload.views,
      payload.bookmarks,
      payload.status,
      payload.genres,
      payload.summary,
      payload.chaptersUrl,
      payload.imageUrl,
      payload.rating,
      payload.lastScraped
    ]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapNovelRow(result.rows[0]);
}

export async function getHighestChapterForNovel(
  novelId: number
): Promise<{ chapterNumber: number } | null> {
  const result = await pool.query(
    `
      SELECT chapter_number
      FROM chapters
      WHERE novel_id = $1
      ORDER BY chapter_number DESC
      LIMIT 1
    `,
    [novelId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return { chapterNumber: result.rows[0].chapter_number };
}

export async function upsertChapter(
  novelId: number,
  chapter: { chapterNumber: number; url: string; title: string; content: string }
): Promise<IChapter | null> {
  const result = await pool.query(
    `
      INSERT INTO chapters (novel_id, chapter_number, url, title, content)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (novel_id, chapter_number) DO UPDATE SET
        url = EXCLUDED.url,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        updated_at = NOW()
      RETURNING *
    `,
    [novelId, chapter.chapterNumber, chapter.url, chapter.title, chapter.content]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapChapterRow(result.rows[0]);
}

export async function findNovelsMissingData(options: {
  summariesOnly: boolean;
  ratingsOnly: boolean;
  limit?: number;
}): Promise<INovel[]> {
  let whereClause = '';
  if (options.summariesOnly) {
    whereClause = `(summary IS NULL OR summary = '')`;
  } else if (options.ratingsOnly) {
    whereClause = `rating IS NULL`;
  } else {
    whereClause = `(summary IS NULL OR summary = '' OR rating IS NULL)`;
  }

  const values: any[] = [];
  let limitClause = '';
  if (options.limit) {
    values.push(options.limit);
    limitClause = `LIMIT $${values.length}`;
  }

  const result = await pool.query(
    `
      SELECT *
      FROM novels
      WHERE ${whereClause}
      ORDER BY id ASC
      ${limitClause}
    `,
    values
  );

  return result.rows.map(mapNovelRow);
}

export async function updateNovelFields(
  novelId: number,
  fields: { summary?: string; rating?: number }
): Promise<void> {
  const updates: string[] = [];
  const values: any[] = [];

  if (fields.summary !== undefined) {
    values.push(fields.summary);
    updates.push(`summary = $${values.length}`);
  }
  if (fields.rating !== undefined) {
    values.push(fields.rating);
    updates.push(`rating = $${values.length}`);
  }

  if (updates.length === 0) {
    return;
  }

  values.push(novelId);
  await pool.query(
    `
      UPDATE novels
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length}
    `,
    values
  );
}
