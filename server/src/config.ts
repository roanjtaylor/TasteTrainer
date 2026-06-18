// Central config. Storage lives as plain files on disk (1-setup.md / 2-data.md).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project root (two levels up from server/src). */
export const ROOT = path.resolve(__dirname, '..', '..');

/** data/ holds one JSON file per dataset, plus comparison results. */
export const DATA_DIR = path.join(ROOT, 'data');
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets');
export const RESULTS_DIR = path.join(DATA_DIR, 'results');

export const PORT = Number(process.env.PORT) || 5174;

/** The model used for all curation calls. Confirmed in /plan + memory. */
export const CLAUDE_MODEL = 'claude-opus-4-8';
