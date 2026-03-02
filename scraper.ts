import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import {
  connectDB,
  disconnectDB,
  getHighestChapterForNovel,
  INovel,
  upsertChapter,
  upsertNovelByUrl
} from './models/Novel.js';

// Import shared extraction function
import { extractNovelDetailsSimple } from './utils/novel-details-extractor.js';

// Determine __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// --- Configuration ---
const REQUEST_DELAY_MS = 2000; // Delay between HTTP requests (milliseconds)
const DB_OPERATION_DELAY_MS = 50; // Smaller delay between DB writes
const INTER_NOVEL_DELAY_MS = 5000; // Delay in ms between processing different novels (e.g., 5 seconds)
const MAX_HTTP_ATTEMPTS = 4;

// --- Helper Functions ---
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const httpClient = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: 'https://novelfire.net/'
  }
});

function shouldRetryStatus(status?: number): boolean {
  return status === 403 || status === 429 || (status !== undefined && status >= 500);
}

function logAxiosError(context: string, error: unknown): void {
  if (axios.isAxiosError(error)) {
    console.error(`${context} (status: ${error.response?.status ?? 'unknown'}): ${error.message}`);
    return;
  }
  console.error(context, error);
}

async function fetchPageHtml(url: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_HTTP_ATTEMPTS; attempt++) {
    try {
      const response = await httpClient.get<string>(url);
      return response.data;
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const shouldRetry = shouldRetryStatus(status) && attempt < MAX_HTTP_ATTEMPTS;
      if (!shouldRetry) {
        throw error;
      }
      const backoffMs = 1500 * attempt;
      console.warn(
        `Request failed for ${url} with status ${status ?? 'unknown'} (attempt ${attempt}/${MAX_HTTP_ATTEMPTS}). Retrying in ${backoffMs}ms...`
      );
      await delay(backoffMs);
    }
  }
  throw new Error(`Failed to fetch ${url} after ${MAX_HTTP_ATTEMPTS} attempts`);
}

// --- Interfaces & Types ---
interface NovelDetails {
  title: string | null;
  author: string | null;
  rank: string | null;
  chapters: string | null;
  views: string | null;
  bookmarks: string | null;
  status: string | null;
  genres: string[];
  summary: string | null;
  chaptersUrl: string | null;
  imageUrl: string | null;
  rating: number | null;
}

interface ChapterData {
  url: string;
  chapterNumber: number;
  title: string;
  content: string | null;
}

// --- Scraping Functions ---
async function scrapeNovelDetails(novelUrl: string): Promise<NovelDetails> {
  console.log(`Fetching novel details from: ${novelUrl}`);
  try {
    await delay(REQUEST_DELAY_MS); // Delay before first request
    const data = await fetchPageHtml(novelUrl);
    const $ = cheerio.load(data);

    // Extract details (Selectors updated for novelfire.net as of 2025-04-24)
    const title = $('h1.novel-title').text().trim() || null;
    const author = $('.author a span[itemprop="author"]').first().text().trim() || null;
    const rank = $('.rank strong').text().replace('RANK ', '').trim() || null;
    const chapters = $('.header-stats span:nth-child(1) strong').text().trim() || null;
    const views = $('.header-stats span:nth-child(2) strong').text().trim() || null;
    const bookmarks = $('.header-stats span:nth-child(3) strong').text().trim() || null;
    const status = $('.header-stats span:nth-child(4) strong').text().trim() || null;
    const genres = $('.categories ul a')
      .map((i, el) => $(el).text().trim())
      .get();

    const extractedDetails = extractNovelDetailsSimple($);
    const summary = extractedDetails.summary;
    const rating = extractedDetails.rating;

    let chaptersUrl = $('a.chapter-latest-container').attr('href') || null;
    let imageUrl =
      $('figure.cover img').attr('src') ||
      $('figure.cover img').attr('data-src') ||
      null;

    // Ensure chaptersUrl is absolute
    if (chaptersUrl && !chaptersUrl.startsWith('http')) {
      const baseUrl = new URL(novelUrl).origin;
      chaptersUrl = new URL(chaptersUrl, baseUrl).href;
    }

    // Ensure imageUrl is absolute
    if (imageUrl && !imageUrl.startsWith('http')) {
      const baseUrl = new URL(novelUrl).origin;
      imageUrl = new URL(imageUrl, baseUrl).href;
    }

    return {
      title,
      author,
      rank,
      chapters,
      views,
      bookmarks,
      status,
      genres,
      summary,
      chaptersUrl,
      imageUrl,
      rating
    };
  } catch (error: unknown) {
    logAxiosError(`Error fetching or parsing novel details from ${novelUrl}`, error);
    return {
      title: null,
      author: null,
      rank: null,
      chapters: null,
      views: null,
      bookmarks: null,
      status: null,
      genres: [],
      summary: null,
      chaptersUrl: null,
      imageUrl: null,
      rating: null
    };
  }
}

