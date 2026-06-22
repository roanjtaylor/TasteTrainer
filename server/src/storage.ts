// Plain-file storage: one JSON file per dataset, one results file per dataset.
// No database (1-setup.md). Simple, inspectable, portable.
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATASETS_DIR, RESULTS_DIR } from './config.ts';
import { now } from './util.ts';
import type { Dataset, DatasetSummary, ResultsFile } from '../../shared/types.ts';

async function ensureDirs(): Promise<void> {
  await fs.mkdir(DATASETS_DIR, { recursive: true });
  await fs.mkdir(RESULTS_DIR, { recursive: true });
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDirs();
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

function slugify(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const datasetPath = (topic: string) => path.join(DATASETS_DIR, `${slugify(topic)}.json`);
const resultsPath = (topic: string) => path.join(RESULTS_DIR, `${slugify(topic)}.json`);

async function findDatasetById(id: string): Promise<Dataset | null> {
  await ensureDirs();
  const files = (await fs.readdir(DATASETS_DIR)).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const ds = await readJson<Dataset>(path.join(DATASETS_DIR, f));
    if (ds?.id === id) return ds;
  }
  return null;
}

export async function listDatasets(): Promise<DatasetSummary[]> {
  await ensureDirs();
  const files = (await fs.readdir(DATASETS_DIR)).filter((f) => f.endsWith('.json'));
  const summaries: DatasetSummary[] = [];
  for (const f of files) {
    const ds = await readJson<Dataset>(path.join(DATASETS_DIR, f));
    if (!ds) continue;
    summaries.push({
      id: ds.id,
      topic: ds.topic,
      description: ds.description,
      itemCount: ds.items.length,
      subtopicCount: ds.subtopics.length,
      updatedAt: ds.updatedAt,
    });
  }
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getDataset(id: string): Promise<Dataset | null> {
  return findDatasetById(id);
}

export async function saveDataset(ds: Dataset): Promise<Dataset> {
  ds.updatedAt = now();
  await writeJson(datasetPath(ds.topic), ds);
  return ds;
}

export async function deleteDataset(id: string): Promise<void> {
  const ds = await findDatasetById(id);
  if (!ds) return;
  await fs.rm(datasetPath(ds.topic), { force: true });
  await fs.rm(resultsPath(ds.topic), { force: true });
}

export async function getResults(datasetId: string): Promise<ResultsFile | null> {
  const ds = await findDatasetById(datasetId);
  if (!ds) return null;
  return readJson<ResultsFile>(resultsPath(ds.topic));
}

export async function saveResults(results: ResultsFile): Promise<ResultsFile> {
  const ds = await findDatasetById(results.datasetId);
  if (!ds) throw new Error(`Dataset ${results.datasetId} not found`);
  results.updatedAt = now();
  await writeJson(resultsPath(ds.topic), results);
  return results;
}
