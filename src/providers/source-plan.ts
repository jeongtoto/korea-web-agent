import type { EvidenceClass, NormalizedTarget, ProductSpecificity } from '../core/types.ts';

export interface SourceQuery {
  id: string;
  query: string;
  sourceType: string;
  evidenceClass: EvidenceClass;
  specificity: ProductSpecificity;
  maxHits: number;
}

function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function identityFor(target: NormalizedTarget): string {
  const parts = [target.brand, target.name, target.model, target.productId]
    .map(compact)
    .filter(Boolean);
  return [...new Set(parts)].join(' ').slice(0, 150) || '제품';
}

function questionTerms(question: string): string {
  const cleaned = compact(question)
    .replace(/[?!.~,;:()[\]{}<>"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 70);
}

function unique(items: SourceQuery[]): SourceQuery[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const query = compact(item.query);
    if (!query || seen.has(query)) return false;
    seen.add(query);
    item.query = query;
    return true;
  }).slice(0, 14);
}

export function buildSourcePlan(target: NormalizedTarget, question: string): SourceQuery[] {
  const identity = identityFor(target);
  const intent = questionTerms(question);
  const general = [identity, intent].filter(Boolean).join(' ').slice(0, 210);

  const queries: SourceQuery[] = [
    {
      id: 'general', query: general, sourceType: 'general_web', evidenceClass: 'editorial_review', specificity: 'exact_product', maxHits: 6,
    },
    {
      id: 'naver-shopping', query: `${identity} site:brand.naver.com`, sourceType: 'naver_shopping', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'naver-blog', query: `${identity} 후기 장기 사용 site:blog.naver.com`, sourceType: 'naver_blog', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'naver-cafe', query: `${identity} 후기 단점 site:cafe.naver.com`, sourceType: 'naver_cafe', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'coupang', query: `${identity} site:coupang.com`, sourceType: 'coupang', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'danawa', query: `${identity} site:danawa.com`, sourceType: 'danawa', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'youtube', query: `${identity} 리뷰 조립 장기 사용 site:youtube.com`, sourceType: 'youtube', evidenceClass: 'editorial_review', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'reddit', query: `${identity} review site:reddit.com`, sourceType: 'reddit', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 4,
    },
    {
      id: 'news', query: `${identity} 뉴스 리콜 안전 이슈`, sourceType: 'news', evidenceClass: 'editorial_review', specificity: 'exact_product', maxHits: 4,
    },
    {
      id: 'official', query: `${identity} KC 인증 시험 성적서 소재 안전`, sourceType: 'official_or_accredited', evidenceClass: 'official_record', specificity: 'exact_product', maxHits: 4,
    },
    {
      id: 'academic', query: `${intent || '침대 수면'} bed sleep ergonomics material safety site:pubmed.ncbi.nlm.nih.gov`, sourceType: 'academic', evidenceClass: 'peer_reviewed_research', specificity: 'general_mechanism', maxHits: 4,
    },
    {
      id: 'instagram', query: `${identity} site:instagram.com`, sourceType: 'instagram', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 3,
    },
    {
      id: 'kakao', query: `${identity} site:place.map.kakao.com`, sourceType: 'kakao_map', evidenceClass: 'community_report', specificity: 'category', maxHits: 3,
    },
  ];

  return unique(queries);
}
