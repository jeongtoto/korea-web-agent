import type { EvidenceItem } from '../core/types.ts';

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchProvider {
  id: string;
  search(query: string): Promise<SearchHit[]>;
  evidenceFromHit?(hit: SearchHit): EvidenceItem;
}
