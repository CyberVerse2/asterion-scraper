#!/usr/bin/env node

import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

import {
  connectDB,
  disconnectDB,
  findNovelsMissingData,
  INovel,
  updateNovelFields
} from './models/Novel.js';

// Import shared extraction function
import { extractNovelDetails } from './utils/novel-details-extractor.js';

// Load environment variables
dotenv.config();

const REQUEST_DELAY_MS = 2000;
const DB_OPERATION_DELAY_MS = 100;

interface UpdateStats {
  totalNovels: number;
  novelsProcessed: number;
  summariesUpdated: number;
  ratingsUpdated: number;
  stillMissingSummaries: number;
  stillMissingRatings: number;
  errors: number;
  skippedNoUrl: number;
  startTime: number;
  endTime: number;
  durationSeconds: number;
}

interface CliOptions {
  dryRun: boolean;
  limit?: number;
  summariesOnly: boolean;
  ratingsOnly: boolean;
  verbose: boolean;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    dryRun: false,
    summariesOnly: false,
    ratingsOnly: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        const limitValue = parseInt(args[i + 1]);
        if (!isNaN(limitValue) && limitValue > 0) {
          options.limit = limitValue;
          i++;
        } else {
          console.error('Error: --limit requires a positive integer');
          process.exit(1);
        }
        break;
      case '--summaries-only':
        options.summariesOnly = true;
        break;
      case '--ratings-only':
        options.ratingsOnly = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
        showHelp();
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          console.error(`Error: Unknown option ${arg}`);
          showHelp();
          process.exit(1);
        }
    }
  }

  // Validate conflicting options
  if (options.summariesOnly && options.ratingsOnly) {
    console.error('Error: Cannot use both --summaries-only and --ratings-only');
    process.exit(1);
  }

  return options;
}

function showHelp() {
  console.log(`
Usage: node update-novel-details.js [options]

Update missing summaries and/or ratings for novels in the database.

Options:
  --dry-run          Show what would be updated without making changes
  --limit N          Process only N novels (useful for testing)
  --summaries-only   Only update missing summaries
  --ratings-only     Only update missing ratings
  --verbose          Enable detailed logging
  --help             Show this help message

Examples:
  node update-novel-details.js --dry-run --limit 5
  node update-novel-details.js --summaries-only
  node update-novel-details.js --ratings-only --verbose
  node update-novel-details.js --limit 10
`);
}

async function updateNovelDetails(
  novel: INovel,
  options: CliOptions,
  stats: UpdateStats
): Promise<void> {
  const missingData = [];
  const needsSummary = !novel.summary || novel.summary.trim() === '';
  const needsRating = novel.rating === null || novel.rating === undefined;

  if (needsSummary && !options.ratingsOnly) {
    missingData.push('summary');
  }
  if (needsRating && !options.summariesOnly) {
    missingData.push('rating');
  }

  if (missingData.length === 0) {
    if (options.verbose) {
      console.log(`  ℹ️  Novel "${novel.title}" already has all required data`);
    }
    return;
  }

  if (!novel.novelUrl) {
    console.warn(`  ⚠️  Novel "${novel.title}" has no URL, skipping`);
    stats.skippedNoUrl++;
    return;
  }

  console.log(`  → Processing: "${novel.title}" (missing: ${missingData.join(', ')})`);

  try {
    await delay(REQUEST_DELAY_MS);

    const { data } = await axios.get(novel.novelUrl);
    const $ = cheerio.load(data);
    const extractedDetails = extractNovelDetails($);

    const updateData: { summary?: string; rating?: number } = {};
    let updatedFields = [];

    if (needsSummary && !options.ratingsOnly && extractedDetails.summary.value) {
      updateData.summary = extractedDetails.summary.value;
      updatedFields.push('summary');
      stats.summariesUpdated++;

      if (options.verbose) {
        console.log(`    ✓ Found summary using selector: ${extractedDetails.summary.selector}`);
      }
    } else if (needsSummary && !options.ratingsOnly) {
      stats.stillMissingSummaries++;
      if (options.verbose) {
        console.log(`    ! Still no summary found`);
      }
    }

    if (needsRating && !options.summariesOnly && extractedDetails.rating.value !== null) {
      updateData.rating = extractedDetails.rating.value;
      updatedFields.push('rating');
      stats.ratingsUpdated++;

      if (options.verbose) {
        console.log(
          `    ✓ Found rating using selector: ${extractedDetails.rating.selector} (value: ${extractedDetails.rating.value})`
        );
      }
    } else if (needsRating && !options.summariesOnly) {
      stats.stillMissingRatings++;
      if (options.verbose) {
        console.log(`    ! Still no rating found`);
      }
    }

    if (Object.keys(updateData).length > 0) {
      if (options.dryRun) {
        console.log(
          `    [DRY RUN] Would update ${updatedFields.join(' and ')} for "${novel.title}"`
        );
      } else {
        await delay(DB_OPERATION_DELAY_MS);
        await updateNovelFields(novel._id, updateData);
        console.log(`    ✅ Updated ${updatedFields.join(' and ')} for "${novel.title}"`);
      }
    } else {
      if (options.verbose) {
        console.log(`    ℹ️  No new data found for "${novel.title}"`);
      }
    }
  } catch (error) {
    stats.errors++;
    console.error(
      `    ❌ Error processing "${novel.title}":`,
      error instanceof Error ? error.message : error
    );
  }
}

