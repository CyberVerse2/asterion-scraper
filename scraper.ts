import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import models (adjust path if necessary)
import Novel, { INovel, Chapter, IChapter } from './models/Novel.js';

// Determine __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

// --- Configuration ---
const REQUEST_DELAY_MS = 2000; // Delay between HTTP requests (milliseconds)
const DB_OPERATION_DELAY_MS = 50; // Smaller delay between DB writes
const INTER_NOVEL_DELAY_MS = 5000; // Delay in ms between processing different novels (e.g., 5 seconds)

// --- Helper Functions ---
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
  imageUrl: string | null; // Added imageUrl field
}

interface ChapterLink {
  url: string;
  title: string;
}

interface ChapterData {
  url: string;
  chapterNumber: number;
  title: string;
  content: string | null;
}

// --- Database Connection ---
async function connectDB(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    console.error('Error: MONGODB_URI is not defined in .env file');
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected successfully.');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// --- Scraping Functions ---
async function scrapeNovelDetails(novelUrl: string): Promise<NovelDetails> {
  console.log(`Fetching novel details from: ${novelUrl}`);
  try {
    await delay(REQUEST_DELAY_MS); // Delay before first request
    const { data } = await axios.get(novelUrl);
    const $ = cheerio.load(data);

    // Extract details (Selectors updated for novelfire.net as of 2025-04-24)
    const title = $('h1.novel-title').text().trim() || null;
    const author = $('.author a span[itemprop="author"]').first().text().trim() || null; // Get first author listed
    const rank = $('.rank strong').text().replace('RANK ', '').trim() || null; // Remove prefix
    const chapters = $('.header-stats span:nth-child(1) strong').text().trim() || null;
    const views = $('.header-stats span:nth-child(2) strong').text().trim() || null;
    const bookmarks = $('.header-stats span:nth-child(3) strong').text().trim() || null;
    const status = $('.header-stats span:nth-child(4) strong').text().trim() || null;
    const genres = $('.categories ul a')
      .map((i, el) => $(el).text().trim())
      .get();
    const summary = $('.summary .introduce .inner').text().trim() || null;
    let chaptersUrl = $('a.chapter-latest-container').attr('href') || null;
    let imageUrl =
      $('figure.cover img.lazy').attr('data-src') || $('figure.cover img.lazy').attr('src') || null; // Get data-src or src

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
      imageUrl
    };
  } catch (error: unknown) {
    console.error(`Error fetching or parsing novel details from ${novelUrl}:`, error);
    // Return default/null object to indicate failure but allow potential partial processing
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
      imageUrl: null
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
    const { data } = await axios.get(chapterUrl);
    const $ = cheerio.load(data);

    // Extract title (adjust selector)
    const chapterTitle = $('h1 span.chapter-title').text().trim();

    // Extract chapter content - **MODIFIED TO GET HTML**
    // Use the selector for the main content container
    const contentSelector = '#content'; // Adjust if needed!
    const rawHtmlContent = $(contentSelector).html();

    // Trim whitespace and handle potential null if selector not found
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
      // Store the raw HTML string (or null if not found)
      content: chapterContent
    };
  } catch (error) {
    console.error(
      `  - Error scraping chapter content from ${chapterUrl}:`,
      error instanceof Error ? error.message : error
    );
    // Return data indicating failure but preserving URL/number
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
    novelsProcessed: 0, // Count of novels successfully found/created in DB
    chaptersAttempted: 0,
    chaptersScrapedSuccess: 0,
    chaptersScrapedError: 0,
    chaptersWithEmptyContent: 0,
    dbNovelUpdateSuccess: 0, // Essentially same as novelsProcessed
    dbChapterUpdateSuccess: 0,
    dbErrors: 0, // Errors during DB operations (novel or chapter)
    startTime: startTime,
    endTime: 0,
    durationSeconds: 0,
    novelsSkippedOrFailed: 0 // Count of novels that failed processing entirely
  };

  // *** Define an array of starting URL(s) ***
  // Moved outside 'try' block for accessibility in 'finally'
  const startUrls = [
    'https://novelfire.net/book/lord-of-the-mysteries',
    'https://novelfire.net/book/reverend-insanity',
    'https://novelfire.net/book/infinite-mana-in-the-apocalypse', // Example additional novel
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
        // Add try block for processing a single novel
        // 1. Scrape Novel Details
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

        // Determine latest chapter number --- USE VALUE FROM DETAILS
        let latestChapterNumber: number | null = null;
        if (novelDetails.chapters) {
          const parsedChapters = parseInt(novelDetails.chapters.replace(/,/g, ''), 10); // Handle commas like in 2,303
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

        // --- Save/Update Novel Document First ---
        let savedNovel: INovel | null = null;
        console.log(`\n--- Finding/Updating ${novelDetails.title} in Database ---`);
        try {
          savedNovel = await Novel.findOneAndUpdate(
            // Use novelUrl as the primary unique identifier
            { novelUrl: startUrl },
            {
              $set: {
                title: novelDetails.title, // Update title in case it changed
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
                lastScraped: new Date() // Update last scraped time
              }
            },
            { upsert: true, new: true, runValidators: true } // Create if not found, return new doc
          );
        } catch (novelDbError) {
          stats.dbErrors++;
          console.error(
            `Error during findOneAndUpdate for novel ${novelDetails.title} (${startUrl}):`,
            novelDbError
          );
          throw novelDbError; // Re-throw to be caught by the outer try/catch for this novel
        }

        // Check if we successfully found or created the novel
        if (savedNovel) {
          console.log(`Found/Created Novel: ${savedNovel.title} (ID: ${savedNovel._id})`);
          // Increment counts ONLY if novel DB operation was successful
          stats.novelsProcessed++;
          stats.dbNovelUpdateSuccess++;

          // --- Determine Starting Chapter Number ---
          let startChapterNumber = 1;
          let highestChapterNumberInDb: number | null = null;
          try {
            const highestChapterDoc = await Chapter.findOne({ novel: savedNovel._id })
              .sort({ chapterNumber: -1 })
              .select('chapterNumber')
              .lean();

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
          // ---------------------------------

          // Check if novel is already up-to-date before starting loop
          if (startChapterNumber > latestChapterNumber) {
            console.log(
              `\nNovel "${savedNovel.title}" is already up-to-date (Last chapter in DB: ${
                highestChapterNumberInDb ?? 'None'
              }, Latest online: ${latestChapterNumber}). No new chapters to process.`
            );
          } else {
            // Only proceed if there are chapters to scrape
            // 2. Loop through chapters, scrape, and save individually
            const chaptersBaseUrl = novelDetails.chaptersUrl.split('/chapters')[0];
            console.log(
              `\n--- Processing Chapters ${startChapterNumber} to ${latestChapterNumber} for ${savedNovel.title} ---`
            );

            for (let i = startChapterNumber; i <= latestChapterNumber; i++) {
              stats.chaptersAttempted++;
              const chapterUrl = `${chaptersBaseUrl}/chapter-${i}`;
              console.log(`Processing Chapter ${i}/${latestChapterNumber}: ${chapterUrl}`);
              try {
                // Try scraping and saving a single chapter
                const chapterData = await scrapeChapterContent(chapterUrl, i);
                if (chapterData.content) {
                  stats.chaptersScrapedSuccess++;
                  // --- Save Chapter Immediately ---
                  try {
                    await delay(DB_OPERATION_DELAY_MS);
                    const savedChapter = await Chapter.findOneAndUpdate(
                      { novel: savedNovel._id, chapterNumber: chapterData.chapterNumber },
                      {
                        $set: {
                          url: chapterData.url,
                          title: chapterData.title,
                          content: chapterData.content
                        }
                      },
                      { upsert: true, new: true, setDefaultsOnInsert: true }
                    );
                    if (savedChapter) {
                      stats.dbChapterUpdateSuccess++;
                      console.log(
                        `  Saved/Updated Chapter ${savedChapter.chapterNumber} (ID: ${savedChapter._id})`
                      );
                      // --- Update Novel's Chapter List Immediately ---
                      try {
                        await Novel.updateOne(
                          { _id: savedNovel._id },
                          { $addToSet: { chapters: savedChapter._id } }
                        );
                        // Don't log update success every time, becomes too verbose
                      } catch (novelUpdateError) {
                        stats.dbErrors++;
                        console.error(
                          `    - Error updating Novel chapter list for chapter ${savedChapter.chapterNumber}:`,
                          novelUpdateError
                        );
                      }
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
            } // End of chapter loop for this novel
            console.log(`\n--- Finished Processing Chapters for ${savedNovel.title} ---`);
          } // End else: process chapters
        } else {
          // Handle case where novel could not be found/created after findOneAndUpdate
          console.error(
            `Failed to find or create the novel document in the database for ${startUrl}. Aborting chapter scrape for this novel.`
          );
          // stats.novelsSkippedOrFailed++; // Already handled if initial scrape failed
          stats.dbErrors++; // It's a DB error if findOneAndUpdate didn't return a doc
        } // End if(savedNovel)
      } catch (error) {
        // Catch errors specific to processing *this* URL
        console.error(`An unhandled error occurred processing ${startUrl}:`, error);
        stats.novelsSkippedOrFailed++;
        // Log the error and continue to the next novel URL
      }

      // Small delay between processing different novels
      console.log(
        `\n--- Finished processing ${startUrl}. Waiting ${
          INTER_NOVEL_DELAY_MS / 1000
        }s before next novel... ---`
      );
      await delay(INTER_NOVEL_DELAY_MS);
    } // --- End of loop for startUrls ---
  } catch (error) {
    // Catch initial connection errors or other fatal errors
    console.error('A fatal error occurred during the scraper run:', error);
    stats.novelsSkippedOrFailed = startUrls.length - stats.novelsProcessed; // Assume all remaining failed
  } finally {
    // Calculate final duration
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

    // --- Write Stats to File ---
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // Format timestamp for filename
      const statsFilename = `scraper-stats-${timestamp}.txt`;
      const statsFilePath = path.join(__dirname, statsFilename); // Place it in the script's directory

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
      console.log(`
Statistics written to: ${statsFilePath}`);
    } catch (fileError) {
      console.error(
        `
Error writing statistics to file:`,
        fileError
      );
    }
    // ---------------------------

    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
      console.log('MongoDB disconnected.');
    } else {
      console.log('MongoDB connection already closed or not established.');
    }
  }
} // End of main function

// Run the main function
main();
