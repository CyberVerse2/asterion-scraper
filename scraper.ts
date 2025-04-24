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

        // Extract details (Adjust selectors as needed for novelfire.net)
        const title = $('.wrap > h1').text().trim() || null;
        const author = $('.author > span:nth-child(2)').text().trim() || null;
        const rank = $('.rank > strong').text().trim() || null;
        const chapters = $('.book-info > div:nth-child(3) > span:nth-child(2)').text().trim() || null;
        const views = $('.book-info > div:nth-child(4) > span:nth-child(2)').text().trim() || null;
        const bookmarks = $('.book-info > div:nth-child(5) > span:nth-child(2)').text().trim() || null;
        const status = $('.status > span:nth-child(2)').text().trim() || null;
        const genres = $('.category a').map((i, el) => $(el).text().trim()).get();
        const summary = $('#info-summary > p').text().trim() || null;
        const chaptersUrl = $('.book-buttons a:contains("Chapters")').attr('href') || null;

        return { title, author, rank, chapters, views, bookmarks, status, genres, summary, chaptersUrl };
    } catch (error: unknown) {
        console.error(`Error fetching or parsing novel details from ${novelUrl}:`, error);
        // Return default/null object to indicate failure but allow potential partial processing
        return { title: null, author: null, rank: null, chapters: null, views: null, bookmarks: null, status: null, genres: [], summary: null, chaptersUrl: null };
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
        const startUrl = 'https://novelfire.net/book/shadow-slave'; // Example

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

        // Determine latest chapter number
        const latestChapterNumber = await getLatestChapterNumber(novelDetails.chaptersUrl);

        if (latestChapterNumber === null) {
            console.error('Failed to determine the latest chapter number. Aborting chapter scrape.');
            return;
        }

        // 2. Loop through chapters
        const chaptersBaseUrl = novelDetails.chaptersUrl.split('/chapters')[0];
        console.log(`\n--- Processing Chapters 1 to ${latestChapterNumber} ---`);
        const allChaptersData: ChapterData[] = [];

        for (let i = 1; i <= latestChapterNumber; i++) {
            stats.chaptersAttempted++; // Increment attempt counter
            const dynamicChapterUrl = `${chaptersBaseUrl}/chapter-${i}`;
            try {
                console.log(`Processing Chapter ${i}/${latestChapterNumber}: ${dynamicChapterUrl}`);
                const chapterData = await scrapeChapterContent(dynamicChapterUrl, i);

                // Check if content was successfully scraped (not null)
                if (chapterData.content) {
                    allChaptersData.push(chapterData);
                    stats.chaptersScrapedSuccess++; // Increment success counter
                } else {
                    // Increment counter if scraping function returned null content
                    stats.chaptersWithEmptyContent++;
                    console.warn(`Chapter ${i} scraped but content was empty or not found.`);
                }

                // Optional: Add progress logging every N chapters
                if (i % 50 === 0) {
                    console.log(`--- Progress: Scraped up to chapter ${i} ---`);
                }
                // Delay is handled within scrapeChapterContent now

            } catch (chapterError) {
                // This catch might be less likely if scrapeChapterContent handles its own errors,
                // but keep it for unexpected issues during the call itself.
                stats.chaptersScrapedError++; // Increment error counter
                console.error(`Unexpected error processing chapter ${i} (${dynamicChapterUrl}):`, chapterError);
            }
        }

        console.log('\n--- Finished Scraping Chapters ---');
        console.log(`Attempted: ${stats.chaptersAttempted}, Scraped OK: ${stats.chaptersScrapedSuccess}, Empty Content: ${stats.chaptersWithEmptyContent}, Errors: ${stats.chaptersScrapedError}`);

        // --- Save to Database ---
        if (allChaptersData.length > 0 && novelDetails.title) {
            console.log(`\n--- Saving/Updating ${novelDetails.title} in Database ---`);
            let savedNovel: INovel | null = null;
            try {
                // 1. Find or Create the Novel document
                savedNovel = await Novel.findOneAndUpdate(
                    { title: novelDetails.title }, // Find by unique title
                    {
                        // Set or update novel details
                        $set: {
                            novelUrl: startUrl,
                            author: novelDetails.author,
                            rank: novelDetails.rank,
                            totalChapters: novelDetails.chapters, // Use value from site
                            views: novelDetails.views,
                            bookmarks: novelDetails.bookmarks,
                            status: novelDetails.status,
                            genres: novelDetails.genres,
                            summary: novelDetails.summary,
                            chaptersUrl: novelDetails.chaptersUrl,
                            lastScraped: new Date(),
                        }
                    },
                    {
                        upsert: true, // Create if doesn't exist
                        new: true,    // Return the updated document
                        setDefaultsOnInsert: true, // Apply default values on insert
                    }
                );

                if (!savedNovel) {
                    console.error("Failed to save or find novel document.");
                    stats.dbErrors++; // Count as DB Error
                    return; // Exit if novel couldn't be saved/found
                }
                stats.dbNovelUpdateSuccess++;
                console.log(`Found/Created Novel: ${savedNovel.title} (ID: ${savedNovel._id})`);

                // 2. Save/Update individual chapters and collect their IDs
                const chapterIds: mongoose.Schema.Types.ObjectId[] = [];
                console.log(`Processing ${allChaptersData.length} chapters for saving...`);

                for (const chapterData of allChaptersData) {
                    // Only try to save if we actually got content during scraping
                    if (!chapterData.content) continue;

                    try {
                        await delay(DB_OPERATION_DELAY_MS); // Small delay before each DB write
                        const savedChapter = await Chapter.findOneAndUpdate(
                            {
                                novel: savedNovel._id, // Link to the novel
                                chapterNumber: chapterData.chapterNumber // Identify chapter by number within the novel
                            },
                            {
                                // Set or update chapter details
                                $set: {
                                    url: chapterData.url,
                                    title: chapterData.title,
                                    content: chapterData.content, // Save the scraped HTML
                                }
                            },
                            {
                                upsert: true, // Create if doesn't exist
                                new: true,    // Return the updated document
                                setDefaultsOnInsert: true,
                            }
                        );
                        if (savedChapter) {
                            chapterIds.push(savedChapter._id as mongoose.Schema.Types.ObjectId);
                            stats.dbChapterUpdateSuccess++; // Increment chapter success
                        } else {
                            console.warn(`  Failed to save/update Chapter ${chapterData.chapterNumber}`);
                            stats.dbErrors++; // Increment general DB error
                        }
                    } catch (chapterDbError) {
                        stats.dbErrors++; // Increment DB error counter
                        console.error(`  Error saving chapter ${chapterData.chapterNumber}:`, chapterDbError);
                    }
                }

                // 3. Update the Novel document with the array of Chapter IDs
                if (chapterIds.length > 0) {
                    savedNovel.chapters = chapterIds;
                    await savedNovel.save();
                    console.log(`Successfully updated Novel ${savedNovel.title} with ${chapterIds.length} chapter references.`);
                } else {
                    console.log(`No new/updated chapters were successfully saved for ${savedNovel.title}. Novel reference list not updated.`);
                }

            } catch (dbError) {
                stats.dbErrors++; // Increment DB error counter for main block
                console.error(`Error during database operations:`, dbError);
            }
        } else {
            console.log('No chapters scraped with content or novel title missing, skipping database save.');
        }

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
