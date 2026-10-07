// 화면 코드가 디자인 토큰을 우회하지 않는지 검사한다 (DESIGN.md 6.6절).
// - Tailwind 임의 값: bg-[#fff], text-[13px], w-[440px] …
// - 색 값 직접 쓰기: #fff, rgb(…)
// - 인라인 style 속성 (견본 화면의 토큰 색상표처럼 꼭 필요한 곳은 아래 허용 목록에)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = 'src/renderer/src'
const ALLOW_INLINE_STYLE = new Set(['pages/DevComponentsPage.tsx', 'components/app/RunProgress.tsx'])

const RULES = [
  { name: 'Tailwind 임의 값', re: /(?<![\w-])[a-z][\w-]*-\[[^\]]+\]/g },
  { name: '색 값 직접 쓰기', re: /#[0-9a-fA-F]{3,8}\b|rgba?\(/g },
  { name: '인라인 style', re: /style=\{\{/g, allow: ALLOW_INLINE_STYLE }
]

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') ? [p] : []
  })
}

let problems = 0
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.allow?.has(rel)) continue
      for (const m of line.matchAll(rule.re)) {
        console.log(`${rel}:${i + 1}  ${rule.name}: ${m[0]}`)
        problems++
      }
    }
  })
}

if (problems) {
  console.log(`\n토큰을 우회한 곳 ${problems}건. styles/tokens.css에 토큰을 추가해서 쓰세요.`)
  process.exit(1)
}
console.log('토큰 검사 통과')
