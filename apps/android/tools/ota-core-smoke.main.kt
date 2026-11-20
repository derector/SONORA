/*
 * Standalone smoke checks for OtaCore (app/src/main/java/app/sonora/android/ota/OtaCore.kt).
 *
 * The module has no JVM test infrastructure yet, so these assertions run on a plain JVM
 * instead of JUnit: OtaCore deliberately has no Android or JSON dependency, which is what
 * makes it compilable and runnable without a device.
 *
 *   kotlinc -cp <kotlin-stdlib> -d out OtaCore.kt tools/ota-core-smoke.main.kt
 *   java    -cp out:<kotlin-stdlib> app.sonora.android.ota.OtaSmokeKt
 *
 * The Gradle build ignores this file (it is outside src/main/java), and
 * tools/verify-kotlin-frontend.sh shows the classpath such a check needs. Delete it once a
 * real test source set exists and these checks have moved into it.
 */
package app.sonora.android.ota

fun main() {
    val currentName = "0.1.156"; val currentCode = 156
    check(parseVersion("v0.1.156") == listOf(0, 1, 156)) { "tag parse" }
    check(parseVersion("0.1") == listOf(0, 1, 0)) { "short parse" }
    check(parseVersion("0.1.157-rc1") == listOf(0, 1, 157)) { "suffix parse" }
    check(parseVersion("nightly") == null) { "junk parse" }
    // The CI mapping pitfall: packed 0.1.156 (256) must NOT be compared with code 156.
    check(versionCodeEquivalent(listOf(0, 1, 156)) == 256) { "packed form" }
    check(isNewerVersion("v0.1.157", currentName, currentCode)) { "patch bump is newer" }
    check(!isNewerVersion("v0.1.156", currentName, currentCode)) { "same tag is not newer" }
    check(!isNewerVersion("v0.1.155", currentName, currentCode)) { "older tag is not newer" }
    check(isNewerVersion("v0.2.0", currentName, currentCode)) { "minor bump is newer" }
    check(isNewerVersion("v0.0.999", currentName, currentCode) == false) { "zero major guard" }
    check(isNewerVersion("v1.0.0", "0.99.99", 9999)) { "major upgrade is newer" }
    check(!isNewerVersion("v0.1.156", "0.99.99", 9999)) { "never downgrade" }
    check(isNewerVersion(null, currentName, currentCode) == false) { "null tag" }
    check(currentVersion("garbage", 156) == listOf(0, 1, 156)) { "fallback follows CI scheme" }
    val assets = listOf(
        ReleaseAsset("app-release.apk", "https://gh/a.apk", 10L),
        ReleaseAsset(PREFERRED_ASSET_NAME, "https://gh/SONORA-latest.apk", 20L)
    )
    check(selectApkAsset(assets)?.name == PREFERRED_ASSET_NAME) { "preferred asset" }
    check(selectApkAsset(listOf(assets[0]))?.url == "https://gh/a.apk") { "fallback asset" }
    check(selectApkAsset(listOf(ReleaseAsset("notes.txt", "https://gh/n.txt", 1L))) == null) { "no apk" }
    val rel = ReleaseInfo("v0.1.157", parseVersion("v0.1.157"), "SONORA for Android 0.1.157",
        "## Что нового\n\n- **исправлено** воспроизведение\n", "2026-11-20T00:02:39Z", assets)
    check(rel.versionLabel == "0.1.157") { "label" }
    check(rel.apkSizeLabel == "20 Б") { rel.apkSizeLabel }
    check(rel.isNewerThan(currentName, currentCode)) { "release is newer" }
    val notes = chopNotes((1..80).joinToString(" ") { "item$it" })
    check(notes.length <= NOTES_LIMIT + 1 && notes.endsWith("…")) { "notes clipped: ${notes.length}" }
    check(chopNotes(null) == "") { "null notes" }
    check(formatBytes(45L * 1024 * 1024) == "45,0 МБ") { formatBytes(45L * 1024 * 1024) }
    check(formatBytes(0L) == "размер неизвестен") { "zero size" }
    check(formatPublishedAt("2026-11-20T00:02:39Z") == "20.11.2026") { "date" }
    println("OtaCore smoke: all ${23} checks passed (current=$currentName/$currentCode)")
}
