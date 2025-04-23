import mongoose, { Schema, Document } from 'mongoose';

// --- Interfaces ---

// Interface representing a chapter document
export interface IChapter {
  chapterNumber: number;
  url: string;
  title: string;
  content: string;
}

// Interface representing a novel document (extends Mongoose Document)
export interface INovel extends Document {
  title: string;          // Novel title (used as potential identifier)
  novelUrl: string;       // The base URL scraped
  author?: string | null;
  rank?: string | null;
  totalChapters?: string | null; // Chapters count as reported by site
  views?: string | null;
  bookmarks?: string | null;
  status?: string | null;
  genres?: string[];
  summary?: string | null;
  chaptersUrl?: string | null; // URL to the chapter list page
  chapters: IChapter[];     // Array of embedded chapter documents
  lastScraped?: Date;      // Timestamp of the last scrape
}

// --- Schemas ---

// Schema for Chapter (will be embedded)
const ChapterSchema: Schema<IChapter> = new Schema({
  chapterNumber: {
    type: Number,
    required: true,
    index: true // Index for potentially faster sorting/lookup
  },
  url: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
}, { _id: false }); // Disable automatic _id for embedded chapters

// Schema for Novel
const NovelSchema: Schema<INovel> = new Schema({
  title: {
    type: String,
    required: true,
    unique: true, // Assumes novel title is unique
    index: true
  },
  novelUrl: {
    type: String,
    required: true
  },
  author: { type: String },
  rank: { type: String },
  totalChapters: { type: String },
  views: { type: String },
  bookmarks: { type: String },
  status: { type: String },
  genres: [{ type: String }],
  summary: { type: String },
  chaptersUrl: { type: String },
  chapters: [ChapterSchema], // Embed chapter schema array
  lastScraped: {
    type: Date,
    default: Date.now
  },
}, { timestamps: true }); // Add createdAt and updatedAt timestamps

// --- Model ---

// Create and export the Mongoose model
// Mongoose automatically looks for the plural, lowercased version of your model name ('novels')
const Novel = mongoose.model<INovel>('Novel', NovelSchema);

export default Novel;
