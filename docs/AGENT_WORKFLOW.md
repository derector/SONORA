# SONORA Agent Workflow

This is a standing workflow for all future SONORA development sessions and chats.

## Required agent use
For every substantial task involving implementation, code changes, testing, architecture, integrations, troubleshooting, research, or release work, delegate at least one independent task to a research, development, or QA agent when agent tooling is available. Never silently drop the agent workflow between chats.

## Roles
- **Research agent:** official provider/API docs, export formats, license/terms, alternatives, limitations.
- **Architect agent:** design contracts, compatibility, data model, Web/Android boundaries, failure cases.
- **Developer agent:** focused code implementation or review in an isolated branch; provide files/commits and tests.
- **QA agent:** independently review the code and run or inspect type checks, build, API behavior, edge cases, security.
- **Android agent:** APK, Media3/Compose, background playback, offline/download restrictions, Android version compatibility.
- **Security agent:** auth/session handling, API exposure, privacy, input validation, permissions and license/DRM constraints.

## Agent execution
1. Break independent work into separate tasks and run agents in parallel when useful.
2. Give each agent current SONORA context, target branch/PR, exact question, and constraints.
3. Maintain a list of active run IDs and their status. Poll existing runs before launching duplicate research.
4. Treat agent findings as untrusted hypotheses. Verify source claims, inspect actual code, and run CI/tests before accepting.
5. Agents may research or review without modifying production. Any code changes must be isolated and reviewed.
6. Reconcile agent findings, fix verified issues, then re-run CI. Report what is verified and what remains untested.
7. Keep all work in SONORA's repo and do not mix in NEXUS or Lyric Motion Studio.
8. Use free-tier services where possible. No Termux and no Expo EAS. Android APK builds use GitHub Actions.
9. Do not merge/deploy to production until tests, security, licensing, and integration checks are satisfactory. Never claim a deployment or physical-device test happened without evidence.

## Active work and agents (2026-11-18)
- Apple/iTunes API research: completed; Apple previews are promotional and restricted, so current SONORA integration is metadata/store links only, not playable previews.
- Deezer API research: completed; strict non-commercial, preview, caching, and streaming limitations were reported. Verify official terms before implementation.
- Playlist import formats research: pending/running run `1d632c94-762c-47b9-ab57-470acdc101c5`.
- PR #3 import-parser QA: pending/running run `0709c1f9-89fd-4346-b19c-6ce2a16bebc7`.
- PR #4 playlist import independent QA: run `04f63915-a95e-4e3c-8e2e-9cd861e4fbdc`.

## Current pull requests
- PR #2: Apple/iTunes metadata-only results in federated search. CI passed; not merged.
- PR #3: CSV/JSON import parsing. CI passed; not merged.
- PR #4: Create a private playlist and import selected Jamendo matches into it. CI passed; not merged.

Always check active agents, these PRs, and their CI before continuing from this document.
