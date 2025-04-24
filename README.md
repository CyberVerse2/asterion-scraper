# Asterion Scraper - Web Novel Scraper

## Overview

This project contains a web scraper built with Node.js and TypeScript designed to extract chapter content from novel websites. It currently targets a predefined list of novels hosted on `novelfire.net`.

The scraper performs the following steps:

1. Fetches basic novel details (title, author, chapters, etc.).
2. Determines the latest chapter number by checking the chapter list page sorted descendingly.
3. Iterates from chapter 1 up to the latest chapter number.
4. For each chapter, it constructs the URL dynamically.
5. Scrapes the chapter title and content using Axios for HTTP requests and Cheerio for HTML parsing.
6. Saves the novel details and all scraped chapter content to a MongoDB database.

## Technologies Used

- Node.js
- TypeScript
- Axios (for HTTP requests)
- Cheerio (for HTML parsing)
- Mongoose (for MongoDB interaction)
- dotenv (for environment variables)
- ts-node (for running TypeScript directly)
- ESLint (for linting)

## Setup

1. **Prerequisites:** Ensure you have [Node.js](https://nodejs.org/) (which includes npm) and [MongoDB](https://www.mongodb.com/try/download/community) installed and running.
2. **Clone the repository:**

    ```bash
    git clone https://github.com/your-username/asterion-scraper.git # Replace with your actual repo URL
    cd asterion-scraper
    ```

3. **Install dependencies:**

    ```bash
    npm install
    ```

4. **Configure Environment:**
   - Create a `.env` file in the project root directory (`asterion-scraper/.env`).
   - Add your MongoDB connection string to this file:

     ```bash
     MONGODB_URI=your_mongodb_connection_string_here
     ```

     (Replace `your_mongodb_connection_string_here` with your actual URI, e.g., `mongodb://localhost:27017/asterionScraper`)

## Running the Scraper

Once the environment variables are set and MongoDB is running, you can start the scraper:

```bash
npm start
```

Alternatively, if you want to run the TypeScript file directly (ensure dependencies are installed):

```bash
node --loader ts-node/esm scraper.ts
```

The script will start fetching novel details, determine the chapter range, and then begin scraping each chapter sequentially. Progress will be logged to the console. Upon completion, the novel details and chapter content will be saved or updated in your configured MongoDB database.

**Note:** The script includes a 1-second delay between chapter requests to avoid overloading the target server. Scraping a large number of chapters will take a significant amount of time.

## Configuration

- The target novels are defined in the `startUrls` array within the `scraper.ts` file. Modify this array to add or remove novels. Ensure selectors in the `scrapeNovelDetails` and `scrapeChapterContent` functions are compatible with `novelfire.net`'s structure.
- The MongoDB connection string is configured via the `MONGODB_URI` variable in the `.env` file.

## Future Improvements

- Save scraped data to a file (e.g., JSON, CSV) or a database instead of just logging. (Database saving implemented with MongoDB)
- Implement command-line arguments for specifying the target URL or chapter range.
- Add more robust error handling and retry logic.
- Integrate a proper logging library.
- Potentially use a browser automation tool like Playwright or Puppeteer if sites require JavaScript execution or have stricter anti-bot measures (though Axios/Cheerio is sufficient for the current target).