async function main() {
  const startTime = Date.now();
  const options = parseCliArgs();

  console.log('🚀 Novel Details Update Script');
  console.log('================================');

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database');
  }

  if (options.summariesOnly) {
    console.log('📝 Updating only missing summaries');
  } else if (options.ratingsOnly) {
    console.log('⭐ Updating only missing ratings');
  } else {
    console.log('📝⭐ Updating missing summaries and ratings');
  }

  if (options.limit) {
    console.log(`📊 Processing limited to ${options.limit} novels`);
  }

  console.log('');

  const stats: UpdateStats = {
    totalNovels: 0,
    novelsProcessed: 0,
    summariesUpdated: 0,
    ratingsUpdated: 0,
    stillMissingSummaries: 0,
    stillMissingRatings: 0,
    errors: 0,
    skippedNoUrl: 0,
    startTime,
    endTime: 0,
    durationSeconds: 0
  };

  try {
    await connectDB();

    console.log('🔍 Finding novels with missing data...');
    const novels = await findNovelsMissingData(options);
    stats.totalNovels = novels.length;

    if (novels.length === 0) {
      console.log('✅ No novels found with missing data. All novels are up to date!');
      return;
    }

    console.log(`📚 Found ${novels.length} novel(s) with missing data`);
    console.log('');

    for (let i = 0; i < novels.length; i++) {
      const novel = novels[i];
      console.log(`Processing ${i + 1}/${novels.length}: "${novel.title}"`);

      await updateNovelDetails(novel, options, stats);
      stats.novelsProcessed++;

      if (i < novels.length - 1) {
        await delay(500);
      }

      console.log('');
    }
  } catch (error) {
    console.error('❌ Fatal error during script execution:', error);
    process.exit(1);
  } finally {
    stats.endTime = Date.now();
    stats.durationSeconds = (stats.endTime - stats.startTime) / 1000;

    console.log('');
    console.log('📊 UPDATE SUMMARY');
    console.log('=================');
    console.log(`⏱️  Duration: ${stats.durationSeconds.toFixed(2)} seconds`);
    console.log(`📚 Total novels found: ${stats.totalNovels}`);
    console.log(`✅ Novels processed: ${stats.novelsProcessed}`);
    console.log(`📝 Summaries updated: ${stats.summariesUpdated}`);
    console.log(`⭐ Ratings updated: ${stats.ratingsUpdated}`);

    if (!options.ratingsOnly) {
      console.log(`📝❌ Still missing summaries: ${stats.stillMissingSummaries}`);
    }
    if (!options.summariesOnly) {
      console.log(`⭐❌ Still missing ratings: ${stats.stillMissingRatings}`);
    }

    console.log(`⚠️  Novels skipped (no URL): ${stats.skippedNoUrl}`);
    console.log(`❌ Errors encountered: ${stats.errors}`);

    if (options.dryRun) {
      console.log('');
      console.log('ℹ️  This was a dry run. No changes were made to the database.');
      console.log('   Remove --dry-run to actually update the novels.');
    }

    await disconnectDB();
    console.log('');
    console.log('👋 Database connection closed. Script complete!');
  }
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
