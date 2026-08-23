import type { EvidenceClass, NormalizedTarget, ProductSpecificity } from '../core/types.ts';

export interface SourceQuery {
  id: string;
  query: string;
  sourceType: string;
  evidenceClass: EvidenceClass;
  specificity: ProductSpecificity;
  maxHits: number;
  market?: string;
}

function compact(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function identityFor(target: NormalizedTarget): string {
  const parts = [target.brand, target.name, target.model, target.variant, target.productId]
    .map(compact)
    .filter(Boolean);
  return [...new Set(parts)].join(' ').slice(0, 150);
}

function questionTerms(question: string): string {
  return compact(question)
    .replace(/[?!.~,;:()[\]{}<>"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70);
}

export function shouldUseAcademicResearch(question: string): boolean {
  const value = compact(question).toLowerCase();
  return /(논문|연구|학술|근거|허리|요통|건강|수면|인체공학|ergonomic|유해|voc|포름알데히드|소재 안전|눈 피로|시력|블루라이트)/i.test(value);
}

function unique(items: SourceQuery[]): SourceQuery[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const query = compact(item.query);
    if (!query || seen.has(query)) return false;
    seen.add(query);
    item.query = query;
    return true;
  }).slice(0, 20);
}

export function buildSourcePlan(target: NormalizedTarget, question: string): SourceQuery[] {
  const identity = identityFor(target);
  if (!identity) return [];

  const intent = questionTerms(question);
  const general = [identity, intent].filter(Boolean).join(' ').slice(0, 210);

  const queries: SourceQuery[] = [
    {
      id: 'general', query: general, sourceType: 'general_web', evidenceClass: 'editorial_review', specificity: 'exact_product', maxHits: 6,
    },
    {
      id: 'naver-shopping', query: `${identity} 네이버 쇼핑`, sourceType: 'naver_shopping', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '네이버',
    },
    {
      id: 'naver-blog', query: `${identity} 후기 장기 사용 site:blog.naver.com`, sourceType: 'naver_blog', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'naver-cafe', query: `${identity} 후기 단점 site:cafe.naver.com`, sourceType: 'naver_cafe', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'coupang', query: `${identity} site:coupang.com`, sourceType: 'coupang', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '쿠팡',
    },
    {
      id: 'danawa', query: `${identity} site:danawa.com`, sourceType: 'danawa', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '다나와',
    },
    {
      id: 'kream', query: `${identity} site:kream.co.kr`, sourceType: 'kream', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: 'KREAM',
    },
    {
      id: 'enuri', query: `${identity} site:enuri.com`, sourceType: 'enuri', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '에누리',
    },
    {
      id: 'open-market', query: `${identity} (site:11st.co.kr OR site:gmarket.co.kr OR site:auction.co.kr)`, sourceType: 'open_market', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 6, market: '오픈마켓',
    },
    {
      id: 'retail', query: `${identity} (site:ssg.com OR site:lotteon.com)`, sourceType: 'major_retail', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '대형유통',
    },
    {
      id: 'used', query: `${identity} (site:daangn.com OR site:joongna.com OR site:bunjang.co.kr)`, sourceType: 'used_market', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 6, market: '중고',
    },
    {
      id: 'refurb', query: `${identity} 리퍼 반품 전시상품`, sourceType: 'refurb_market', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '리퍼·반품',
    },
    {
      id: 'overseas', query: `${identity} (site:aliexpress.com OR site:temu.com)`, sourceType: 'overseas_market', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 5, market: '해외직구',
    },
    {
      id: 'offline', query: `${identity} 오프라인 매장 전시 할인 견적`, sourceType: 'offline_dealer', evidenceClass: 'retailer_listing', specificity: 'exact_product', maxHits: 4, market: '오프라인',
    },
    {
      id: 'youtube', query: `${identity} 리뷰 장기 사용 site:youtube.com`, sourceType: 'youtube', evidenceClass: 'editorial_review', specificity: 'exact_product', maxHits: 5,
    },
    {
      id: 'reddit', query: `${identity} review site:reddit.com`, sourceType: 'reddit', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 4,
    },
    {
      id: 'news', query: `${identity} 뉴스 리콜 결함`, sourceType: 'news', evidenceClass: 'editorial_review', specificity: 'exact_product', maxHits: 4,
    },
    {
      id: 'official', query: `${identity} 공식 스펙 보증 AS 인증`, sourceType: 'official_or_accredited', evidenceClass: 'official_record', specificity: 'exact_product', maxHits: 4,
    },
    {
      id: 'instagram', query: `${identity} site:instagram.com`, sourceType: 'instagram', evidenceClass: 'community_report', specificity: 'exact_product', maxHits: 3,
    },
  ];

  if (shouldUseAcademicResearch(question)) {
    queries.push({
      id: 'academic',
      query: `${intent || identity} research ergonomics safety performance site:pubmed.ncbi.nlm.nih.gov`,
      sourceType: 'academic',
      evidenceClass: 'peer_reviewed_research',
      specificity: 'general_mechanism',
      maxHits: 4,
    });
  }

  return unique(queries);
}
