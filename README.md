# Smart Tab Manager

A Chrome Manifest V3 extension for people who end up with 100 tabs.

## Features

- AI-style local grouping by topic, domain, and page signals.
- Duplicate tab detection with one-click cleanup.
- Memory dashboard with system memory pressure and tab sleep controls.
- Auto-close or auto-discard for inactive tabs.
- Custom session saving, restoring, exporting, and importing.
- Natural-language tab search such as `github duplicates`, `heavy inactive 2 hours`, or `shopping pinned`.

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `Smart-Tab-Manager`.

## Notes

- Grouping and natural-language search run locally in the extension. No API key or cloud service is required.
- Stable Chrome exposes system memory to extensions, not reliable per-tab memory. The popup still helps identify memory pressure and discard tabs.
- Auto-close is disabled by default. Enable it from the options page after choosing your threshold.

## Files

- `manifest.json` - Chrome extension manifest.
- `background.js` - tab grouping, duplicate cleanup, sessions, memory, and automation.
- `popup.html`, `popup.css`, `popup.js` - extension popup.
- `options.html`, `options.css`, `options.js` - settings and import/export.
- `assets/icons` - extension icons.
