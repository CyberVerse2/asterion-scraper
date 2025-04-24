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

interface ChapterData {
    chapterNumber: number; // Added chapter number
    url: string;
    title: string;
    content: string | null;
}

// --- Database Connection ---

async function connectDB(): Promise<void> {
    const dbUri = process.env.MONGODB_URI;
    if (!dbUri) {
        console.error('Error: MONGODB_URI is not defined in .env file.');
        process.exit(1); // Exit if DB URI is missing
    }
    try {
        await mongoose.connect(dbUri);
        console.log('MongoDB Connected successfully.');
    } catch (err: unknown) {
        console.error('MongoDB connection error:', err);
        process.exit(1); // Exit on connection error
    }
}

// --- Scraping Functions ---

// 1. Scrape Novel Details (Keep as is)
async function scrapeNovelDetails(novelUrl: string): Promise<NovelDetails> {
    console.log(`Fetching novel details from: ${novelUrl}`);
    try {
        await delay(REQUEST_DELAY_MS); // Delay before first request
        const { data } = await axios.get(novelUrl);
        const $ = cheerio.load(data);

        const details: NovelDetails = {
            title: $('h1.novel-title').text().trim() || null,
            author: $('.author a[itemprop="author"]').text().trim() || null,
            rank: $('.rank strong').text().replace('RANK ', '').trim() || null,
            chapters: $('.header-stats span:nth-child(1) strong').text().trim() || null,
            views: $('.header-stats span:nth-child(2) strong').text().trim() || null,
            bookmarks: $('.header-stats span:nth-child(3) strong').text().trim() || null,
            status: $('.header-stats span:nth-child(4) strong').text().trim() || null,
            genres: $('.categories ul li a').map((_, el) => $(el).text().trim()).get(),
            summary: $('.summary .introduce .inner').text().replace(/\s+/g, ' ').trim() || null,
            chaptersUrl: $('a.grdbtn[href*="/chapters"]').attr('href') || null,
        };

        console.log('Successfully scraped novel details.');
        return details;
    } catch (error) {
        console.error(`Error fetching or parsing novel details from ${novelUrl}:`, error);
        throw error;
    }
}

// 3. Scrape Chapter Content (Modified to include chapterNumber)
async function scrapeChapterContent(
    chapterUrl: string,
    chapterNumber: number // Accept chapter number
): Promise<ChapterData> {
    console.log(`Fetching chapter content from: ${chapterUrl}`);
    try {
        await delay(REQUEST_DELAY_MS); // Delay before each chapter content request
        const { data } = await axios.get(chapterUrl);
        const $ = cheerio.load(data);

        // Refined Title Selector: Target h4, extract text after 'Chapter X '
        let title = $('h4').first().text().trim();
        // Remove potential prefix like "Chapter 16 "
        title = title.replace(/^Chapter\s*\d+\s*[:\-]?\s*/, ''); // Remove "Chapter X " prefix
        if (!title) {
            console.warn(`Could not find title using h4 for ${chapterUrl}. Check title selectors.`);
            title = 'Untitled'; // Default title
        }

        // Corrected Content Selector: Target #content directly
        const content = $('#content').text().trim(); // Use the confirmed ID

        if (!content || content.trim().length === 0) {
            console.warn(`Could not find content using #content for ${chapterUrl}. Check content selectors.`);
            // Optionally, try a fallback selector if the primary one fails
        }

        console.log(`Successfully scraped content for chapter: ${title}`);
        return { url: chapterUrl, title, content, chapterNumber }; // Return chapterNumber

    } catch (error: unknown) {
        console.error(`Error fetching or parsing chapter content from ${chapterUrl}:`, error);
        throw error;
    }
}

