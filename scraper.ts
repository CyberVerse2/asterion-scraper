import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Novel, Chapter, INovel, IChapter } from './models/Novel.js'; // Import named exports for models and the INovel interface

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const REQUEST_DELAY_MS = 2000; // Delay between HTTP requests (milliseconds)
const DB_OPERATION_DELAY_MS = 50; // Smaller delay between DB writes

// --- Helper Functions ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
        const rank = $('.rank strong').text().replace('RANK ','').trim() || null; // Remove prefix
        const chapters = $('.header-stats span:nth-child(1) strong').text().trim() || null;
        const views = $('.header-stats span:nth-child(2) strong').text().trim() || null;
        const bookmarks = $('.header-stats span:nth-child(3) strong').text().trim() || null;
        const status = $('.header-stats span:nth-child(4) strong').text().trim() || null;
        const genres = $('.categories ul a').map((i, el) => $(el).text().trim()).get();
        const summary = $('.summary .introduce .inner').text().trim() || null;
        let chaptersUrl = $('a.chapter-latest-container').attr('href') || null;
        let imageUrl = $('figure.cover img.lazy').attr('data-src') || $('figure.cover img.lazy').attr('src') || null; // Get data-src or src

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

        return { title, author, rank, chapters, views, bookmarks, status, genres, summary, chaptersUrl, imageUrl };
    } catch (error: unknown) {
        console.error(`Error fetching or parsing novel details from ${novelUrl}:`, error);
        // Return default/null object to indicate failure but allow potential partial processing
        return { title: null, author: null, rank: null, chapters: null, views: null, bookmarks: null, status: null, genres: [], summary: null, chaptersUrl: null, imageUrl: null };
    }
}

async function scrapeChapterContent(chapterUrl: string, chapterNumber: number): Promise<ChapterData> {
    console.log(`Fetching chapter content from: ${chapterUrl}`);
    try {
        await delay(REQUEST_DELAY_MS); // Delay before each chapter content request
        const { data } = await axios.get(chapterUrl);
        const $ = cheerio.load(data);

        // Extract title (adjust selector)
        const chapterTitle = $('.wrap > h1').text().trim();

        // Extract chapter content - **MODIFIED TO GET HTML**
        // Use the selector for the main content container
        const contentSelector = '#content'; // Adjust if needed!
        const rawHtmlContent = $(contentSelector).html();

        // Trim whitespace and handle potential null if selector not found
        const chapterContent = rawHtmlContent ? rawHtmlContent.trim() : null;

        if (!chapterContent) {
            console.warn(`  - Warning: Could not find chapter content using selector '${contentSelector}' for ${chapterUrl}`);
        }

        console.log(`Successfully scraped content for chapter: ${chapterTitle}`);
        return {
            url: chapterUrl,
            chapterNumber: chapterNumber,
            title: chapterTitle || 'Untitled Chapter',
            // Store the raw HTML string (or null if not found)
            content: chapterContent,
        };
    } catch (error) {
        console.error(`  - Error scraping chapter content from ${chapterUrl}:`, error instanceof Error ? error.message : error);
        // Return data indicating failure but preserving URL/number
        return { url: chapterUrl, chapterNumber: chapterNumber, title: 'Error Scraping Title', content: null };
    }
}

async function getLatestChapterNumber(chaptersIndexUrl: string): Promise<number | null> {
    console.log(`Fetching latest chapter link from: ${chaptersIndexUrl}`);
    try {
        await delay(REQUEST_DELAY_MS);
        const { data } = await axios.get(chaptersIndexUrl);
        const $ = cheerio.load(data);
        // Assuming the first link in the chapter list is the latest
        // Adjust selector for novelfire.net if needed
        const latestChapterLink = $('.chapter-list a').first().attr('href');

        if (latestChapterLink) {
            // Extract number from URL like /book/shadow-slave/chapter-2303
            const match = latestChapterLink.match(/chapter-(\d+)$/);
            if (match && match[1]) {
                const num = parseInt(match[1], 10);
                console.log(`Latest chapter detected: ${num}`);
                return num;
            }
        }
        console.error('Could not find or parse the latest chapter link.');
        return null;
    } catch (error) {
        console.error(`Error fetching or parsing chapter index page: ${chaptersIndexUrl}`, error);
        return null;
    }
}

