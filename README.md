# Asterion Scraper - Novel Chapter Scraper

## Overview

This project contains a web scraper built with Node.js and TypeScript designed to extract chapter content from novel websites. It currently targets the novel "Shadow Slave" hosted on `novelfire.net`.

The scraper performs the following steps:

1. Fetches basic novel details (title, author, chapters, etc.).
2. Determines the latest chapter number by checking the chapter list page sorted descendingly.
3. Iterates from chapter 1 up to the latest chapter number.
4. For each chapter, it constructs the URL dynamically.
5. Scrapes the chapter title and content using Axios for HTTP requests and Cheerio for HTML parsing.
6. Logs the scraped data to the console.

## Technologies Used

* Node.js
* TypeScript
* Axios (for HTTP requests)
* Cheerio (for HTML parsing)
* ts-node (for running TypeScript directly)
* ESLint (for linting)

## Setup

1. **Prerequisites:** Ensure you have [Node.js](https://nodejs.org/) (which includes npm) installed.
2. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd asterion-scraper
   ```

3. **Install dependencies:**

   ```bash
   npm install
   ```

## Running the Scraper

1. **Execute the script:**

   ```bash
   npx ts-node scraper.ts
   ```

   The script will start fetching novel details, determine the chapter range, and then begin scraping each chapter sequentially. Progress and scraped data will be logged to the console.

   **Note:** The script includes a 1-second delay between chapter requests to avoid overloading the target server. Scraping a large number of chapters will take a significant amount of time.

## Configuration

* The target novel URL is currently hardcoded in the `scraper.ts` file within the `novelUrlToScrape` constant. Modify this variable to scrape a different novel (ensure selectors in the `scrapeNovelDetails` and `scrapeChapterContent` functions are adjusted accordingly for the new target website's structure).

## Future Improvements

* Save scraped data to a file (e.g., JSON, CSV) or a database instead of just logging.
* Implement command-line arguments for specifying the target URL or chapter range.
* Add more robust error handling and retry logic.
* Integrate a proper logging library.
* Potentially use a browser automation tool like Playwright or Puppeteer if sites require JavaScript execution or have stricter anti-bot measures (though Axios/Cheerio is sufficient for the current target).
