import type {
  CanonicalProductIdentity,
  MarketCoverage,
  MarketOffer,
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
    : report.price?.salePrice
      ? `- 현금 결제: **${won(report.price.salePrice)}** · 공개 판매페이지 검증가`
      : '- 현금 결제: 검증 완료 가격 없음');

  const publicConditional = report.bestOffers?.publicConditional;
  lines.push(publicConditional
    ? `- 공개 조건가: **${won(publicConditional.amount)}** · ${publicConditional.offer.market}${publicConditional.offer.promotion?.condition ? ` · ${publicConditional.offer.promotion.condition}` : ''}`
    : '- 공개 조건가: 검증된 현재 적용가 없음');

  const alternative = report.bestOffers?.alternativeCondition;
  lines.push(alternative
    ? `- 동일 SKU 상태 대안: **${won(alternative.amount)}** · ${alternative.offer.condition} · ${alternative.offer.market}`
    : '- 동일 SKU 상태 대안: 검증된 후보 없음');
  return lines;
}

function benefitSignal(offer: MarketOffer): string[] {
  const signals: string[] = [];
  if (offer.cardName) signals.push(offer.cardName);
  if (offer.paymentMethod) signals.push(offer.paymentMethod);
  if (offer.promotion?.condition) signals.push(offer.promotion.condition);
  for (const condition of offer.conditions ?? []) {
    if (/(카드|쿠폰|멤버|회원|적립|페이|pay|포인트|할인)/i.test(condition)) signals.push(condition);
  }
  if (offer.membershipPrice !== undefined) signals.push('회원/멤버십 가격 혜택');
  if (offer.rewardPoints !== undefined || offer.effectivePrice !== undefined) signals.push('적립/포인트 혜택');
  return [...new Set(signals.map((item) => item.trim()).filter(Boolean))];
}

function benefitLines(report: ProductReport): string[] {
  const candidates = (report.offers ?? []).filter((offer) =>
    offer.cardName
    || offer.cardPrice !== undefined
    || offer.paymentMethod
    || offer.paymentPrice !== undefined
    || offer.membershipPrice !== undefined
    || offer.rewardPoints !== undefined
    || offer.effectivePrice !== undefined
    || (offer.conditions ?? []).some((condition) => /(카드|쿠폰|멤버|회원|적립|페이|pay|포인트|할인)/i.test(condition)));

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const offer of candidates) {
    const signals = benefitSignal(offer);
    if (!signals.length) continue;
    const key = `${offer.url}|${signals.join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${signals.join(' · ')} · 실제 적용 여부와 최종 금액은 판매페이지에서 확인 · ${offer.url}`);
    if (lines.length >= 5) break;
  }

  const personalized = report.personalizedPrice;
  if (personalized?.sourceUrl && lines.length < 5) {
    const hasMemberSignal = personalized.membershipPrice !== undefined
      || personalized.membershipPoints !== undefined
      || personalized.basePoints !== undefined;
    if (hasMemberSignal && !lines.some((line) => line.includes(personalized.sourceUrl!))) {
      lines.push(`- 회원/멤버십·적립 혜택이 계정에 따라 달라질 수 있음 · 실제 적용 여부와 최종 금액은 판매페이지에서 확인 · ${personalized.sourceUrl}`);
    }
  }

  return lines.length ? lines : ['- 추가 카드·회원·계정별 혜택은 판매페이지에서 직접 확인'];
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
  for (const check of report.manualChecks ?? []) lines.push(`- ${check.message}${check.url ? ` · ${check.url}` : ''}`);
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
  const benefits = benefitLines(report).join('\n');
  const history = historyLines(report).join('\n');
  const coverage = coverageLines(report.marketCoverage).join('\n');
  const relay = `- ${context.relay.mode} · used=${context.relay.used}${context.relay.message ? ` · ${context.relay.message}` : ''}`;
  const limitations = limitationLines(report).join('\n');

  const sections = {
    conclusion,
    prices,
    benefits,
    history,
    coverage,
    relay,
    limitations,
  };
  return {
    markdown: [
      '## 결론', conclusion,
      '## 공개 검증 가격', prices,
      '## 현재 추가 혜택', benefits,
      '## 가격 이력', history,
      '## 시장 확인', coverage,
      '## Relay', relay,
      '## 제한/추가 확인', limitations,
    ].join('\n\n'),
    sections,
  };
}
