import dotenv from 'dotenv';

import {
  NovelUpdatePayload,
  getChapterById,
  getNovelById,
  listChaptersByNovelId,
  listNovels,
  upsertChapter,
  upsertNovelByUrl,
  connectDB,
  disconnectDB
} from './models/Novel.js';

dotenv.config();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type JsonRecord = Record<string, unknown>;

export interface ApiDependencies {
  listNovels: (options: {
    limit?: number;
    offset?: number;
    search?: string;
  }) => Promise<{ data: unknown[]; total: number }>;
  getNovelById: (novelId: number) => Promise<unknown | null>;
  upsertNovelByUrl: (novelUrl: string, payload: NovelUpdatePayload) => Promise<unknown | null>;
  listChaptersByNovelId: (
    novelId: number,
    options: { limit?: number; offset?: number }
  ) => Promise<{ data: unknown[]; total: number }>;
  upsertChapter: (
    novelId: number,
    chapter: { chapterNumber: number; url: string; title: string; content: string }
  ) => Promise<unknown | null>;
  getChapterById: (chapterId: number) => Promise<unknown | null>;
  connectDB: () => Promise<void>;
  disconnectDB: () => Promise<void>;
}

const defaultDependencies: ApiDependencies = {
  listNovels,
  getNovelById,
  upsertNovelByUrl,
  listChaptersByNovelId,
  upsertChapter,
  getChapterById,
  connectDB,
  disconnectDB
};

function jsonResponse(status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
}

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseListOptions(
  searchParams: URLSearchParams
): {
  options?: {
    limit?: number;
    offset?: number;
    page: number;
    pageSize: number;
  };
  error?: string;
} {
  const rawPage = searchParams.get('page');
  const rawPageSize = searchParams.get('pageSize');
  const rawLimit = searchParams.get('limit');
  const rawOffset = searchParams.get('offset');
  const isPageBased = rawPage !== null || rawPageSize !== null;

  if (isPageBased && (rawLimit !== null || rawOffset !== null)) {
    return { error: 'Use either "page/pageSize" or "limit/offset", not both.' };
  }

  if (isPageBased) {
    let page = 1;
    if (rawPage !== null) {
      const parsedPage = parsePositiveInt(rawPage);
      if (parsedPage === null) {
        return { error: 'Query param "page" must be a positive integer.' };
      }
      page = parsedPage;
    }

    let pageSize = DEFAULT_LIMIT;
    if (rawPageSize !== null) {
      const parsedPageSize = parsePositiveInt(rawPageSize);
      if (parsedPageSize === null) {
        return { error: 'Query param "pageSize" must be a positive integer.' };
      }
      pageSize = Math.min(parsedPageSize, MAX_LIMIT);
    }

    return {
      options: {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        page,
        pageSize
      }
    };
  }

  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const parsedLimit = parsePositiveInt(rawLimit);
    if (parsedLimit === null) {
      return { error: 'Query param "limit" must be a positive integer.' };
    }
    limit = Math.min(parsedLimit, MAX_LIMIT);
  }

  let offset = 0;
  if (rawOffset !== null) {
    const parsedOffset = parseNonNegativeInt(rawOffset);
    if (parsedOffset === null) {
      return { error: 'Query param "offset" must be a non-negative integer.' };
    }
    offset = parsedOffset;
  }

  return {
    options: {
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit
    }
  };
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }

  return body as Record<string, unknown>;
}

