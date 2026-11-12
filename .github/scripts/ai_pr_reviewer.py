#!/usr/bin/env python3
"""
Holistic Repo-Aware AI Pull Request Reviewer for Zwift-Victims.

Features:
- Scans the full repository structure, AGENTS.md, docs/ARCHITECTURE.md,
  docs/API_REFERENCE.md, Cloudflare Worker code (worker/), and React/TS PWA
  source code (src/).
- Tracks repository scale (lines & estimated tokens) against the single-pass budget
  and warns on the PR when approaching the threshold (~75%).
- Supports Anthropic (ANTHROPIC_API_KEY), OpenAI (OPENAI_API_KEY), or Gemini (GEMINI_API_KEY).
- Posts both a holistic PR summary review AND line-specific inline comments via the
  GitHub Pull Request Reviews REST API.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any

# Thresholds for Option 1 (Single-Pass Whole-Repo Context)
TOKEN_BUDGET_LIMIT = 80_000
LINE_BUDGET_LIMIT = 80_000
WARNING_RATIO = 0.75  # Warn at 75% capacity (~60k tokens / ~60k lines)

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "dist-ssr",
    ".wrangler",
    "coverage",
    "__pycache__",
}
IGNORED_FILES = {
    "package-lock.json",
}
CODE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".css",
    ".html",
    ".json",
    ".jsonc",
    ".md",
    ".yml",
    ".yaml",
    ".py",
}

SYSTEM_PROMPT = """You are a Senior TypeScript, React 19, and Cloudflare Workers Architecture Reviewer for "Zwift-Victims".
You are reviewing a Pull Request with FULL holistic context of the repository.

Review the PR against:
1. Project Architecture & Rules (`AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/API_REFERENCE.md`):
   - All-in-one Cloudflare Workers deployment (`wrangler.jsonc`): static React 19 + Vite 6 + Tailwind v4 PWA (`src/`) paired with a stateless `/api/*` relay (`worker/index.ts`).
   - Strict user-owned authentication & privacy: NEVER store or log user credentials or tokens on the server; tokens live strictly on the user's device (`localStorage` / `IndexedDB`).
   - Multi-source API abstraction: keep upstream providers (Zwift Core API, ZwiftPower, ZwiftRacing.app, static game data) cleanly separated under `src/api/` and pure business logic (like the pairwise 1v1 Head-to-Head engine & race exclusions) under `src/domain/`.
   - Architecture changes rule (`AGENTS.md`): whenever a PR introduces an architecture change, check whether a corresponding GitHub check/validator in `.github/workflows/` is needed.
2. Holistic Impact:
   - How these changes affect existing routes, auth/token flows (`AuthContext`), Worker proxy endpoints (`worker/index.ts`), API clients, caching, or UI pages.
3. Bugs, Performance & Security/Vulnerabilities:
   - SSRF or open-proxy risks in `worker/index.ts`, leaked secrets/tokens, CORS issues, React 19 hook pitfalls, unhandled promise rejections, or rate-limit hazards against upstream Zwift/ZwiftPower APIs.
4. Avoid Training-Cutoff False Positives:
   - Today's environment is 2026: React `19`, Vite `6`, Tailwind CSS `v4` (`@tailwindcss/vite`), Cloudflare `wrangler` v4, GitHub Actions `actions/checkout@v5` and `actions/setup-python@v6`, and Google GenAI SDK `client.interactions.create` with `gemini-3.8-flash` or `gemini-4-argon` are all valid and current. NEVER flag these identifiers or SDK methods as "non-existent".
   - Only report concrete, high-confidence issues. If the PR is clean and follows all project rules, return `"verdict": "APPROVE"`, `"risks_and_suggestions": []`, and `"inline_comments": []`.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "verdict": "APPROVE" | "COMMENT" | "NEEDS_ATTENTION",
  "headline": "One sentence overall takeaway.",
  "holistic_impact": "Markdown bullet list explaining how this PR fits into and impacts the broader repo.",
  "strengths": ["Markdown bullet 1", "Markdown bullet 2"],
  "risks_and_suggestions": ["Markdown bullet 1 (or empty list if none)"],
  "inline_comments": [
    {
      "path": "relative/path/to/file.ts",
      "line": 42,
      "body": "Concise, constructive inline note or suggestion for this specific line in the PR diff."
    }
  ]
}

