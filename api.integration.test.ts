import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool } from 'pg';

import { createApiHandler } from './api.js';
import { connectDB, disconnectDB } from './models/Novel.js';

let server: ReturnType<typeof Bun.serve>;
let baseUrl = '';
let cleanupPool: Pool;
let createdNovelUrl = '';

async function requestJson(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  const json = (await response.json()) as Record<string, unknown>;
  return { status: response.status, json };
}

describe('API integration tests (real DB)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for integration tests');
    }

    await connectDB();
    cleanupPool = new Pool({ connectionString: process.env.DATABASE_URL });

    server = Bun.serve({
      port: 0,
      fetch: createApiHandler()
    });

    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    if (createdNovelUrl) {
      await cleanupPool.query('DELETE FROM novels WHERE novel_url = $1', [createdNovelUrl]);
    }

    server.stop(true);
    await cleanupPool.end();
    await disconnectDB();
  });

  it('tests every endpoint against the real database', async () => {
    const health = await requestJson('GET', '/health');
    expect(health.status).toBe(200);
    expect(health.json.ok).toBe(true);

    createdNovelUrl = `https://integration-test.local/novel-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const createNovel = await requestJson('POST', '/novels', {
      title: 'Integration Test Novel',
      novelUrl: createdNovelUrl,
      author: 'Integration Runner',
      genres: ['Test'],
      rating: 7.5
    });
    expect(createNovel.status).toBe(200);

    const novel = createNovel.json.data as Record<string, unknown>;
    const novelId = Number(novel._id);
    expect(Number.isInteger(novelId)).toBe(true);
    expect(novel.title).toBe('Integration Test Novel');

    const listNovels = await requestJson(
      'GET',
      `/novels?page=1&pageSize=10&search=${encodeURIComponent('Integration Test Novel')}`
    );
    expect(listNovels.status).toBe(200);
    expect(Array.isArray(listNovels.json.data)).toBe(true);
    expect((listNovels.json.data as unknown[]).length).toBeGreaterThan(0);
    const novelsMeta = listNovels.json.meta as Record<string, unknown>;
    expect(Number(novelsMeta.page)).toBe(1);
    expect(Number(novelsMeta.pageSize)).toBe(10);
    expect(Number(novelsMeta.total)).toBeGreaterThan(0);

    const getNovel = await requestJson('GET', `/novels/${novelId}`);
    expect(getNovel.status).toBe(200);
    expect(Number((getNovel.json.data as Record<string, unknown>)._id)).toBe(novelId);

    const createChapter = await requestJson('POST', `/novels/${novelId}/chapters`, {
      chapterNumber: 1,
      url: `${createdNovelUrl}/chapter-1`,
      title: 'Integration Chapter 1',
      content: 'Integration chapter content'
    });
    expect(createChapter.status).toBe(200);

    const chapter = createChapter.json.data as Record<string, unknown>;
    const chapterId = Number(chapter._id);
    expect(Number.isInteger(chapterId)).toBe(true);
    expect(chapter.chapterNumber).toBe(1);

    const listChapters = await requestJson('GET', `/novels/${novelId}/chapters?page=1&pageSize=10`);
    expect(listChapters.status).toBe(200);
    expect(Array.isArray(listChapters.json.data)).toBe(true);
    expect((listChapters.json.data as unknown[]).length).toBeGreaterThan(0);
    const chapterListItem = (listChapters.json.data as Record<string, unknown>[])[0];
    expect(chapterListItem.content).toBeUndefined();
    const chaptersMeta = listChapters.json.meta as Record<string, unknown>;
    expect(Number(chaptersMeta.page)).toBe(1);
    expect(Number(chaptersMeta.pageSize)).toBe(10);
    expect(Number(chaptersMeta.total)).toBeGreaterThan(0);

    const getChapter = await requestJson('GET', `/chapters/${chapterId}`);
    expect(getChapter.status).toBe(200);
    expect(Number((getChapter.json.data as Record<string, unknown>)._id)).toBe(chapterId);
  }, 20000);
});
