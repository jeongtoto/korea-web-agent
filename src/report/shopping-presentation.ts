import type {
  CanonicalProductIdentity,
  MarketCoverage,
  ProductReport,
  RelayStatus,
} from '../core/types.ts';

export interface ShoppingPresentation {
  markdown: string;
  sections?: Record<string, string>;
}

export interface ShoppingPresentationContext {
  canonicalIdentity?: CanonicalProductIdentity;
  fallbackName?: string | undefined;
  relay: RelayStatus;
}

function won(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function identityLabel(context: ShoppingPresentationContext): string {
  const identity = context.canonicalIdentity;
  if (!identity) return context.fallbackName?.trim() || '상품 신원 미확정';
  const parts: string[] = [];
  if (identity.brand) parts.push(identity.brand);
  if (identity.primary.model) parts.push(identity.primary.model);
  for (const component of identity.requiredComponents) {
    const label = [component.model, component.version ? `(${component.version})` : undefined]
      .filter(Boolean)
      .join('');
    if (label && !parts.includes(label)) parts.push(label);
  }
  if (identity.primary.size) parts.push(identity.primary.size);
  return parts.join(' + ') || context.fallbackName?.trim() || '상품 신원 미확정';
}

function priceLines(report: ProductReport): string[] {
  const lines: string[] = [];
  const cash = report.bestOffers?.cash;
  lines.push(cash
    ? `- 현금 결제: **${won(cash.amount)}** · ${cash.offer.market} · ${cash.offer.verification}`
    : '- 현금 결제: 검증 완료 가격 없음');

  const publicConditional = report.bestOffers?.publicConditional;
  lines.push(publicConditional
    ? `- 공개 조건가: **${won(publicConditional.amount)}** · ${publicConditional.offer.market}${publicConditional.offer.promotion?.condition ? ` · ${publicConditional.offer.promotion.condition}` : ''}`
    : '- 공개 조건가: 검증된 현재 적용가 없음');

  const owned = report.bestOffers?.ownedCard;
  lines.push(owned
    ? `- 보유 카드: **${won(owned.amount)}**${owned.offer.cardName ? ` · ${owned.offer.cardName}` : ''}`
    : '- 보유 카드: 검증된 적용가 없음');

  const conditional = report.bestOffers?.conditionalPayment;
  lines.push(conditional
    ? `- 조건부 결제: **${won(conditional.amount)}**${conditional.offer.paymentMethod ? ` · ${conditional.offer.paymentMethod}` : ''}`
    : '- 조건부 결제: 검증된 적용가 없음');

  const without = report.membershipScenarios?.withoutMembership;
  const withMembership = report.membershipScenarios?.withMembership;
  if (without || withMembership) {
    const chunks: string[] = [];
    if (without) chunks.push(`비회원 체감 ${won(without.effectivePrice)}`);
    if (withMembership) chunks.push(`회원 체감 ${won(withMembership.effectivePrice)}`);
    lines.push(`- 멤버십/체감가: ${chunks.join(' · ')}`);
  } else if (report.bestOffers?.effective) {
    lines.push(`- 적립 반영 체감가: **${won(report.bestOffers.effective.amount)}**`);
  } else {
    lines.push('- 멤버십/체감가: 검증된 시나리오 없음');
  }

  const alternative = report.bestOffers?.alternativeCondition;
  lines.push(alternative
    ? `- 동일 SKU 상태 대안: **${won(alternative.amount)}** · ${alternative.offer.condition} · ${alternative.offer.market}`
    : '- 동일 SKU 상태 대안: 검증된 후보 없음');
  return lines;
}

function historyLines(report: ProductReport): string[] {
  const history = report.priceHistory;
  if (!history) return ['- canonical public 가격 이력 없음'];
  const latest = history.observations.at(-1);
  const position = history.position.label;
  return [
    `- SKU: ${history.sku}`,
    `- 관측: ${history.observations.length}건${latest ? ` · 최근 ${won(latest.cashPrice)}` : ''}`,
    `- 변동: ${history.comparison.direction} · 6개월 위치: ${position}`,
  ];
}

function coverageLines(coverage: MarketCoverage[] | undefined): string[] {
  if (!coverage?.length) return ['- 시장별 검증 기록 없음'];
  return coverage.map((item) => {
    const diagnostics: string[] = [];
    if (item.comparisonPages !== undefined) diagnostics.push(`비교페이지 ${item.comparisonPages}`);
    if (item.expandedSellers !== undefined) diagnostics.push(`판매자 확장 ${item.expandedSellers}`);
    if (item.exactOffers !== undefined) diagnostics.push(`exact ${item.exactOffers}`);
    if (item.eligibleSellers !== undefined) diagnostics.push(`eligible ${item.eligibleSellers}`);
    if (item.failureKind) diagnostics.push(`실패 ${item.failureKind}`);
    return `- ${item.market}: ${item.status} · 발견 ${item.found} / 검증 ${item.verified}${diagnostics.length ? ` · ${diagnostics.join(' · ')}` : ''}`;
  });
}

function limitationLines(report: ProductReport): string[] {
  const lines: string[] = [];
  for (const check of report.manualChecks ?? []) lines.push(`- ${check.message}`);
  for (const warning of report.validationWarnings ?? []) {
    lines.push(`- [${warning.severity}] ${warning.code}: ${warning.message}`);
  }
  for (const missing of report.missingInformation) lines.push(`- ${missing}`);
  return lines.length ? lines : ['- 추가 확인 사항 없음'];
}

export function buildShoppingPresentation(
  report: ProductReport,
  context: ShoppingPresentationContext,
): ShoppingPresentation {
  const conclusion = [
    `**${report.decision}** · ${identityLabel(context)}`,
    report.summary,
  ].join('\n');
  const prices = priceLines(report).join('\n');
  const history = historyLines(report).join('\n');
  const coverage = coverageLines(report.marketCoverage).join('\n');
  const relay = `- ${context.relay.mode} · used=${context.relay.used}${context.relay.message ? ` · ${context.relay.message}` : ''}`;
  const limitations = limitationLines(report).join('\n');

  const sections = {
    conclusion,
    prices,
    history,
    coverage,
    relay,
    limitations,
  };
  return {
    markdown: [
      '## 결론', conclusion,
      '## 가격', prices,
      '## 가격 이력', history,
      '## 시장 확인', coverage,
      '## Relay', relay,
      '## 제한/추가 확인', limitations,
    ].join('\n\n'),
    sections,
  };
}
