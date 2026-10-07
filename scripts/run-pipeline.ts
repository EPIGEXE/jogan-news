// 앱 없이 브리핑 파이프라인을 한 번 실행한다 (개발·디버깅용).
//   npm run pipeline            # .data/dev.db에 브리핑 생성 (GROQ_API_KEY 필요)
//   npm run pipeline -- --show  # 마지막 브리핑만 출력

import { config } from 'dotenv'
import { WorkerService } from '../src/worker/service'

config({ path: '.env', quiet: true })

const service = new WorkerService({
  dbPath: '.data/dev.db',
  configDir: 'config',
  apiKey: process.env['GROQ_API_KEY'] ?? null,
  onProgress: (p) => console.log(`[${p.stage}] ${p.message}${p.total ? ` ${p.current}/${p.total}` : ''}`),
  log: (level, message) => console.log(`  ${level === 'info' ? '·' : level === 'warn' ? '!' : '✗'} ${message}`),
  onItemUpdated: () => {}
})

async function main(): Promise<void> {
  if (!process.argv.includes('--show')) {
    const r = await service.runPipeline({ reason: 'manual' })
    console.log(`\n완료: ${r.entries}건, 비용 $${r.costUsd.toFixed(4)}`)
  }
  const d = service.getLatestDigest()
  if (!d) return console.log('브리핑 없음')
  console.log(`\n■ ${d.date} ${d.headline}\n${d.overview ?? ''}\n`)
  for (const e of d.entries) {
    console.log(`${String(e.rank).padStart(2)}. [${e.section}] ${e.titleKo}`)
    console.log(`    ${e.originalTitle} · ${e.sourceName}${e.engagementLabel ? ` · ${e.engagementLabel}` : ''}`)
    console.log(`    ${e.summaryKo}`)
    if (e.whyItMatters) console.log(`    → ${e.whyItMatters}`)
  }
  console.log('\n사용량', service.getUsage())
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => service.close())
