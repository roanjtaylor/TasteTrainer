import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.ts';
import { now } from './util.ts';
import type { Dataset, DatasetSummary, ResultsFile } from '../../shared/types.ts';

function slugify(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function listDatasets(): Promise<DatasetSummary[]> {
  const { data, error } = await supabase
    .from('taste_datasets')
    .select('id, data')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ id, data: ds }: { id: string; data: Dataset }) => ({
    id,
    topic: ds.topic,
    description: ds.description,
    itemCount: (ds.items ?? []).length,
    subtopicCount: (ds.subtopics ?? []).length,
    updatedAt: ds.updatedAt,
  }));
}

export async function getDataset(id: string): Promise<Dataset | null> {
  const { data, error } = await supabase
    .from('taste_datasets')
    .select('data')
    .eq('id', id)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(error.message);
  return (data?.data as Dataset) ?? null;
}

export async function saveDataset(ds: Dataset): Promise<Dataset> {
  ds.updatedAt = now();
  const { error } = await supabase
    .from('taste_datasets')
    .upsert({ id: ds.id, slug: slugify(ds.topic), data: ds, updated_at: ds.updatedAt });
  if (error) throw new Error(error.message);
  return ds;
}

export async function deleteDataset(id: string): Promise<void> {
  const { error: resError } = await supabase
    .from('taste_comparison_results')
    .delete()
    .eq('dataset_id', id);
  if (resError) throw new Error(resError.message);
  const { error } = await supabase.from('taste_datasets').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getResults(datasetId: string): Promise<ResultsFile | null> {
  const { data, error } = await supabase
    .from('taste_comparison_results')
    .select('data')
    .eq('dataset_id', datasetId)
    .single();
  if (error?.code === 'PGRST116') return null;
  if (error) throw new Error(error.message);
  return (data?.data as ResultsFile) ?? null;
}

export async function saveResults(results: ResultsFile): Promise<ResultsFile> {
  results.updatedAt = now();
  const { error } = await supabase
    .from('taste_comparison_results')
    .upsert({ dataset_id: results.datasetId, data: results, updated_at: results.updatedAt });
  if (error) throw new Error(error.message);
  return results;
}
