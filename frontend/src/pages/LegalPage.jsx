/**
 * DOJO-87: published Terms of Service and Privacy Policy pages.
 *
 * Content lives in src/content/legalText.js / legalPrivacyText.js (mirrors of the
 * HIVE-323 wiki templates 26576e47 / 72e80a42). Prerendered SPA shells for these
 * routes are produced by scripts/generate-route-html.mjs so nginx serves a real
 * document for /terms and /privacy instead of the bare-directory 403.
 */
import { TERMS_SECTIONS } from '../content/legalText'
import { PRIVACY_SECTIONS } from '../content/legalPrivacyText'

function LegalBlock({ block }) {
  if (block.p) return <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">{block.p}</p>
  if (block.ul) {
    return (
      <ul className="list-disc pl-6 space-y-1.5">
        {block.ul.map((item, i) => (
          <li key={i} className="text-sm leading-6 text-gray-700 dark:text-gray-300">
            {item}
          </li>
        ))}
      </ul>
    )
  }
  if (block.table) {
    const { head, rows } = block.table
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-gray-200 dark:border-gray-700">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800">
              {head.map((cell, i) => (
                <th key={i} className="text-left px-3 py-2 font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-200 dark:border-gray-700">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                {row.map((cell, c) => (
                  <td key={c} className="px-3 py-2 text-gray-700 dark:text-gray-300 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return null
}

function LegalPage({ title, updated, intro, sections }) {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <a href="/" className="text-sm text-cyan-600 hover:text-cyan-700 dark:text-cyan-400">
          ← shizuha.com
        </a>
        <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          Shizuha Global Pvt. Ltd · Last updated: {updated}
        </p>
        {intro ? <p className="mt-4 text-sm leading-6 text-gray-700 dark:text-gray-300">{intro}</p> : null}
        <div className="mt-8 space-y-8">
          {sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={section.id}>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{section.heading}</h2>
              <div className="space-y-3">
                {section.blocks.map((block, i) => (
                  <LegalBlock key={i} block={block} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 flex gap-6 text-sm">
          <a href="/terms" className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400">Terms of Service</a>
          <a href="/privacy" className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400">Privacy Policy</a>
        </div>
      </div>
    </div>
  )
}

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="September 2026"
      intro="These Terms apply to all Shizuha services and live public surfaces (Connect, Dojo, Pulse, Wiki, Drive, Cortex, Hive, and the shizuha.com website). Dojo-specific and Connect-specific provisions are marked inline."
      sections={TERMS_SECTIONS}
    />
  )
}

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 2026"
      intro="Legal framework: Digital Personal Data Protection Act, 2023 (India); Information Technology Act, 2000 and IT (Intermediary Guidelines) Rules, 2021."
      sections={PRIVACY_SECTIONS}
    />
  )
}

export default LegalPage