function parseNovelPayload(body: Record<string, unknown>): { payload?: NovelUpdatePayload; novelUrl?: string; error?: string } {
  const title = body.title;
  const novelUrl = body.novelUrl;

  if (typeof title !== 'string' || title.trim() === '') {
    return { error: 'Field "title" is required and must be a non-empty string.' };
  }

  if (typeof novelUrl !== 'string' || novelUrl.trim() === '') {
    return { error: 'Field "novelUrl" is required and must be a non-empty string.' };
  }

  const ratingValue = body.rating;
  let rating: number | null = null;
  if (ratingValue !== undefined && ratingValue !== null) {
    if (typeof ratingValue !== 'number' || Number.isNaN(ratingValue) || ratingValue < 0 || ratingValue > 10) {
      return { error: 'Field "rating" must be a number between 0 and 10 or null.' };
    }
    rating = ratingValue;
  }

  const genresValue = body.genres;
  let genres: string[] = [];
  if (genresValue !== undefined) {
    if (!Array.isArray(genresValue) || !genresValue.every((genre) => typeof genre === 'string')) {
      return { error: 'Field "genres" must be an array of strings.' };
    }
    genres = genresValue;
  }

  const lastScrapedValue = body.lastScraped;
  let lastScraped = new Date();
  if (typeof lastScrapedValue === 'string') {
    const parsedDate = new Date(lastScrapedValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: 'Field "lastScraped" must be a valid ISO date string when provided.' };
    }
    lastScraped = parsedDate;
  }

  const payload: NovelUpdatePayload = {
    title: title.trim(),
    author: typeof body.author === 'string' ? body.author : null,
    rank: typeof body.rank === 'string' ? body.rank : null,
    totalChapters: typeof body.totalChapters === 'string' ? body.totalChapters : null,
    views: typeof body.views === 'string' ? body.views : null,
    bookmarks: typeof body.bookmarks === 'string' ? body.bookmarks : null,
    status: typeof body.status === 'string' ? body.status : null,
    genres,
    summary: typeof body.summary === 'string' ? body.summary : null,
    chaptersUrl: typeof body.chaptersUrl === 'string' ? body.chaptersUrl : null,
    imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : null,
    rating,
    lastScraped
  };

  return { payload, novelUrl: novelUrl.trim() };
}

function parseChapterPayload(body: Record<string, unknown>): {
  chapter?: { chapterNumber: number; url: string; title: string; content: string };
  error?: string;
} {
  const chapterNumber = body.chapterNumber;
  const url = body.url;
  const title = body.title;
  const content = body.content;

  if (typeof chapterNumber !== 'number' || !Number.isInteger(chapterNumber) || chapterNumber <= 0) {
    return { error: 'Field "chapterNumber" is required and must be a positive integer.' };
  }
  if (typeof url !== 'string' || url.trim() === '') {
    return { error: 'Field "url" is required and must be a non-empty string.' };
  }
  if (typeof title !== 'string' || title.trim() === '') {
    return { error: 'Field "title" is required and must be a non-empty string.' };
  }
  if (typeof content !== 'string' || content.trim() === '') {
    return { error: 'Field "content" is required and must be a non-empty string.' };
  }

  return {
    chapter: {
      chapterNumber,
      url: url.trim(),
      title: title.trim(),
      content: content.trim()
    }
  };
}

