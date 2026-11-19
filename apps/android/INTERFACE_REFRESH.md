# SONORA Android interface refresh

## Visual direction
- Deep graphite canvas (#080910) with layered ink surfaces (#141522).
- Lavender primary action (#C4B5FD) and cool cyan highlights.
- Rounded, touch-first controls with clear active and inactive navigation states.
- The discovery hero is a real shortcut to Search, not a decorative or inert control.

## Reference patterns
- Spotify: compact library navigation and persistent now-playing controls.
- Yandex Music: discovery entry points, curated mood-oriented presentation, and clear separation between discovery and collection.
- SONORA keeps its own palette, labels, legal provider attribution, and playback architecture.

## QA checklist
- [ ] Verify home hero opens Search.
- [ ] Switch Audius/Jamendo and confirm catalog reloads.
- [ ] Play, pause, skip, seek and restore queue.
- [ ] Confirm mini-player does not cover navigation or content on small screens.
- [ ] Check empty, loading and provider-error states.
- [ ] Confirm registration and existing-account login remain usable.
- [ ] Confirm dark surfaces, contrast and touch targets on a physical Android device.