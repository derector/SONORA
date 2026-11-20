# SONORA Android interface refresh

## Visual direction
- Deep graphite canvas (#080910) with layered ink surfaces (#141522).
- Lavender primary action (#C4B5FD) and cool cyan highlights.
- Rounded, touch-first controls with clear active and inactive navigation states.
- The discovery hero is a real shortcut to Search, not a decorative or inert control.

## Reference patterns
- Spotify: compact library navigation and persistent now-playing controls.
- Yandex Music: discovery entry points, curated mood-oriented presentation, and clear separation between discovery and collection.
- SONORA keeps its own visual identity, labels, legal provider attribution, and playback architecture.

## Automated release verification

### Current release: run #141
- GitHub Actions workflow run #141 completed successfully on commit `405a52b628b8e192f7655c17ae25c106838abfef`.
- Versioned release APK artifact: `SONORA-Android-release` (artifact ID `14580421456`).
- APK SHA-256: `31c4617f76d2a4c084821105b9e6a2e444fa59e761d783ccf1cf5289cde57a23`.
- Both `Build versioned APK` and `Upload stable-signed release APK` completed successfully.
- The APK artifact was downloaded and its SHA-256 independently checked. Physical-device installation, update compatibility, and playback remain untested.

### Previous signing-certificate verification: run #138
- Versioned release APK artifact: `SONORA-Android-release` (artifact ID `14578981138`).
- APK SHA-256: `3d22352449724580bf69a55f3d76ac63a02f2f24f3899f6f02532c105933fddb`.
- APK v2 signing certificate SHA-256 fingerprint: `23:CB:9F:56:B3:A5:FC:AA:CE:AD:DB:9B:20:08:D0:97:13:8D:FB:C2:75:32:7C:B8:0A:84:CB:02:3B:26:54:2A`.
- This earlier artifact's fingerprint matched the persistent SONORA release certificate. The run #141 artifact was produced by the stable-signed release workflow, but its certificate fingerprint has not been independently extracted in this verification pass.

## Device QA checklist
- [ ] Install as an in-place update over the existing SONORA app without losing app data.
- [ ] Verify home hero opens Search.
- [ ] Switch Audius/Jamendo and confirm catalog reloads.
- [ ] Play, pause, skip, seek and restore queue.
- [ ] Confirm mini-player does not cover navigation or content on small screens.
- [ ] Check empty, loading and provider-error states.
- [ ] Confirm registration and existing-account login remain usable.
- [ ] Confirm dark surfaces, contrast and touch targets on a physical Android device.
