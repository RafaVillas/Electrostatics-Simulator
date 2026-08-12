---
name: autocommit
description: Group and commit staged changes by domain. Use when the user says /autocommit or asks to commit the current changes.
---

# Autocommit

Group uncommitted changes into semantic commits by domain. Not too atomic, not a single dump — each commit should represent a coherent unit of work.

## Process

1. Run `git status` and `git diff --stat` to see all changed files.
2. Group files by domain based on their path and purpose:
   - `types/` — type definitions
   - `services/` + `services/mock/` — services and mock data
   - `composables/` — composables / hooks
   - `components/<folder>/` — components grouped by subfolder (e.g. `components/post/`, `components/comment/`, `components/layout/`)
   - `pages/<folder>/` — pages grouped by route area
   - `layouts/` — layouts
   - `utils/` — utilities
   - `assets/` — styles and static assets
   - Config files (`nuxt.config.ts`, `tsconfig.json`, etc.) — config
   - If multiple small domains are closely related, combine them into one commit.
3. For each group, create one commit with a semantic message in English:
   - Use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`
   - Keep messages concise (under 72 chars)
   - Describe WHAT was added/changed, not HOW
   - Examples: `feat(types): add domain models for posts, comments, and profiles`, `feat(services): add mock services for posts, courses, and chat`
4. Stage only the files for that group with `git add <specific files>`, then commit.
5. Do NOT add a co-author line.
6. Do NOT push to remote.
7. After all commits, show a summary of what was committed.

## Rules

- Never commit `.env`, credentials, or secrets.
- Never use `git add -A` or `git add .` — always add specific files.
- If unsure about grouping, prefer fewer, larger commits over many tiny ones.
- Skip files that look like they shouldn't be committed (build artifacts, temp files).
