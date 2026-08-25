import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendations } from '../src/core/recommendation-engine.ts';
import type { ProductCandidate } from '../src/core/types.ts';

function candidate(title: string, score = 0.85, verifiedFacts?: Record<string, unknown>): ProductCandidate {
  return {
    target: { kind: 'product', name: title },
    title,
    score,
    sourceUrls: [`https://example.com/${encodeURIComponent(title)}`],
    ...(verifiedFacts ? { verifiedFacts } : {}),
  };
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

test('title wording alone cannot satisfy hard constraints without verified facts', () => {
  const result = buildRecommendations({
    question: '1670×2075 매트리스가 실제로 올라가야 함. 서랍형 필수. 무헤드 또는 소파형 헤드만.',
    candidates: [candidate('1700×2075 서랍형 소파형 완벽 호환 프레임 리뷰 4.9', 0.99)],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.preliminary, true);
});

test('returns only hard-constraint verified frames when verified options exist instead of padding the shortlist', () => {
  const result = buildRecommendations({
    question: '1670×2075 매트리스가 실제로 올라가야 함. 서랍형 필수. 무헤드 또는 소파형 헤드만.',
    limit: 5,
    candidates: [
      candidate('A 프레임 리뷰 4.8', 0.92, { supportedWidthMm: 1700, supportedLengthMm: 2075, drawerStorage: true, headboardStyle: 'sofa' }),
      candidate('B 프레임 리뷰 4.7', 0.9, { supportedWidthMm: 1680, supportedLengthMm: 2100, drawerStorage: true, headboardStyle: 'headless' }),
      candidate('C 프레임 1700×2075 서랍형 소파형 리뷰 4.9', 0.99),
      candidate('D 프레임 리뷰 4.9', 0.99, { supportedWidthMm: 1700, supportedLengthMm: 2000, drawerStorage: true, headboardStyle: 'sofa' }),
    ],
  });

  assert.equal(result.length, 2);
  assert.deepEqual(result.map((item) => item.title.slice(0, 1)), ['A', 'B']);
});
