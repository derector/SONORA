# SONORA Download Site

Independent static download and product landing site for SONORA.

## Local development

```bash
npm install
npm run dev
```

## Production

```bash
npm install
npm run build
npm run start
```

The page reads the latest stable Android APK release from the public GitHub Releases API. A verified v0.1.178 fallback is included for temporary API outages. The web listening app remains a separate product surface.
