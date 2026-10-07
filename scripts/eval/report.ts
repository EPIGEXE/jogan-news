// 비교 테스트 결과를 한 장짜리 HTML로 만든다. 브라우저에서 바로 열 수 있고, 외부 리소스를 쓰지 않는다.
// 기본은 블라인드 모드: 기사마다 모델 순서를 섞고 A/B/C로만 표시해서 모델 이름에 끌리지 않게 한다.

import type { EvalResult, EvalRun, Sample } from './types'

/** 실사용 가정: 하루 약 60건 요약, 월 22일 (DESIGN.md 7.3절) */
const DAILY_ITEMS = 60
const WORK_DAYS = 22

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const KIND_LABEL: Record<Sample['kind'], string> = { news: '뉴스', paper: '논문', community: '커뮤니티' }

/** 기사 id로 정해지는 순서 섞기. 다시 생성해도 같은 순서가 나온다. */
function seededOrder<T>(items: T[], seed: string): T[] {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

function summaryTable(run: EvalRun): string {
  const rows = run.models.map((m) => {
    const rs = run.results.filter((r) => r.model === m.model)
    const ok = rs.filter((r) => r.ok && r.usage)
    const avg = (f: (r: EvalResult) => number) => (ok.length ? ok.reduce((t, r) => t + f(r), 0) / ok.length : 0)
    const avgCost = avg((r) => r.costUsd ?? 0)
    return `<tr>
      <td><strong>${esc(m.model)}</strong><br><small class="muted">추론 ${m.reasoningEffort ?? '-'}</small></td>
      <td>${ok.length}/${rs.length}</td>
      <td>${(avg((r) => r.latencyMs ?? 0) / 1000).toFixed(1)}초</td>
      <td>${Math.round(avg((r) => r.usage!.input))} / ${Math.round(avg((r) => r.usage!.output))} <small class="muted">(추론 ${Math.round(avg((r) => r.usage!.reasoning))})</small></td>
      <td>$${(avgCost * 1000).toFixed(3)}</td>
      <td>$${(avgCost * DAILY_ITEMS * WORK_DAYS).toFixed(2)}</td>
      <td class="tally" data-model="${esc(m.model)}">0</td>
    </tr>`
  })
  return `<table class="summary">
    <thead><tr><th>모델</th><th>성공</th><th>평균 지연</th><th>평균 토큰 (입력 / 출력)</th><th>1,000건당 비용</th><th>월 예상 (요약만, 하루 ${DAILY_ITEMS}건)</th><th>내가 고른 횟수</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table>`
}

function resultCell(r: EvalResult | undefined, label: string, model: string, sampleId: string): string {
  const head = `<div class="col-head"><span class="blind-label">${label}</span><span class="model-name">${esc(model)}</span></div>`
  if (!r) return `<div class="col">${head}<p class="error">결과 없음</p></div>`
  if (!r.ok || !r.data) return `<div class="col">${head}<p class="error">실패: ${esc(r.error ?? '')}</p></div>`
  const d = r.data
  return `<div class="col">
    ${head}
    <h4>${esc(d.title_ko)}</h4>
    <p>${esc(d.summary_ko)}</p>
    <ul>${d.key_points.map((k) => `<li>${esc(k)}</li>`).join('')}</ul>
    <p class="meta">${esc(d.category)} · 관련도 ${d.relevance} · 중요도 ${d.importance}<br>
      ${r.usage!.input}/${r.usage!.output} 토큰 · ${((r.latencyMs ?? 0) / 1000).toFixed(1)}초 · $${(r.costUsd ?? 0).toFixed(5)}</p>
    <label class="pick"><input type="radio" name="pick-${esc(sampleId)}" value="${esc(model)}"> 이게 제일 낫다</label>
  </div>`
}

function sampleSection(run: EvalRun, s: Sample): string {
  const order = seededOrder(run.models.map((m) => m.model), s.id)
  const cols = order
    .map((model, i) =>
      resultCell(
        run.results.find((r) => r.sampleId === s.id && r.model === model),
        String.fromCharCode(65 + i),
        model,
        s.id
      )
    )
    .join('')
  const preview = s.paragraphs.slice(0, 4).map((p) => `<p>${esc(p)}</p>`).join('')
  return `<section class="sample" id="${esc(s.id)}">
    <div class="sample-head">
      <span class="badge">${KIND_LABEL[s.kind]}</span>
      <span class="muted">${esc(s.source)}${s.fullText ? '' : ' · 요약/초록만'}</span>
    </div>
    <h3><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)}</a></h3>
    <details><summary>원문 앞부분 보기</summary>${preview}</details>
    <div class="cols" style="--n:${order.length}">${cols}</div>
  </section>`
}

export function renderReport(run: EvalRun): string {
  const storageKey = `ainews-eval-${run.generatedAt}`
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>한국어 요약 비교</title>
<style>
:root{--bg:#f7f7f8;--surface:#fff;--text:#1f2328;--muted:#6b7280;--border:#e5e7eb;--accent:#6366f1;--error:#dc2626;--pick:#eef2ff}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--surface:#1a1d24;--text:#e6e8eb;--muted:#9aa3af;--border:#2a2f39;--accent:#818cf8;--error:#f87171;--pick:#262a46}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 'Segoe UI','Malgun Gothic',system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}h3{font-size:16px;margin:4px 0 8px}h4{font-size:15px;margin:0 0 6px}
a{color:var(--accent)}.muted{color:var(--muted)}.error{color:var(--error)}
.toolbar{display:flex;gap:16px;align-items:center;margin:12px 0 20px;flex-wrap:wrap}
table.summary{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:24px}
.summary th,.summary td{padding:10px;border-top:1px solid var(--border);text-align:left;vertical-align:top}
.summary th{color:var(--muted);font-weight:600;border-top:none}
.sample{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px}
.sample-head{display:flex;gap:8px;align-items:center}
.badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--accent);color:#fff}
details{margin-bottom:12px;color:var(--muted)}details p{margin:6px 0}
.cols{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));gap:12px}
@media (max-width:900px){.cols{grid-template-columns:1fr}}
.col{border:1px solid var(--border);border-radius:8px;padding:12px;display:flex;flex-direction:column}
.col:has(input:checked){background:var(--pick);border-color:var(--accent)}
.col ul{margin:0 0 8px;padding-left:18px}
.col-head{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px}
.blind .model-name{display:none}:not(.blind) .blind-label{display:none}
.meta{font-size:12px;color:var(--muted);margin-top:auto}
.pick{font-size:13px;cursor:pointer}
</style></head>
<body><main>
<h1>한국어 요약 품질 비교</h1>
<p class="muted">생성 ${esc(new Date(run.generatedAt).toLocaleString('ko-KR'))} · 기사 ${run.samples.length}건 × 모델 ${run.models.length}개</p>
<div class="toolbar">
  <label><input type="checkbox" id="blind" checked> 블라인드 모드 (모델 이름 숨기기)</label>
  <span class="muted">기사마다 가장 나은 요약을 고르면 위 표의 "내가 고른 횟수"에 합산됩니다. 선택은 이 브라우저에 저장됩니다.</span>
</div>
${summaryTable(run)}
${run.samples.map((s) => sampleSection(run, s)).join('')}
</main>
<script>
const KEY=${JSON.stringify(storageKey)};
const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return{}}};
const save=v=>{try{localStorage.setItem(KEY,JSON.stringify(v))}catch{}};
function tally(){const picks=load();document.querySelectorAll('.tally').forEach(td=>{td.textContent=Object.values(picks).filter(m=>m===td.dataset.model).length})}
const picks=load();
for(const [name,model] of Object.entries(picks)){const el=document.querySelector('input[name="'+CSS.escape(name)+'"][value="'+CSS.escape(model)+'"]');if(el)el.checked=true}
document.addEventListener('change',e=>{const t=e.target;if(t.type==='radio'){const p=load();p[t.name]=t.value;save(p);tally()}});
const blind=document.getElementById('blind');const apply=()=>document.body.classList.toggle('blind',blind.checked);blind.addEventListener('change',apply);apply();tally();
</script>
</body></html>`
}
