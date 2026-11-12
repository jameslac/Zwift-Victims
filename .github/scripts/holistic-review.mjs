// Holistic PR review: sends the PR diff + project docs to Gemini and posts/updates one PR comment.
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const {
  GEMINI_API_KEY, GITHUB_TOKEN, PR_NUMBER, PR_TITLE = '', PR_BODY = '',
  BASE_SHA, HEAD_SHA, REPO, GEMINI_MODEL = 'gemini-2.5-pro',
} = process.env

const MARKER = '<!-- holistic-pr-review -->'
const MAX_DIFF = 150_000

if (!GEMINI_API_KEY) {
  console.log('GEMINI_API_KEY not set; skipping review.')
  process.exit(0)
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
let diff = execSync(`git diff ${BASE_SHA}...${HEAD_SHA} -- . ':(exclude)package-lock.json'`, {
  encoding: 'utf8', maxBuffer: 50 * 1024 * 1024,
})
if (diff.length > MAX_DIFF) diff = diff.slice(0, MAX_DIFF) + '\n...[diff truncated]'

const prompt = `You are a senior engineer doing a HOLISTIC pull request review for the Zwift Victims repo
(React + Vite + Tailwind PWA with a Cloudflare Worker backend).

Go beyond line nitpicks. Assess:
1. Correctness & bugs, edge cases, error handling
2. Security (secrets, auth, XSS, unsafe fetches, Worker proxy abuse)
3. Consistency with docs/ARCHITECTURE.md and existing conventions
4. Architecture changes: if this PR changes architecture, say whether a NEW GitHub check/validator should be added for it
5. Docs/tests/README that should be updated
6. Scope: does the diff match the PR title/description?

Output concise Markdown: a one-line verdict (Approve / Approve with comments / Request changes),
then sections "Blocking", "Suggestions", "Nice touches". Omit empty sections.

## PR title
${PR_TITLE}

## PR description
${PR_BODY}

## Architecture doc
${read('docs/ARCHITECTURE.md').slice(0, 20000)}

## Agent guidelines
${read('AGENTS.md')}

## Diff
\`\`\`diff
${diff}
\`\`\``

const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  },
)
if (!res.ok) {
  console.error(`Gemini error ${res.status}: ${await res.text()}`)
  process.exit(1)
}
const data = await res.json()
const review = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '_No review generated._'
const body = `${MARKER}\n## 🤖 Holistic PR Review (${GEMINI_MODEL})\n\n${review}\n\n<sub>Commit ${HEAD_SHA.slice(0, 7)} · advisory only</sub>`

const gh = (path, init = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
  })

const comments = await (await gh(`/issues/${PR_NUMBER}/comments?per_page=100`)).json()
const existing = comments.find((c) => c.body?.includes(MARKER))
if (existing) {
  await gh(`/issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) })
} else {
  await gh(`/issues/${PR_NUMBER}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
}
console.log('Review posted.')