// 4. Main Orchestration Function
async function scrapeNovel(startUrl: string): Promise<void> {
    try {
        const novelDetails = await scrapeNovelDetails(startUrl);
        console.log('\n--- Novel Details ---');
        console.log(novelDetails);

        if (!novelDetails.chaptersUrl) {
            console.error('Could not find the base chapters page URL.');
            return;
        }

        // 1. Fetch the first page sorted descending to find the latest chapter number
        const firstPageDescUrl = `${novelDetails.chaptersUrl}?sort_by=desc`;
        let latestChapterNumber: number | null = null;

        try {
            console.log(`Fetching latest chapter link from: ${firstPageDescUrl}`);
            await delay(REQUEST_DELAY_MS); // Delay before chapter list request
            const { data } = await axios.get(firstPageDescUrl);
            const $ = cheerio.load(data);
            const latestChapterLink = $('.chapter-list a').first().attr('href'); // Get the first link

            if (latestChapterLink) {
                const match = latestChapterLink.match(/chapter-(\d+)/);
                if (match && match[1]) {
                    latestChapterNumber = parseInt(match[1], 10);
                    console.log(`Latest chapter detected: ${latestChapterNumber}`);
                } else {
                    console.error(`Could not parse chapter number from latest chapter link: ${latestChapterLink}`);
                }
            } else {
                console.error('Could not find the latest chapter link on the first page.');
            }
        } catch (error) {
            console.error(`Error fetching or parsing the first chapter page: ${firstPageDescUrl}`, error);
            return; // Stop if we can't get the latest chapter number
        }

        if (latestChapterNumber === null) {
            console.error('Failed to determine the latest chapter number. Aborting chapter scrape.');
            return;
        }

        // 2. Loop from chapter 1 to latestChapterNumber and scrape
        const chaptersBaseUrl = novelDetails.chaptersUrl.split('/chapters')[0]; // e.g., https://novelfire.net/book/shadow-slave
        console.log(`\n--- Processing Chapters 1 to ${latestChapterNumber} ---`);
        const allChaptersData: ChapterData[] = [];

        for (let i = 1; i <= latestChapterNumber; i++) {
            const dynamicChapterUrl = `${chaptersBaseUrl}/chapter-${i}`;
            try {
                console.log(`Processing Chapter ${i}/${latestChapterNumber}: ${dynamicChapterUrl}`);
                // Pass chapter number 'i' to scrapeChapterContent
                const chapterData = await scrapeChapterContent(dynamicChapterUrl, i);
                if (chapterData.content) {
                    allChaptersData.push(chapterData);
                }
                // Optional: Add progress logging every N chapters
                if (i % 50 === 0) {
                    console.log(`--- Progress: Scraped up to chapter ${i} ---`);
                    // TODO: Consider saving progress here if needed
                }
                await delay(1000); // Wait 1 second between chapter requests
            } catch (chapterError) {
                console.error(`Skipping chapter ${i} (${dynamicChapterUrl}) due to error during scraping:`, chapterError);
                // Decide if you want to retry or just continue
            }
        }

        console.log('\n--- Finished Scraping Chapters ---');
        console.log(`Successfully scraped content for ${allChaptersData.length} out of ${latestChapterNumber} chapters.`);

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
                            totalChapters: novelDetails.chapters,
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
                    return; // Exit if novel couldn't be saved/found
                }
                console.log(`Found/Created Novel: ${savedNovel.title} (ID: ${savedNovel._id})`);

                // 2. Save/Update individual chapters and collect their IDs
                // Use Schema.Types.ObjectId to match the schema definition
                const chapterIds: mongoose.Schema.Types.ObjectId[] = [];
                console.log(`Processing ${allChaptersData.length} chapters for saving...`);

                for (const chapterData of allChaptersData) {
                    if (!chapterData.content) continue; // Skip if content is null

                    try {
                        await delay(DB_OPERATION_DELAY_MS); // Small delay before each DB write
                        // Add explicit type annotation here
                        const savedChapter: IChapter | null = await Chapter.findOneAndUpdate(
                            {
                                novel: savedNovel._id, // Link to the novel
                                chapterNumber: chapterData.chapterNumber // Identify chapter by number within the novel
                            },
                            {
                                // Set or update chapter details
                                $set: {
                                    url: chapterData.url,
                                    title: chapterData.title,
                                    content: chapterData.content,
                                    // novel field is set on insert via the filter query or remains the same
                                }
                            },
                            {
                                upsert: true, // Create if doesn't exist
                                new: true,    // Return the updated document
                                setDefaultsOnInsert: true,
                            }
                        );
                        if (savedChapter) {
                            // Explicitly cast _id to satisfy the checker
                            chapterIds.push(savedChapter._id as mongoose.Schema.Types.ObjectId);
                            // Optional: Log progress per chapter
                            // console.log(`  Saved/Updated Chapter ${savedChapter.chapterNumber} (ID: ${savedChapter._id})`);
                        } else {
                             console.warn(`  Failed to save/update Chapter ${chapterData.chapterNumber}`);
                        }
                    } catch (chapterDbError) {
                        console.error(`  Error saving chapter ${chapterData.chapterNumber}:`, chapterDbError);
                    }
                    // Add a small delay between chapter saves if needed, e.g., to reduce DB load
                    // await delay(50); 
                }

                // 3. Update the Novel document with the array of Chapter IDs
                if (chapterIds.length > 0) {
                    savedNovel.chapters = chapterIds;
                    await savedNovel.save();
                    console.log(`Successfully updated Novel ${savedNovel.title} with ${chapterIds.length} chapter references.`);
                } else {
                    console.log(`No chapters were successfully saved for ${savedNovel.title}. Novel reference list not updated.`);
                }

            } catch (dbError) {
                console.error(`Error during database operations:`, dbError);
            }
        } else {
            console.log('No chapters scraped or novel title missing, skipping database save.');
        }

    } catch (error) {
        console.error('\n--- An error occurred during the scraping process ---');
        console.error(error);
    }
}

// --- Execution ---
// Replace with the actual novel URL you want to scrape
const novelUrlToScrape = 'https://novelfire.net/book/shadow-slave';

// Use an async IIFE to allow await and catch errors.
// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
    try {
        await connectDB(); // Connect to DB first
        await scrapeNovel(novelUrlToScrape);
    } catch (error) {
        console.error('Unhandled error during script execution:', error);
    } finally {
        await mongoose.disconnect(); // Ensure disconnection
        console.log('MongoDB Disconnected.');
    }
})();
