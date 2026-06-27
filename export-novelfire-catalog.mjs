import fs from 'fs/promises';

const BASE_URL = 'https://novelfire.net';
const BROWSE_URL = `${BASE_URL}/genre-all/sort-new/status-all/all-novel`;
const OUTPUT_PATH = new URL('./novelfire-catalog.json', import.meta.url);
const REQUEST_STAGGER_MS = 200;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      Referer: 'https://novelfire.net/',
      'sec-ch-ua': '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'DNT': '1',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

function extractLastPage(html) {
  const matches = [...html.matchAll(/all-novel\?page=(\d+)/g)].map((match) => Number(match[1]));
  return Math.max(...matches, 1);
}

function extractNovels(html) {
  const novelPattern =
    /<li class="novel-item"><a title="([^"]+)" href="([^"]+)">[\s\S]*?<div class="novel-stats"><i class="icon-book-open"><\/i>\s*([^<]+)<\/span><\/div><\/li>/g;
  const novels = [];

  for (const match of html.matchAll(novelPattern)) {
    const [, title, relativeUrl, chapters] = match;
    novels.push({
      title,
      url: new URL(relativeUrl, BASE_URL).href,
      chapters: chapters.trim()
    });
  }

  return novels;
}

async function main() {
  const firstPageHtml = await fetchText(BROWSE_URL);
  const lastPage = extractLastPage(firstPageHtml);
  const novels = extractNovels(firstPageHtml);

  console.log(`Discovered ${lastPage} browse pages.`);
  console.log(`Page 1: ${novels.length} novels`);

  for (let page = 2; page <= lastPage; page += 1) {
    await delay(REQUEST_STAGGER_MS);
    const html = await fetchText(`${BROWSE_URL}?page=${page}`);
    const pageNovels = extractNovels(html);
    novels.push(...pageNovels);

    if (page % 25 === 0 || page === lastPage) {
      console.log(`Processed page ${page}/${lastPage} (${novels.length} novels so far)`);
    }
  }

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify(
      {
        source: BROWSE_URL,
        scrapedAt: new Date().toISOString(),
        totalNovels: novels.length,
        novels
      },
      null,
      2
    )
  );

  console.log(`Saved ${novels.length} novels to ${OUTPUT_PATH.pathname}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