async function scrapeChapterContent(
  chapterUrl: string,
  chapterNumber: number
): Promise<ChapterData> {
  console.log(`Fetching chapter content from: ${chapterUrl}`);
  try {
    await delay(REQUEST_DELAY_MS); // Delay before each chapter content request
    const data = await fetchPageHtml(chapterUrl);
    const $ = cheerio.load(data);

    const chapterTitle = $('h1 span.chapter-title').text().trim();

    const contentSelector = '#content';
    const rawHtmlContent = $(contentSelector).html();
    const chapterContent = rawHtmlContent ? rawHtmlContent.trim() : null;

    if (!chapterContent) {
      console.warn(
        `  - Warning: Could not find chapter content using selector '${contentSelector}' for ${chapterUrl}`
      );
    }

    console.log(`Successfully scraped content for chapter: ${chapterTitle}`);
    return {
      url: chapterUrl,
      chapterNumber: chapterNumber,
      title: chapterTitle || 'Untitled Chapter',
      content: chapterContent
    };
  } catch (error) {
    logAxiosError(`  - Error scraping chapter content from ${chapterUrl}`, error);
    return {
      url: chapterUrl,
      chapterNumber: chapterNumber,
      title: 'Error Scraping Title',
      content: null
    };
  }
}

// --- Main Execution Logic ---
async function main() {
  const startTime = Date.now();
  const stats = {
    novelsProcessed: 0,
    chaptersAttempted: 0,
    chaptersScrapedSuccess: 0,
    chaptersScrapedError: 0,
    chaptersWithEmptyContent: 0,
    dbNovelUpdateSuccess: 0,
    dbChapterUpdateSuccess: 0,
    dbErrors: 0,
    startTime: startTime,
    endTime: 0,
    durationSeconds: 0,
    novelsSkippedOrFailed: 0
  };

  const startUrls = [
    'https://novelfire.net/book/shadow-slave',
    'https://novelfire.net/book/lord-of-the-mysteries',
    'https://novelfire.net/book/reverend-insanity',
    'https://novelfire.net/book/infinite-mana-in-the-apocalypse',
    'https://novelfire.net/book/the-beginning-after-the-end',
    'https://novelfire.net/book/omniscient-readers-viewpoint',
    'https://novelfire.net/book/advent-of-the-three-calamities',
    'https://novelfire.net/book/supreme-magus',
    'https://novelfire.net/book/why-should-i-stop-being-a-villain',
    'https://novelfire.net/book/trash-of-the-counts-family',
    'https://novelfire.net/book/lord-of-mysteries-2-circle-of-inevitability',
    'https://novelfire.net/book/under-the-oak-tree',
    'https://novelfire.net/book/i-was-mistaken-as-a-monstrous-genius-actor',
    'https://novelfire.net/book/chrysalis',
    'https://novelfire.net/book/return-of-the-mount-hua-sect',
    'https://novelfire.net/book/the-perfect-run',
    'https://novelfire.net/book/throne-of-magical-arcana',
    'https://novelfire.net/book/dimensional-descent',
    'https://novelfire.net/book/damn-reincarnation',
    'https://novelfire.net/book/supremacy-games',
    'https://novelfire.net/book/my-house-of-horrors',
    'https://novelfire.net/book/outside-of-time',
    'https://novelfire.net/book/beast-taming-starting-from-zero',
    'https://novelfire.net/book/atticuss-odyssey-reincarnated-into-a-playground',
    'https://novelfire.net/book/im-really-not-the-demon-gods-lackey',
    'https://novelfire.net/book/mother-of-learning',
    'https://novelfire.net/book/my-vampire-system',
    'https://novelfire.net/book/the-novels-extra',
    'https://novelfire.net/book/the-legendary-mechanic',
    'https://novelfire.net/book/lightning-is-the-only-way',
    'https://novelfire.net/book/kidnapped-dragons',
    'https://novelfire.net/book/ill-surpass-the-mc',
    'https://novelfire.net/book/the-desolate-era',
    'https://novelfire.net/book/i-am-the-fated-villain',
    'https://novelfire.net/book/custom-made-demon-king',
    'https://novelfire.net/book/reincarnation-of-the-strongest-sword-god',
    'https://novelfire.net/book/a-will-eternal',
    'https://novelfire.net/book/youkoso-jitsuryoku-shijou-shugi-no-kyoushitsu-e',
    'https://novelfire.net/book/jobless-reincarnation-mushoku-tensei',
    'https://novelfire.net/book/the-demon-prince-goes-to-the-academy',
    'https://novelfire.net/book/nano-machine-retranslated-version',
    'https://novelfire.net/book/omniscient-first-persons-viewpoint',
    'https://novelfire.net/book/the-bloodline-system',
    'https://novelfire.net/book/embers-ad-infinitum',
    'https://novelfire.net/book/reincarnated-with-the-strongest-system',
    'https://novelfire.net/book/jackal-among-snakes',
    'https://novelfire.net/book/i-will-kill-the-author',
    'https://novelfire.net/book/super-gene',
    'https://novelfire.net/book/birth-of-the-demonic-sword',
    'https://novelfire.net/book/library-of-heavens-path',
    'https://novelfire.net/book/hero-of-darkness',
    'https://novelfire.net/book/the-book-eating-magician',
    'https://novelfire.net/book/vainqueur-the-dragon',
    'https://novelfire.net/book/a-regressors-tale-of-cultivation',
    'https://novelfire.net/book/a-soldiers-life',
    'https://novelfire.net/book/return-of-the-frozen-player',
    'https://novelfire.net/book/ending-maker',
    'https://novelfire.net/book/kingdoms-bloodline',
    'https://novelfire.net/book/descent-of-the-demon-god',
    'https://novelfire.net/book/abandoned-by-my-childhood-friend-i-became-a-war-hero',
    'https://novelfire.net/book/reborn-as-a-demonic-tree',
    'https://novelfire.net/book/ranker-who-lives-twice',
    'https://novelfire.net/book/the-second-coming-of-gluttony',
    'https://novelfire.net/book/the-protagonists-are-murdered-by-me',
    'https://novelfire.net/book/sss-class-suicide-hunter',
    'https://novelfire.net/book/i-became-the-pope-now-what',
    'https://novelfire.net/book/the-innkeeper',
    'https://novelfire.net/book/tyranny-of-steel'
  ];

  try {
    await connectDB();

    console.log(
      `--- Starting Scraper Run for ${startUrls.length} Novel URL(s) at ${new Date(
        startTime
      ).toISOString()} ---`
    );

    // --- Loop through each URL ---
    for (const startUrl of startUrls) {
      console.log(`\n============================================================`);
      console.log(`Processing Novel URL: ${startUrl}`);
      console.log(`============================================================\n`);

      try {
        const novelDetails = await scrapeNovelDetails(startUrl);
        if (!novelDetails.title || !novelDetails.chaptersUrl) {
          console.error(
            `Could not scrape essential novel details (title/chapters URL) for ${startUrl}, skipping this novel.`
          );
          stats.novelsSkippedOrFailed++;
          continue; // Move to the next URL in startUrls
        }
        console.log(`\nSuccessfully scraped novel details for: ${novelDetails.title}`);
        console.log('\n--- Novel Details ---');
        console.log(novelDetails); // Log details for context

        let latestChapterNumber: number | null = null;
        if (novelDetails.chapters) {
          const parsedChapters = parseInt(novelDetails.chapters.replace(/,/g, ''), 10);
          if (!isNaN(parsedChapters) && parsedChapters > 0) {
            latestChapterNumber = parsedChapters;
            console.log(`\nUsing total chapters count from novel details: ${latestChapterNumber}`);
          } else {
            console.error(
              `Could not parse valid chapter count ('${novelDetails.chapters}') from novel details for ${novelDetails.title}.`
            );
          }
        } else {
          console.error(`Novel details did not contain a chapter count for ${novelDetails.title}.`);
        }

        if (latestChapterNumber === null) {
          console.error(
            `Failed to determine the latest chapter number for ${novelDetails.title}. Aborting chapter scrape for this novel.`
          );
          stats.novelsSkippedOrFailed++;
          continue; // Skip to next novel URL
        }

        let savedNovel: INovel | null = null;
        console.log(`\n--- Finding/Updating ${novelDetails.title} in Database ---`);
        try {
          savedNovel = await upsertNovelByUrl(startUrl, {
            title: novelDetails.title,
            author: novelDetails.author,
            rank: novelDetails.rank,
            totalChapters: novelDetails.chapters,
            views: novelDetails.views,
            bookmarks: novelDetails.bookmarks,
            status: novelDetails.status,
            genres: novelDetails.genres,
            summary: novelDetails.summary,
            chaptersUrl: novelDetails.chaptersUrl,
            imageUrl: novelDetails.imageUrl,
            rating: novelDetails.rating,
            lastScraped: new Date()
          });
        } catch (novelDbError) {
          stats.dbErrors++;
          console.error(
            `Error upserting novel ${novelDetails.title} (${startUrl}):`,
            novelDbError
          );
          throw novelDbError; // Re-throw to be caught by the outer try/catch for this novel
        }

        if (savedNovel) {
          console.log(`Found/Created Novel: ${savedNovel.title} (ID: ${savedNovel._id})`);
          stats.novelsProcessed++;
          stats.dbNovelUpdateSuccess++;

          let startChapterNumber = 1;
          let highestChapterNumberInDb: number | null = null;
          try {
            const highestChapterDoc = await getHighestChapterForNovel(savedNovel._id);

            if (highestChapterDoc && highestChapterDoc.chapterNumber) {
              highestChapterNumberInDb = highestChapterDoc.chapterNumber;
              startChapterNumber = highestChapterDoc.chapterNumber + 1;
              console.log(
                `\nHighest chapter found in DB for ${savedNovel.title}: ${highestChapterNumberInDb}. Resuming scrape from chapter ${startChapterNumber}.`
              );
            } else {
              console.log(
                `\nNo existing chapters found in DB for ${savedNovel.title}. Starting scrape from chapter 1.`
              );
            }
          } catch (dbError) {
            stats.dbErrors++;
            console.error(
              `Error querying for highest chapter number for ${savedNovel.title}:`,
              dbError
            );
            console.warn('Assuming start from chapter 1 due to error.');
            startChapterNumber = 1;
          }

          if (startChapterNumber > latestChapterNumber) {
            console.log(
              `\nNovel "${savedNovel.title}" is already up-to-date (Last chapter in DB: ${
                highestChapterNumberInDb ?? 'None'
              }, Latest online: ${latestChapterNumber}). No new chapters to process.`
            );
          } else {
            const chaptersBaseUrl = novelDetails.chaptersUrl.split('/chapters')[0];
            console.log(
              `\n--- Processing Chapters ${startChapterNumber} to ${latestChapterNumber} for ${savedNovel.title} ---`
            );

            for (let i = startChapterNumber; i <= latestChapterNumber; i++) {
              stats.chaptersAttempted++;
              const chapterUrl = `${chaptersBaseUrl}/chapter-${i}`;
              console.log(`Processing Chapter ${i}/${latestChapterNumber}: ${chapterUrl}`);
              try {
                const chapterData = await scrapeChapterContent(chapterUrl, i);
                if (chapterData.content) {
                  stats.chaptersScrapedSuccess++;
                  try {
                    await delay(DB_OPERATION_DELAY_MS);
                    const savedChapter = await upsertChapter(savedNovel._id, {
                      chapterNumber: chapterData.chapterNumber,
                      url: chapterData.url,
                      title: chapterData.title,
                      content: chapterData.content
                    });
                    if (savedChapter) {
                      stats.dbChapterUpdateSuccess++;
                      console.log(
                        `  Saved/Updated Chapter ${savedChapter.chapterNumber} (ID: ${savedChapter._id})`
                      );
                    } else {
                      console.warn(
                        `  DB op ok, but failed to get Chapter ${chapterData.chapterNumber} doc back.`
                      );
                      stats.dbErrors++;
                    }
                  } catch (chapterDbError) {
                    stats.dbErrors++;
                    console.error(
                      `  Error saving chapter ${chapterData.chapterNumber} to DB:`,
                      chapterDbError
                    );
                  }
                } else {
                  stats.chaptersWithEmptyContent++;
                  console.warn(
                    `Chapter ${i} scraped but content was empty or not found. Skipping save.`
                  );
                }

                // Add request delay *after* processing a chapter
                await delay(REQUEST_DELAY_MS);
              } catch (chapterScrapeError) {
                // Catch error scraping/saving this specific chapter
                stats.chaptersScrapedError++;
                console.error(`Error processing chapter ${i} (${chapterUrl}):`, chapterScrapeError);
                // Continue to the next chapter even if one fails
              }
            }
            console.log(`\n--- Finished Processing Chapters for ${savedNovel.title} ---`);
          }
        } else {
          console.error(
            `Failed to find or create the novel document in the database for ${startUrl}. Aborting chapter scrape for this novel.`
          );
          stats.dbErrors++;
        }
      } catch (error) {
        console.error(`An unhandled error occurred processing ${startUrl}:`, error);
        stats.novelsSkippedOrFailed++;
      }

      // Small delay between processing different novels
      console.log(
        `\n--- Finished processing ${startUrl}. Waiting ${
          INTER_NOVEL_DELAY_MS / 1000
        }s before next novel... ---`
      );
      await delay(INTER_NOVEL_DELAY_MS);
    }
  } catch (error) {
    console.error('A fatal error occurred during the scraper run:', error);
    stats.novelsSkippedOrFailed = startUrls.length - stats.novelsProcessed; // Assume all remaining failed
  } finally {
    stats.endTime = Date.now();
    stats.durationSeconds = (stats.endTime - stats.startTime) / 1000;

    console.log(`\n--- Scraper Run Finished ---`);
    console.log(`Total Duration: ${stats.durationSeconds.toFixed(2)} seconds`);
    console.log(`URLs Attempted:   ${startUrls.length}`);
    console.log(`Novels Processed (DB OK): ${stats.novelsProcessed}`);
    console.log(`Novels Skipped/Failed: ${stats.novelsSkippedOrFailed}`);
    console.log(`Total Chapters Attempted:  ${stats.chaptersAttempted}`);
    console.log(`  - Scraped Successfully:  ${stats.chaptersScrapedSuccess}`);
    console.log(`  - Scraped Empty/Miss:    ${stats.chaptersWithEmptyContent}`);
    console.log(`  - Scrape Errors:         ${stats.chaptersScrapedError}`);
    console.log(`DB Novel Updates OK:   ${stats.dbNovelUpdateSuccess}`);
    console.log(`DB Chapter Updates OK: ${stats.dbChapterUpdateSuccess}`);
    console.log(`Total Database Errors: ${stats.dbErrors}`);

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const statsFilename = `scraper-stats-${timestamp}.txt`;
      const statsFilePath = path.join(__dirname, statsFilename);

      const statsString = `--- Scraper Run Finished ---
Timestamp: ${new Date(stats.endTime).toISOString()}
Total Duration: ${stats.durationSeconds.toFixed(2)} seconds

--- URLs --- 
URLs Attempted:   ${startUrls.length}

--- Novels ---
Novels Processed (DB OK): ${stats.novelsProcessed}
Novels Skipped/Failed: ${stats.novelsSkippedOrFailed}

--- Chapters ---
Total Chapters Attempted:  ${stats.chaptersAttempted}
  - Scraped Successfully:  ${stats.chaptersScrapedSuccess}
  - Scraped Empty/Miss:    ${stats.chaptersWithEmptyContent}
  - Scrape Errors:         ${stats.chaptersScrapedError}

--- Database Operations ---
DB Novel Updates OK:   ${stats.dbNovelUpdateSuccess}
DB Chapter Updates OK: ${stats.dbChapterUpdateSuccess}
Total Database Errors: ${stats.dbErrors}
`;

      fs.writeFileSync(statsFilePath, statsString);
      console.log(`\nStatistics written to: ${statsFilePath}`);
    } catch (fileError) {
      console.error(`\nError writing statistics to file:`, fileError);
    }

    await disconnectDB();
    console.log('PostgreSQL disconnected.');
  }
}

main();
