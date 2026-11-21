package app.sonora.android.ota

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OtaCoreTest {
    @Test
    fun parsesStableAndPrefixedVersionTags() {
        assertEquals(listOf(0, 1, 200), parseVersion("v0.1.200"))
        assertEquals(listOf(0, 1, 200), parseVersion("0.1.200"))
        assertEquals(listOf(0, 1, 0), parseVersion("0.1"))
        assertEquals(listOf(0, 1, 200), parseVersion("v0.1.200-rc1"))
        assertNull(parseVersion("release-latest"))
    }

    @Test
    fun comparesReleaseAgainstInstalledVersionNameNotPackedVersionCode() {
        assertTrue(isNewerVersion("v0.1.200", "0.1.179", 179))
        assertFalse(isNewerVersion("v0.1.179", "0.1.179", 179))
        assertFalse(isNewerVersion("v0.1.178", "0.1.179", 179))
        assertFalse(isNewerVersion("latest", "0.1.179", 179))
    }

    @Test
    fun versionCodeFallbackUsesCiPatchNumber() {
        assertEquals(listOf(0, 1, 179), currentVersion(null, 179))
        assertEquals(listOf(1, 2, 3), currentVersion("1.2.3", 179))
    }

    @Test
    fun selectsCanonicalApkBeforeOtherApkAssets() {
        val generic = ReleaseAsset("app.apk", "https://example.test/app.apk", 10)
        val canonical = ReleaseAsset("SONORA-latest.apk", "https://example.test/latest.apk", 20)
        assertEquals(canonical, selectApkAsset(listOf(generic, canonical)))
        assertEquals(generic, selectApkAsset(listOf(generic)))
        assertNull(selectApkAsset(emptyList()))
    }

    @Test
    fun formatsDownloadedApkSize() {
        assertEquals("размер неизвестен", formatBytes(0))
        assertEquals("1,0 КБ", formatBytes(1024))
        assertEquals("1,0 МБ", formatBytes(1024L * 1024L))
    }
}
