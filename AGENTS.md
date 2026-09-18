# AGENTS.md

## Project Identity

This project is **Watchflow**, a portfolio-grade YouTube discovery application for everyday viewers. Its main purpose is to help a person choose a genuinely suitable video for the time, mood, and goal they have right now.

Creator analytics may exist as a separate optional module, but it must not dominate the product, navigation, data model, or copy.

## Product Direction

- Build for ordinary YouTube viewers, not primarily for channel owners.
- Prefer intentional, finite viewing sessions over an endless recommendation feed.
- Make recommendation logic understandable through concise "why this fits" explanations.
- Let users directly edit their taste profile and give semantic rejection feedback.
- Treat saved-video overload, repetitive recommendations, clickbait, and loss of time as product problems.
- Keep the app useful in demo mode and polished enough for a portfolio review.

## YouTube Data Constraints

- Do not promise access to a user's YouTube watch history; the YouTube Data API does not expose it.
- Future personalization may use read-only subscriptions, liked videos, accessible user playlists, explicit preferences, and activity captured inside Watchflow. Watch history and Watch Later items are not available through the YouTube Data API.
- Keep YouTube API keys, OAuth client secrets, access tokens, and refresh tokens on the backend only.
- Use quota-aware requests, caching, cooldowns, and clear stale-data states.

## Technical Direction

- Frontend: React + TypeScript.
- Backend: Node.js + Express + TypeScript.
- Planned persistence: PostgreSQL.
- Google OAuth is backend-owned and should use the least powerful scopes required.
- Demo data and local visual assets must remain available without credentials.
- Keep frontend, recommendation logic, YouTube integration, persistence, and optional creator analytics separated.

## UX Guidelines

- Use a restrained dark interface with YouTube-red reserved for primary actions and selection.
- Keep navigation understandable without creator terminology.
- Preserve readable hierarchy, stable component dimensions, keyboard focus, WCAG AA contrast, and reduced-motion support.
- Always handle loading, empty, disconnected, OAuth error, quota, and no-recommendation states.
- Dynamic content must not overlap controls or cause avoidable layout jumps.

## Engineering Guidelines

- Add tests around session building, preference controls, recommendation feedback, OAuth behavior, quota handling, and API errors.
- Do not infer unavailable YouTube data or present demo recommendations as live personalization.
- Keep `.env.example` synchronized with configuration changes.
- Record important product and technical decisions in `docs/project-plan.md`.

## Documentation Language

- Write `README.md`, files under `docs/`, and other files that describe or explain the project in Polish.
- Keep this rule for future documentation updates unless the user explicitly requests a different language.
- Source-code identifiers and established technical terms may remain in English where that improves clarity.
