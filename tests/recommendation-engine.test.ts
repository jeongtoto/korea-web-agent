import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendations } from '../src/core/recommendation-engine.ts';
import type { ProductCandidate } from '../src/core/types.ts';

function candidate(title: string, score = 0.85): ProductCandidate {
  return { target: { kind: 'product', name: title }, title, score, sourceUrls: [`https://example.com/${encodeURIComponent(title)}`] };
}

test('returns Best 3 bedding choices using fit, design, care, review and value signals', () => {
  const candidates = [
    candidate('알러지케어 고밀도 순면 레드 포인트 호텔 차렵이불 Q 퀸 세탁가능 후기 4.8'),
    candidate('모달 100 사계절 차렵이불 Q 베이지 레드 배색 먼지 적음 리뷰 4.7'),
    candidate('워싱 순면 차렵이불 퀸 딥그레이 레드 침대 어울림 세탁기 가능 리뷰 4.6'),
    candidate('극세사 겨울 이불 싱글 세탁 어려움 리뷰 3.9', 0.7),
  ];
  const recommendations = buildRecommendations({
    question: '에이스 하이테크 레드 침대에 어울리는 퀸 이불 추천해줘. 관리 편하고 품질과 리뷰도 중요해',
    candidates,
  });

  assert.equal(recommendations.length, 3);
  assert.equal(recommendations[0]?.rank, 1);
  assert.ok((recommendations[0]?.scores.design ?? 0) > 0.6);
  assert.ok((recommendations[0]?.scores.care ?? 0) > 0.5);
  assert.ok(recommendations.every((item) => item.reasons.length > 0));
});

test('marks weakly evidenced candidates preliminary instead of presenting certainty', () => {
  const result = buildRecommendations({ question: '좋은 이불 추천', candidates: [candidate('광고 신상 이불', 0.4)] });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.preliminary, true);
  assert.ok((result[0]?.confidence ?? 1) < 0.7);
});
