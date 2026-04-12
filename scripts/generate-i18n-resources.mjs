import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..')
const sourceDir = join(projectRoot, 'src', 'i18n', 'messages')
const outputDir = join(projectRoot, 'src', 'i18n', 'generated')

const locales = [
  ['zh-CN', 'zh-CN.ts'],
  ['en-US', 'en-US.ts'],
]

async function main() {
  await mkdir(outputDir, { recursive: true })

  for (const [locale, sourceFile] of locales) {
    const moduleUrl = pathToFileURL(join(sourceDir, sourceFile)).href
    const messages = (await import(moduleUrl)).default
    const outputPath = join(outputDir, `${locale}.json`)
    await writeFile(outputPath, `${JSON.stringify(messages, null, 2)}\n`, 'utf8')
    console.log(`[i18n] generated ${locale}.json`)
  }
}

await main()
