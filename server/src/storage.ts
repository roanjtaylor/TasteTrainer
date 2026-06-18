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

const datasetPath = (id: string) => path.join(DATASETS_DIR, `${id}.json`);
const resultsPath = (id: string) => path.join(RESULTS_DIR, `${id}.json`);

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
  return readJson<Dataset>(datasetPath(id));
}

export async function saveDataset(ds: Dataset): Promise<Dataset> {
  ds.updatedAt = now();
  await writeJson(datasetPath(ds.id), ds);
  return ds;
}

export async function deleteDataset(id: string): Promise<void> {
  await fs.rm(datasetPath(id), { force: true });
  await fs.rm(resultsPath(id), { force: true });
}

export async function getResults(id: string): Promise<ResultsFile | null> {
  return readJson<ResultsFile>(resultsPath(id));
}

export async function saveResults(results: ResultsFile): Promise<ResultsFile> {
  results.updatedAt = now();
  await writeJson(resultsPath(results.datasetId), results);
  return results;
}