// --- Main Execution Logic ---
async function main() {
    const startTime = Date.now();
    const stats = {
        novelsProcessed: 0,
        chaptersAttempted: 0,
        chaptersScrapedSuccess: 0,
        chaptersScrapedError: 0, // Chapters that failed network/parsing
        chaptersWithEmptyContent: 0, // Chapters scraped but content selector failed
        dbNovelUpdateSuccess: 0,
        dbChapterUpdateSuccess: 0,
        dbErrors: 0,
        startTime: startTime,
        endTime: 0,
        durationSeconds: 0,
    };

    try {
        await connectDB();

        // *** Replace with your actual starting URL(s) ***
        const startUrl = 'https://novelfire.net/book/reverend-insanity'; // Example

        console.log(`--- Starting Scraper Run at ${new Date(startTime).toISOString()} ---`);

        // 1. Scrape Novel Details
        const novelDetails = await scrapeNovelDetails(startUrl);
        if (!novelDetails.title || !novelDetails.chaptersUrl) {
            console.error("Could not scrape essential novel details (title/chapters URL), aborting.");
            return; // Exit if core details are missing
        }
        stats.novelsProcessed++;
        console.log('\nSuccessfully scraped novel details.');
        console.log('\n--- Novel Details ---');
        console.log(novelDetails);

        // Determine latest chapter number --- USE VALUE FROM DETAILS
        let latestChapterNumber: number | null = null;
        if (novelDetails.chapters) {
            const parsedChapters = parseInt(novelDetails.chapters, 10);
            if (!isNaN(parsedChapters) && parsedChapters > 0) {
                latestChapterNumber = parsedChapters;
                console.log(`\nUsing total chapters count from novel details: ${latestChapterNumber}`);
            } else {
                console.error(`Could not parse valid chapter count ('${novelDetails.chapters}') from novel details.`);
            }
        } else {
            console.error('Novel details did not contain a chapter count.');
        }
        // --- Remove call to scrape chapter index page ---
        // const latestChapterNumber = await getLatestChapterNumber(novelDetails.chaptersUrl);

        if (latestChapterNumber === null) {
            console.error('Failed to determine the latest chapter number. Aborting chapter scrape.');
            return;
        }

        // --- Save/Update Novel Document First ---
        let savedNovel: INovel | null = null;
        if (novelDetails.title) {
            console.log(`\n--- Finding/Updating ${novelDetails.title} in Database Before Chapter Scraping ---`);
            try {
                savedNovel = await Novel.findOneAndUpdate(
                    { title: novelDetails.title },
                    {
                        $set: {
                            novelUrl: startUrl,
                            author: novelDetails.author,
                            rank: novelDetails.rank,
                            totalChapters: novelDetails.chapters,
                            views: novelDetails.views,
                            bookmarks: novelDetails.bookmarks,
                            status: novelDetails.status,
                            genres: novelDetails.genres,
                            summary: novelDetails.summary,
                            chaptersUrl: novelDetails.chaptersUrl,
                            imageUrl: novelDetails.imageUrl, // Added imageUrl
                            lastScraped: new Date(), // Update last scraped time
                        }
                    },
                    {
                        upsert: true,
                        new: true,
                        setDefaultsOnInsert: true,
                    }
                );
                if (savedNovel) {
                    stats.dbNovelUpdateSuccess++;
                    console.log(`Found/Created Novel: ${savedNovel.title} (ID: ${savedNovel._id})`);
                } else {
                    console.error("Failed to save or find novel document. Aborting chapter processing.");
                    stats.dbErrors++;
                    return; // Cannot proceed without a novel document
                }
            } catch (novelDbError) {
                stats.dbErrors++;
                console.error(`Error finding/updating novel document:`, novelDbError);
                return; // Cannot proceed without a novel document
            }
        } else {
            console.error("Novel title missing, cannot save novel or chapters.");
            return; // Cannot proceed
        }

        // 2. Loop through chapters, scrape, and save individually
        const chaptersBaseUrl = novelDetails.chaptersUrl.split('/chapters')[0];
        console.log(`\n--- Processing Chapters 1 to ${latestChapterNumber} ---`);

        for (let i = 1; i <= latestChapterNumber; i++) {
            stats.chaptersAttempted++;
            const dynamicChapterUrl = `${chaptersBaseUrl}/chapter-${i}`;
            try {
                console.log(`Processing Chapter ${i}/${latestChapterNumber}: ${dynamicChapterUrl}`);
                const chapterData = await scrapeChapterContent(dynamicChapterUrl, i);

                if (chapterData.content) {
                    stats.chaptersScrapedSuccess++;

                    // --- Save Chapter Immediately ---
                    try {
                        await delay(DB_OPERATION_DELAY_MS); // Small delay before DB write
                        const savedChapter = await Chapter.findOneAndUpdate(
                            {
                                novel: savedNovel._id, // Link to the novel
                                chapterNumber: chapterData.chapterNumber
                            },
                            {
                                $set: {
                                    url: chapterData.url,
                                    title: chapterData.title,
                                    content: chapterData.content,
                                }
                            },
                            {
                                upsert: true,
                                new: true,
                                setDefaultsOnInsert: true,
                            }
                        );
                        if (savedChapter) {
                            stats.dbChapterUpdateSuccess++;
                            console.log(`  Saved/Updated Chapter ${savedChapter.chapterNumber} (ID: ${savedChapter._id})`);

                            // --- Update Novel's Chapter List Immediately ---
                            try {
                                const updateResult = await Novel.updateOne(
                                    { _id: savedNovel._id }, // Target the novel
                                    { $addToSet: { chapters: savedChapter._id } } // Add chapter ID if not present
                                );
                                if (updateResult.modifiedCount > 0) {
                                    console.log(`    - Novel chapter list updated with Chapter ${savedChapter.chapterNumber}`);
                                } else if (updateResult.matchedCount === 1 && updateResult.modifiedCount === 0) {
                                    console.log(`    - Chapter ${savedChapter.chapterNumber} ID already in Novel list.`);
                                }
                                // else: matchedCount = 0 means novel ID wasn't found, which shouldn't happen here

                            } catch (novelUpdateError) {
                                stats.dbErrors++; // Count as DB Error
                                console.error(`    - Error updating Novel chapter list for chapter ${savedChapter.chapterNumber}:`, novelUpdateError);
                            }
                            // -------------------------------------------

                        } else {
                            console.warn(`  DB op ok, but failed to get Chapter ${chapterData.chapterNumber} doc back.`);
                            stats.dbErrors++;
                        }
                    } catch (chapterDbError) {
                        stats.dbErrors++;
                        console.error(`  Error saving chapter ${chapterData.chapterNumber} to DB:`, chapterDbError);
                    }
                    // -------------------------------

                } else {
                    stats.chaptersWithEmptyContent++;
                    console.warn(`Chapter ${i} scraped but content was empty or not found. Skipping save.`);
                }

                if (i % 50 === 0) {
                    console.log(`--- Progress: Processed up to chapter ${i} ---`);
                }

            } catch (chapterScrapeError) {
                stats.chaptersScrapedError++;
                console.error(`Error scraping chapter ${i} (${dynamicChapterUrl}):`, chapterScrapeError);
            }
        }

        console.log('\n--- Finished Processing Chapters ---');
        console.log(`Attempted: ${stats.chaptersAttempted}, Scraped OK: ${stats.chaptersScrapedSuccess}, Empty Content: ${stats.chaptersWithEmptyContent}, Scrape Errors: ${stats.chaptersScrapedError}`);
        console.log(`DB Chapters Saved/Updated: ${stats.dbChapterUpdateSuccess}, DB Errors during save: ${stats.dbErrors}`);

    } catch (error) {
        console.error("An unexpected error occurred during the main process:", error);
        // Optionally increment a general error counter here if needed
    } finally {
        stats.endTime = Date.now();
        stats.durationSeconds = (stats.endTime - stats.startTime) / 1000;

        console.log('\n--- Scraping Statistics ---');
        console.log(`Start Time:          ${new Date(stats.startTime).toISOString()}`);
        console.log(`End Time:            ${new Date(stats.endTime).toISOString()}`);
        console.log(`Duration:            ${stats.durationSeconds.toFixed(2)} seconds`);
        console.log(`Novels Processed:    ${stats.novelsProcessed}`);
        console.log(`Chapters Attempted:  ${stats.chaptersAttempted}`);
        console.log(`Chapters Scraped OK: ${stats.chaptersScrapedSuccess}`);
        console.log(`Chapters Empty/Miss: ${stats.chaptersWithEmptyContent}`);
        console.log(`Chapter Scrape Err:  ${stats.chaptersScrapedError}`);
        console.log(`Novel DB Updates:    ${stats.dbNovelUpdateSuccess}`);
        console.log(`Chapter DB Updates:  ${stats.dbChapterUpdateSuccess}`);
        console.log(`Database Errors:     ${stats.dbErrors}`);
        console.log('--------------------------');

        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('MongoDB disconnected.');
        } else {
            console.log('MongoDB connection already closed or not established.');
        }
    }
}

// Run the main function
main();