Rules for `inline_comments`:
- Only attach inline comments to lines that were added or modified in the PR diff (shown with `+` in the diff).
- Keep inline comments high-signal and actionable. If no inline comments are needed, return `"inline_comments": []`.
"""


def run_git(args: list[str]) -> str:
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout


def should_ignore(rel_path: Path) -> bool:
    if rel_path.name in IGNORED_FILES:
        return True
    for part in rel_path.parts:
        if part in IGNORED_DIRS:
            return True
    return False


def collect_repo_context(repo_root: Path) -> tuple[str, dict[str, int]]:
    """Collect holistic repository context and calculate scale metrics."""
    tree_lines: list[str] = []
    file_sections: list[str] = []
    total_lines = 0
    total_files = 0

    git_files_out = run_git(["ls-files", "--cached", "--others", "--exclude-standard"])
    if git_files_out.strip():
        all_paths = [repo_root / line.strip() for line in git_files_out.splitlines() if line.strip()]
    else:
        all_paths = sorted(repo_root.rglob("*"))

    for path in all_paths:
        if not path.is_file():
            continue
        rel = path.relative_to(repo_root)
        if should_ignore(rel):
            continue

        rel_str = rel.as_posix()
        tree_lines.append(f"- {rel_str}")

        if path.suffix not in CODE_EXTENSIONS:
            continue

        raw_text = path.read_text(encoding="utf-8", errors="ignore")
        raw_line_count = len(raw_text.splitlines())
        total_lines += raw_line_count
        total_files += 1

        file_sections.append(
            f"### File: `{rel_str}` ({raw_line_count} lines)\n```\n{raw_text}\n```"
        )

    context_blob = (
        "## Repository File Tree\n"
        + "\n".join(tree_lines)
        + "\n\n## Repository Source Files\n\n"
        + "\n\n".join(file_sections)
    )
    est_tokens = max(1, len(context_blob) // 4)
    metrics = {
        "total_files": total_files,
        "total_lines": total_lines,
        "est_tokens": est_tokens,
    }
    return context_blob, metrics


def get_diff_and_valid_lines(base_sha: str, head_sha: str) -> tuple[str, dict[str, set[int]]]:
    """Return annotated diff with right-side line numbers and a map of valid (file -> set of lines) for inline comments."""
    exclude_args = ["--", ".", ":(exclude)package-lock.json"]
    raw_diff = run_git(["diff", "--unified=3", f"{base_sha}...{head_sha}", *exclude_args])
    if not raw_diff.strip():
        raw_diff = run_git(["diff", "--unified=3", base_sha, head_sha, *exclude_args])

    annotated_lines: list[str] = []
    valid_lines: dict[str, set[int]] = {}
    current_file: str | None = None
    right_line_num = 0

    hunk_re = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")

    for line in raw_diff.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[6:].strip()
            valid_lines.setdefault(current_file, set())
            annotated_lines.append(line)
            continue
        if line.startswith("--- "):
            annotated_lines.append(line)
            continue

        hunk_match = hunk_re.match(line)
        if hunk_match:
            right_line_num = int(hunk_match.group(1))
            annotated_lines.append(line)
            continue

        if current_file is None:
            annotated_lines.append(line)
            continue

        if line.startswith("+") and not line.startswith("+++"):
            valid_lines[current_file].add(right_line_num)
            annotated_lines.append(f"[L{right_line_num}] {line}")
            right_line_num += 1
        elif line.startswith("-") and not line.startswith("---"):
            annotated_lines.append(f"     {line}")
        elif line.startswith(" "):
            valid_lines[current_file].add(right_line_num)
            annotated_lines.append(f"[L{right_line_num}] {line}")
            right_line_num += 1
        else:
            annotated_lines.append(line)

    return "\n".join(annotated_lines), valid_lines


def extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


def call_anthropic(api_key: str, model: str, user_prompt: str) -> dict[str, Any]:
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": model,
        "max_tokens": 4096,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": user_prompt}],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["content"][0]["text"]
    return extract_json_object(text)


def call_openai(api_key: str, model: str, user_prompt: str) -> dict[str, Any]:
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    text = data["choices"][0]["message"]["content"]
    return extract_json_object(text)


REVIEW_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "verdict": {
            "type": "string",
            "enum": ["APPROVE", "COMMENT", "NEEDS_ATTENTION"],
        },
        "headline": {"type": "string"},
        "holistic_impact": {"type": "string"},
        "strengths": {
            "type": "array",
            "items": {"type": "string"},
        },
        "risks_and_suggestions": {
            "type": "array",
            "items": {"type": "string"},
        },
        "inline_comments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "line": {"type": "integer"},
                    "body": {"type": "string"},
                },
                "required": ["path", "line", "body"],
            },
        },
    },
    "required": [
        "verdict",
        "headline",
        "holistic_impact",
        "strengths",
        "risks_and_suggestions",
        "inline_comments",
    ],
}


def call_gemini(api_key: str, model: str, user_prompt: str) -> dict[str, Any]:
    from google import genai

    client = genai.Client(api_key=api_key)
    interaction = client.interactions.create(
        model=model,
        system_instruction=SYSTEM_PROMPT,
        input=user_prompt,
        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": REVIEW_JSON_SCHEMA,
        },
    )
    return extract_json_object(interaction.output_text or "{}")


def build_scale_meter_markdown(metrics: dict[str, int]) -> tuple[str, bool]:
    est_tokens = metrics["est_tokens"]
    total_lines = metrics["total_lines"]
    total_files = metrics["total_files"]

    token_ratio = est_tokens / TOKEN_BUDGET_LIMIT
    line_ratio = total_lines / LINE_BUDGET_LIMIT
    usage_ratio = max(token_ratio, line_ratio)
    pct = min(100.0, usage_ratio * 100.0)
    is_near_limit = usage_ratio >= WARNING_RATIO

    filled = min(10, int(round(usage_ratio * 10)))
    bar = "█" * filled + "░" * (10 - filled)
    status = "⚠️ Approaching Single-Pass Limit" if is_near_limit else "✅ Healthy (Single-Pass Mode)"

    meter_md = (
        "---\n"
        "### 📊 Holistic Repo Context Meter (Option 1 Capacity)\n"
        f"`[{bar}] {pct:.1f}%` — **{status}**\n"
        f"- **Scanned Files**: `{total_files}` | **Source Lines**: `{total_lines:,} / {LINE_BUDGET_LIMIT:,}` | "
        f"**Est. Context Tokens**: `~{est_tokens:,} / {TOKEN_BUDGET_LIMIT:,}`\n"
    )
    return meter_md, is_near_limit


def post_github_review(
    repo: str,
    pr_number: int,
    github_token: str,
    commit_id: str,
    body: str,
    inline_comments: list[dict[str, Any]],
) -> None:
    url = f"https://api.github.com/repos/{repo}/pulls/{pr_number}/reviews"
    payload: dict[str, Any] = {
        "commit_id": commit_id,
        "body": body,
        "event": "COMMENT",
    }
    if inline_comments:
        payload["comments"] = inline_comments

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {github_token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        print(f"Posted GitHub PR review (HTTP {resp.status}) with {len(inline_comments)} inline comment(s).")


def main() -> int:
    repo_root = Path.cwd()
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    openai_key = os.environ.get("OPENAI_API_KEY", "").strip()
    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    custom_model = os.environ.get("AI_REVIEW_MODEL", "").strip()

    if not (anthropic_key or openai_key or gemini_key):
        print(
            "SKIP: No AI API key found in GitHub Secrets "
            "(set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY in Repository Secrets to enable AI PR reviews)."
        )
        return 0

    pr_number_str = os.environ.get("PR_NUMBER", "").strip()
    base_sha = os.environ.get("BASE_SHA", "").strip()
    head_sha = os.environ.get("HEAD_SHA", "").strip()
    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    github_token = os.environ.get("GITHUB_TOKEN", "").strip()
    pr_title = os.environ.get("PR_TITLE", "").strip()
    pr_body = os.environ.get("PR_BODY", "").strip()

    context_blob, metrics = collect_repo_context(repo_root)
    annotated_diff, valid_lines = get_diff_and_valid_lines(base_sha, head_sha)

    if not annotated_diff.strip():
        print("No diff changes detected to review.")
        return 0

    user_prompt = (
        f"# Pull Request Metadata\n"
        f"- **Title**: {pr_title}\n"
        f"- **Description**: {pr_body or '(No description provided)'}\n\n"
        f"# Annotated PR Diff (`[L<num>]` indicates right-side line number for inline comments)\n"
        f"```diff\n{annotated_diff}\n```\n\n"
        f"# Full Repository Context\n"
        f"{context_blob}\n"
    )

    try:
        if anthropic_key:
            provider_label = "Anthropic Claude"
            model_name = custom_model or "claude-sonnet-4-5"
            review_data = call_anthropic(anthropic_key, model_name, user_prompt)
        elif openai_key:
            provider_label = "OpenAI"
            model_name = custom_model or "gpt-4o"
            review_data = call_openai(openai_key, model_name, user_prompt)
        else:
            provider_label = "Google Gemini"
            model_name = custom_model or "gemini-3.8-flash"
            review_data = call_gemini(gemini_key, model_name, user_prompt)
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        print(f"ERROR calling AI provider ({exc.code}): {err_body}")
        return 1

    verdict = review_data.get("verdict", "COMMENT")
    headline = review_data.get("headline", "Holistic repository review completed.")
    holistic_impact = review_data.get("holistic_impact", "")
    strengths = review_data.get("strengths", [])
    risks = review_data.get("risks_and_suggestions", [])
    raw_inline = review_data.get("inline_comments", [])

    valid_inline_comments: list[dict[str, Any]] = []
    fallback_notes: list[str] = []

    for item in raw_inline:
        c_path = str(item.get("path", "")).strip()
        c_line = item.get("line")
        c_body = str(item.get("body", "")).strip()
        if not c_path or not c_body or not isinstance(c_line, int):
            continue
        if c_path in valid_lines and c_line in valid_lines[c_path]:
            valid_inline_comments.append(
                {
                    "path": c_path,
                    "line": c_line,
                    "side": "RIGHT",
                    "body": c_body,
                }
            )
        else:
            fallback_notes.append(f"- **`{c_path}` (line {c_line})**: {c_body}")

    meter_md, is_near_limit = build_scale_meter_markdown(metrics)

    verdict_badge = {
        "APPROVE": "✅ **Verdict: Looks Good (Approved)**",
        "NEEDS_ATTENTION": "⚠️ **Verdict: Needs Attention**",
    }.get(verdict, "💬 **Verdict: Reviewed with Notes**")

    sections: list[str] = [
        f"## 🤖 Holistic AI Code Review ({provider_label} `{model_name}`)",
        f"{verdict_badge} — {headline}",
    ]

    if is_near_limit:
        sections.append(
            "> [!WARNING]\n"
            "> **Repository Scale Alert**: This repository has reached **>=75%** of the single-pass context budget. "
            "It is time to enable **Dependency-Aware Context Slicing** in `.github/scripts/ai_pr_reviewer.py` or switch to **Option 2 (Agentic CLI)**!"
        )

    if holistic_impact:
        sections.append(f"### 🌐 Holistic Repo Impact\n{holistic_impact}")

    if strengths:
        sections.append("### ✨ What Looks Good\n" + "\n".join(f"- {s}" for s in strengths))

    if risks:
        sections.append("### 🔍 Risks, Vulnerabilities & Suggestions\n" + "\n".join(f"- {r}" for r in risks))

    if fallback_notes:
        sections.append("### 📌 File-Specific Notes (Outside Diff Hunks)\n" + "\n".join(fallback_notes))

    sections.append(meter_md)
    full_body = "\n\n".join(sections)

    if repo and pr_number_str and github_token and head_sha:
        post_github_review(
            repo=repo,
            pr_number=int(pr_number_str),
            github_token=github_token,
            commit_id=head_sha,
            body=full_body,
            inline_comments=valid_inline_comments,
        )
    else:
        print(full_body)

    return 0


if __name__ == "__main__":
    sys.exit(main())
