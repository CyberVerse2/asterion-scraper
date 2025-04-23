import axios from 'axios';
import * as cheerio from 'cheerio';

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
    url: string;
    title: string | null;
    content: string | null;
    // comments: any[]; // Comments might require dynamic loading handling
}

// Function to add delay
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Scrape Novel Details
async function scrapeNovelDetails(novelUrl: string): Promise<NovelDetails> {
    console.log(`Fetching novel details from: ${novelUrl}`);
    try {
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

// 3. Scrape Chapter Content
async function scrapeChapterContent(chapterUrl: string): Promise<ChapterData> {
    console.log(`Fetching chapter content from: ${chapterUrl}`);
    try {
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
        return { url: chapterUrl, title, content };

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
                const chapterData = await scrapeChapterContent(dynamicChapterUrl);
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
        // TODO: Do something with allChaptersData (e.g., save to file, database)
        // For now, let's log the first chapter's data if available
        if (allChaptersData.length > 0) {
            console.log('\n--- Example: First Scraped Chapter Data ---');
            console.log(allChaptersData[0]);
        }
    } catch (error) {
        console.error('--- An error occurred during the scraping process ---');
        console.error(error);
    }
}

// --- Execution ---
// Replace with the actual novel URL you want to scrape
const novelUrlToScrape = 'https://novelfire.net/book/shadow-slave';

// Use an async IIFE to allow await and catch errors. Prepend with void to satisfy linter.
// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async () => {
    try {
        await scrapeNovel(novelUrlToScrape);
    } catch (error) {
        console.error('Unhandled error during script execution:', error);
    }
})();