export function createApiHandler(deps: ApiDependencies = defaultDependencies) {
  return async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    try {
      if (method === 'GET' && pathname === '/health') {
        return jsonResponse(200, { ok: true });
      }

      if (method === 'GET' && pathname === '/novels') {
        const { options, error } = parseListOptions(url.searchParams);
        if (!options) {
          return jsonResponse(400, { error });
        }

        const searchQuery = url.searchParams.get('search')?.trim();
        const novelsResult = await deps.listNovels({
          ...options,
          search: searchQuery ? searchQuery : undefined
        });

        const total = novelsResult.total;
        const pageSize = options.pageSize;

        return jsonResponse(200, {
          data: novelsResult.data,
          meta: {
            count: novelsResult.data.length,
            total,
            page: options.page,
            pageSize,
            totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
            hasNextPage: (options.offset ?? 0) + novelsResult.data.length < total,
            hasPreviousPage: options.page > 1,
            limit: options.limit ?? DEFAULT_LIMIT,
            offset: options.offset ?? 0
          }
        });
      }

      const novelIdMatch = pathname.match(/^\/novels\/(\d+)$/);
      if (method === 'GET' && novelIdMatch) {
        const novelId = Number(novelIdMatch[1]);
        const novel = await deps.getNovelById(novelId);
        if (!novel) {
          return jsonResponse(404, { error: `Novel with id ${novelId} not found.` });
        }
        return jsonResponse(200, { data: novel });
      }

      if (method === 'POST' && pathname === '/novels') {
        const body = await readJsonBody(request);
        if (!body) {
          return jsonResponse(400, { error: 'Request body must be a valid JSON object.' });
        }

        const { payload, novelUrl, error } = parseNovelPayload(body);
        if (!payload || !novelUrl) {
          return jsonResponse(400, { error });
        }

        const novel = await deps.upsertNovelByUrl(novelUrl, payload);
        if (!novel) {
          return jsonResponse(500, { error: 'Failed to persist novel.' });
        }

        return jsonResponse(200, { data: novel });
      }

      const novelChapterMatch = pathname.match(/^\/novels\/(\d+)\/chapters$/);
      if (method === 'GET' && novelChapterMatch) {
        const novelId = Number(novelChapterMatch[1]);
        const novel = await deps.getNovelById(novelId);
        if (!novel) {
          return jsonResponse(404, { error: `Novel with id ${novelId} not found.` });
        }

        const { options, error } = parseListOptions(url.searchParams);
        if (!options) {
          return jsonResponse(400, { error });
        }

        const chaptersResult = await deps.listChaptersByNovelId(novelId, options);
        const total = chaptersResult.total;
        const pageSize = options.pageSize;

        return jsonResponse(200, {
          data: chaptersResult.data,
          meta: {
            novelId,
            count: chaptersResult.data.length,
            total,
            page: options.page,
            pageSize,
            totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
            hasNextPage: (options.offset ?? 0) + chaptersResult.data.length < total,
            hasPreviousPage: options.page > 1,
            limit: options.limit ?? DEFAULT_LIMIT,
            offset: options.offset ?? 0
          }
        });
      }

      if (method === 'POST' && novelChapterMatch) {
        const novelId = Number(novelChapterMatch[1]);
        const novel = await deps.getNovelById(novelId);
        if (!novel) {
          return jsonResponse(404, { error: `Novel with id ${novelId} not found.` });
        }

        const body = await readJsonBody(request);
        if (!body) {
          return jsonResponse(400, { error: 'Request body must be a valid JSON object.' });
        }

        const { chapter, error } = parseChapterPayload(body);
        if (!chapter) {
          return jsonResponse(400, { error });
        }

        const persistedChapter = await deps.upsertChapter(novelId, chapter);
        if (!persistedChapter) {
          return jsonResponse(500, { error: 'Failed to persist chapter.' });
        }

        return jsonResponse(200, { data: persistedChapter });
      }

      const chapterIdMatch = pathname.match(/^\/chapters\/(\d+)$/);
      if (method === 'GET' && chapterIdMatch) {
        const chapterId = Number(chapterIdMatch[1]);
        const chapter = await deps.getChapterById(chapterId);
        if (!chapter) {
          return jsonResponse(404, { error: `Chapter with id ${chapterId} not found.` });
        }
        return jsonResponse(200, { data: chapter });
      }

      return jsonResponse(404, { error: 'Route not found.' });
    } catch (error) {
      console.error('API request error:', error);
      return jsonResponse(500, { error: 'Internal server error.' });
    }
  };
}

export async function startApiServer(deps: ApiDependencies = defaultDependencies): Promise<void> {
  await deps.connectDB();

  const port = Number(process.env.PORT ?? 3000);
  const server = Bun.serve({
    port,
    fetch: createApiHandler(deps)
  });

  console.log(`Bun API server listening on port ${port}`);

  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    console.log(`Received ${signal}, shutting down API server...`);
    server.stop(true);
    await deps.disconnectDB();
    process.exit(0);
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

if (import.meta.main) {
  await startApiServer();
}
