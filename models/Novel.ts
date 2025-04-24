import mongoose, { Schema, Document } from 'mongoose';

// --- Interfaces ---

// Interface representing a chapter document
export interface IChapter extends Document { // Chapters are now separate documents
  novel: mongoose.Schema.Types.ObjectId; // Reference to the parent Novel
  chapterNumber: number;
  url: string;
  title: string;
  content: string;
}

// Interface representing a novel document
export interface INovel extends Document {
  title: string;
  novelUrl?: string;
  author?: string | null;
  rank?: string | null;
  totalChapters?: string | null; // Chapters count as reported by site
  views?: string | null;
  bookmarks?: string | null;
  status?: string | null;
  genres?: string[];
  summary?: string | null;
  chaptersUrl?: string | null; // URL to the chapter list page
  imageUrl?: string; // Added imageUrl field
  chapters: mongoose.Schema.Types.ObjectId[]; // Array of Chapter ObjectIds
  lastScraped?: Date;
}

// --- Schemas ---

// Schema for Chapter (Separate Collection)
const ChapterSchema: Schema<IChapter> = new Schema({
  novel: { // Reference back to the parent Novel
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Novel', // Refers to the 'Novel' model
    required: true,
    index: true,
  },
  chapterNumber: {
    type: Number,
    required: true,
    index: true // Index for potentially faster sorting/lookup
  },
  url: {
    type: String,
    required: true,
    unique: true // URL should be unique per chapter
  },
  title: {
    type: String,
    required: true
  },
  content: {
    type: String,
    required: true
  },
}, { timestamps: true }); // Add timestamps to chapters too

// Add a compound index for finding chapters belonging to a novel
ChapterSchema.index({ novel: 1, chapterNumber: 1 }, { unique: true });

// Schema for Novel (Updated)
const NovelSchema: Schema<INovel> = new Schema({
  title: {
    type: String,
    required: true,
    unique: true, // Assumes novel title is unique
    index: true
  },
  novelUrl: {
    type: String
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
  imageUrl: { type: String }, // Added imageUrl field
  chapters: [{ // Array of references to Chapter documents
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Chapter' // Refers to the 'Chapter' model
  }],
  lastScraped: {
    type: Date,
    default: Date.now
  },
}, { timestamps: true }); // Add createdAt and updatedAt timestamps

// --- Models ---

// Export both models
export const Chapter = mongoose.model<IChapter>('Chapter', ChapterSchema);
export const Novel = mongoose.model<INovel>('Novel', NovelSchema);

// Default export can remain Novel if preferred, or remove if using named exports only
export default Novel;
