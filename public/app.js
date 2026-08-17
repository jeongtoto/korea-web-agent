const form = document.querySelector('#researchForm');
const progress = document.querySelector('#progress');
const report = document.querySelector('#report');
const submitButton = document.querySelector('#submitButton');
const serviceStatus = document.querySelector('#serviceStatus');
const relayStatus = document.querySelector('#relayStatus');
const urlInput = document.querySelector('#url');

const money = (value, currency = 'KRW') => {
  if (typeof value !== 'number') return '—';
  try { return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${value.toLocaleString('ko-KR')} ${currency}`; }
};

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
const list = (items, empty = '확인된 항목 없음') => `<ul>${items?.length ? items.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : `<li class="muted">${empty}</li>`}</ul>`;

function renderReport(job) {
  const r = job.report;
  if (!r) {
    report.innerHTML = `<section class="card"><h3>조사 결과</h3><p class="error">구조화된 제품 리포트를 만들지 못했습니다.</p></section>`;
    report.classList.remove('hidden');
    return;
  }
  const price = r.personalizedPrice || r.price;
  const priceValue = price?.membershipPrice ?? price?.couponPrice ?? price?.salePrice ?? price?.listPrice;
  const evidenceHtml = (r.evidence || []).slice(0, 20).map((item) => `
    <article class="evidence">
      <div class="evidence-head"><span>${escapeHtml(item.evidenceClass)}</span><span>${Math.round((item.confidence || 0) * 100)}%</span></div>
      <p>${escapeHtml(item.claim)}</p>
      <a href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="noreferrer">원문 보기</a>
    </article>`).join('');

  report.innerHTML = `
    <section class="summary-card">
      <div class="summary-top">
        <span class="decision">${escapeHtml(r.decision)}</span>
        <span class="confidence">Confidence ${Math.round((r.confidence || 0) * 100)}% · ${r.sourceCount || 0} sources</span>
      </div>
      <h2>${escapeHtml(r.title)}</h2>
      <p>${escapeHtml(r.summary)}</p>
    </section>
    <div class="grid">
      <section class="card"><h3>현재 확인 가격</h3><div class="metric">${money(priceValue, price?.currency || 'KRW')}</div><p class="muted">${price?.shippingEta ? `배송 예정 ${escapeHtml(price.shippingEta)}` : job.relay?.message ? escapeHtml(job.relay.message) : '공개 가격 기준'}</p></section>
      <section class="card"><h3>핵심 근거</h3>${list(r.reasons)}</section>
      <section class="card"><h3>장점 신호</h3>${list(r.strengths)}</section>
      <section class="card"><h3>주의 신호</h3>${list(r.weaknesses)}</section>
    </div>
    <section class="card"><h3>아직 확인이 필요한 것</h3>${list(r.missingInformation)}</section>
    <section class="card"><h3>근거 원문</h3><div class="evidence-list">${evidenceHtml || '<p class="muted">수집된 근거가 없습니다.</p>'}</div></section>
  `;
  report.classList.remove('hidden');
}


async function pollResearchJob(id, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const res = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '조사 상태 확인에 실패했습니다.');
    if (!['queued', 'running'].includes(data.status)) return data;
  }
  throw new Error('PC 개인화 조회가 45초 안에 완료되지 않았습니다. 공개 조사 결과는 저장되어 있습니다.');
}

async function relayHealth() {
  try {
    const res = await fetch('/api/relay/status');
    const data = await res.json();
    relayStatus.classList.remove('ok', 'warn');
    if (data.online) { relayStatus.textContent = 'PC RELAY ONLINE'; relayStatus.classList.add('ok'); }
    else if (data.enabled) { relayStatus.textContent = 'PC RELAY OFFLINE'; relayStatus.classList.add('warn'); }
    else { relayStatus.textContent = 'PC RELAY 미설정'; }
  } catch { relayStatus.textContent = 'PC RELAY 확인 실패'; }
}

async function health() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error();
    serviceStatus.textContent = 'ONLINE';
    serviceStatus.classList.add('ok');
  } catch {
    serviceStatus.textContent = 'OFFLINE';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  report.classList.add('hidden');
  progress.classList.remove('hidden');
  progress.textContent = '원문과 관련 근거를 수집하고 있습니다…';
  const payload = {
    question: document.querySelector('#question').value.trim(),
    url: urlInput.value.trim() || undefined,
    includeLocalRelay: document.querySelector('#localRelay').checked,
    category: 'auto',
  };
  try {
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data = await res.json();
    if (!res.ok) throw new Error(data.error || '조사 요청에 실패했습니다.');
    if (['queued', 'running'].includes(data.status)) {
      progress.textContent = '공개 조사는 완료했습니다. 로그인된 PC에서 개인 쿠폰가·배송 정보를 확인하고 있습니다…';
      renderReport(data);
      data = await pollResearchJob(data.id);
    }
    progress.textContent = data.status === 'partial' ? '일부 소스는 차단됐지만 확보된 근거로 분석했습니다.' : '조사가 완료되었습니다.';
    renderReport(data);
  } catch (error) {
    progress.innerHTML = `<span class="error">${escapeHtml(error.message || String(error))}</span>`;
  } finally {
    submitButton.disabled = false;
  }
});

const params = new URLSearchParams(location.search);
if (params.get('url')) urlInput.value = params.get('url');
health();
relayHealth();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
