import * as cheerio from 'cheerio';

// Interface for extracted novel details
export interface ExtractedNovelDetails {
  summary: string | null;
  rating: number | null;
}

// Interface for extraction results with metadata
export interface ExtractionResult {
  summary: {
    value: string | null;
    selector: string | null; // Which selector worked
  };
  rating: {
    value: number | null;
    selector: string | null; // Which selector worked
  };
}

/**
 * Validates and parses a rating string into a number
 * @param ratingText - Raw rating text from HTML
 * @returns Parsed rating number or null if invalid
 */
function parseRating(ratingText: string): number | null {
  if (!ratingText || typeof ratingText !== 'string') {
    return null;
  }

  const rating = parseFloat(ratingText.trim());

  // Validate rating is a number and within reasonable range
  if (isNaN(rating) || rating < 0 || rating > 10) {
    return null;
  }

  return rating;
}

/**
 * Extracts novel summary using multiple fallback selectors
 * @param $ - Cheerio instance
 * @returns Object with summary value and successful selector
 */
function extractSummary($: cheerio.Root): { value: string | null; selector: string | null } {
  // Define summary selectors in priority order
  const summarySelectors = [
    '.summary .introduce .inner', // Current working selector
    '.content.expand-wrapper', // New selector for reported issue
    '.summary', // Broader fallback
    '.content', // Most general fallback
    'meta[name="description"]' // Meta description as last resort
  ];

  for (const selector of summarySelectors) {
    try {
      let summaryText: string | null = null;

      if (selector === 'meta[name="description"]') {
        // Special handling for meta description
        summaryText = $(selector).attr('content') || null;
      } else {
        summaryText = $(selector).text().trim() || null;
      }

      if (summaryText && summaryText.length > 0) {
        console.log(`  ✓ Summary extracted using selector: ${selector}`);
        return { value: summaryText, selector };
      }
    } catch (error) {
      console.warn(`  ! Error trying summary selector '${selector}':`, error);
    }
  }

  console.warn(`  ! No summary found with any selector`);
  return { value: null, selector: null };
}

/**
 * Extracts novel rating using multiple fallback selectors
 * @param $ - Cheerio instance
 * @returns Object with rating value and successful selector
 */
function extractRating($: cheerio.Root): { value: number | null; selector: string | null } {
  // Define rating selectors in priority order
  const ratingSelectors = [
    'strong.nub', // Primary rating selector (provided by user)
    '.rating .value', // Alternative rating selector
    '[class*="rating"] strong', // Broader rating fallback
    '.score', // Another common rating class
    '.rating-value' // Generic rating value class
  ];

  for (const selector of ratingSelectors) {
    try {
      const ratingText = $(selector).text().trim();

      if (ratingText) {
        const parsedRating = parseRating(ratingText);

        if (parsedRating !== null) {
          console.log(`  ✓ Rating extracted using selector: ${selector} (value: ${parsedRating})`);
          return { value: parsedRating, selector };
        } else {
          console.warn(`  ! Invalid rating value '${ratingText}' from selector: ${selector}`);
        }
      }
    } catch (error) {
      console.warn(`  ! Error trying rating selector '${selector}':`, error);
    }
  }

  console.warn(`  ! No valid rating found with any selector`);
  return { value: null, selector: null };
}

/**
 * Main function to extract both summary and rating from a novel page
 * @param $ - Cheerio instance loaded with novel page HTML
 * @returns Object containing extracted summary and rating with metadata
 */
export function extractNovelDetails($: cheerio.Root): ExtractionResult {
  console.log(`  → Extracting novel details (summary and rating)...`);

  // Extract summary and rating
  const summaryResult = extractSummary($);
  const ratingResult = extractRating($);

  // Log overall results
  if (summaryResult.value && ratingResult.value) {
    console.log(`  ✓ Successfully extracted both summary and rating`);
  } else if (summaryResult.value) {
    console.log(`  ✓ Extracted summary only (rating not found)`);
  } else if (ratingResult.value) {
    console.log(`  ✓ Extracted rating only (summary not found)`);
  } else {
    console.warn(`  ! Failed to extract both summary and rating`);
  }

  return {
    summary: summaryResult,
    rating: ratingResult
  };
}

/**
 * Simplified function that returns just the values (for backward compatibility)
 * @param $ - Cheerio instance loaded with novel page HTML
 * @returns Object with just the extracted values
 */
export function extractNovelDetailsSimple($: cheerio.Root): ExtractedNovelDetails {
  const result = extractNovelDetails($);
  return {
    summary: result.summary.value,
    rating: result.rating.value
  };
}
