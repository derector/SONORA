package app.sonora.android.ota

/**
 * Release bookkeeping for SONORA's in-app updates.
 *
 * Everything in this file is deliberately plain Kotlin: no Android types, no JSON library,
 * no network. The Android layer (GithubReleases, OtaStore, the workers) extracts primitive
 * strings and numbers out of the GitHub answer and hands them to these functions, so the
 * whole "is this release actually newer, and what should the UI say about it" decision can
 * be unit tested on the JVM as soon as the module gets test infrastructure.
 */

/** The asset name the APK workflow publishes; anything ending in .apk is still accepted. */
const val PREFERRED_ASSET_NAME = "SONORA-latest.apk"

/** Release notes are shown in a bottom sheet, so the body is clipped to this length. */
const val NOTES_LIMIT = 300

/** One file attached to a GitHub release, reduced to what the update flow needs. */
data class ReleaseAsset(
    val name: String,
    val url: String,
    val size: Long
)

/**
 * A published release.
 *
 * @param version the parsed [major, minor, patch] triple, or null when the tag is not a
 * version tag at all (a hand-made `v0.1-hotfix` tag, for example). A release without a
 * parsable version is never offered, because there is nothing to compare it with.
 */
data class ReleaseInfo(
    val tagName: String,
    val version: List<Int>?,
    val title: String,
    val notes: String,
    val publishedAt: String,
    val assets: List<ReleaseAsset>
) {
    /** Version as the user sees it: "0.1.157", falling back to the raw tag. */
    val versionLabel: String
        get() = version?.joinToString(".") ?: tagName.removePrefix("v").removePrefix("V")

    /** The APK the update flow would download, or null when the release ships none. */
    val apk: ReleaseAsset?
        get() = selectApkAsset(assets)

    /**
     * True when this release is newer than the running build. See [isNewerVersion] for the
     * exact rule; the method exists so callers carry the comparison with the release itself.
     */
    fun isNewerThan(currentVersionName: String?, currentVersionCode: Int): Boolean =
        isNewerVersion(tagName, currentVersionName, currentVersionCode)

    /** Human-readable size of the APK, or an honest "unknown" when GitHub says nothing. */
    val apkSizeLabel: String
        get() = apk?.let { formatBytes(it.size) } ?: "размер неизвестен"
}

/**
 * Parses "v0.1.156", "0.1.156", "0.1" or "0.1.156-rc1" into a triple of numbers.
 * Returns null when the string carries no leading numeric version at all.
 */
fun parseVersion(raw: String?): List<Int>? {
    val trimmed = raw?.trim()?.removePrefix("v")?.removePrefix("V").orEmpty()
    if (trimmed.isEmpty()) return null
    val parts = trimmed.split('.')
    val version = ArrayList<Int>(3)
    for (index in parts.indices.take(3)) {
        // A component may carry a suffix ("156-rc1", "156+build7"): keep its digits only.
        val digits = parts[index].takeWhile { it.isAsciiDigit() }
        if (digits.isEmpty()) return null
        val value = digits.toIntOrNull() ?: return null
        version += value
    }
    while (version.size < 3) version += 0
    return version
}

/**
 * The single-integer form of a version triple: major * 10000 + minor * 100 + patch.
 *
 * Used as a display and ordering aid only. It is intentionally NOT compared against
 * BuildConfig.VERSION_CODE, because the APK workflow builds every release with
 * `-PsonoraVersionCode=$GITHUB_RUN_NUMBER -PsonoraVersionName=0.1.$GITHUB_RUN_NUMBER`:
 * for tag v0.1.156 the installed versionCode is 156 while the packed form is 256, and a
 * packed-vs-bare comparison would call every release newer than the installed one.
 */
fun versionCodeEquivalent(version: List<Int>?): Int? {
    val triple = version ?: return null
    if (triple.size < 3) return null
    return triple[0] * 10000 + triple[1] * 100 + triple[2]
}

/**
 * The version triple of the running build.
 *
 * The version name is authoritative; the version code is only a fallback for builds whose
 * version name was left at a non-version default, and follows the CI mapping documented on
 * [versionCodeEquivalent] (a bare run number is the patch of 0.1.x).
 */
fun currentVersion(currentVersionName: String?, currentVersionCode: Int): List<Int> =
    parseVersion(currentVersionName) ?: listOf(0, 1, currentVersionCode)

/** Lexicographic comparison of two version triples, shorter lists padded with zeros. */
fun compareVersions(left: List<Int>, right: List<Int>): Int {
    val size = maxOf(left.size, right.size)
    for (index in 0 until size) {
        val result = left.getOrElse(index) { 0 }.compareTo(right.getOrElse(index) { 0 })
        if (result != 0) return result
    }
    return 0
}

/**
 * True when [remoteTag] names a version newer than the running build, i.e. when the parsed
 * remote tuple is strictly greater than the parsed current tuple. An unparsable remote tag
 * is never "newer": a release the app cannot order is a release it must not install.
 */
fun isNewerVersion(remoteTag: String?, currentVersionName: String?, currentVersionCode: Int): Boolean {
    val remote = parseVersion(remoteTag) ?: return false
    return compareVersions(remote, currentVersion(currentVersionName, currentVersionCode)) > 0
}

/**
 * Picks the APK to download: the canonical CI asset name first, then the first attached
 * file whose name ends in .apk (mirrors what the release workflow uploads).
 */
fun selectApkAsset(assets: List<ReleaseAsset>, preferredName: String = PREFERRED_ASSET_NAME): ReleaseAsset? {
    val named = assets.firstOrNull { it.name.equals(preferredName, ignoreCase = true) }
    if (named != null) return named
    return assets.firstOrNull { it.name.substringAfterLast('/').endsWith(".apk", ignoreCase = true) }
}

/**
 * Release notes for the sheet: markdown noise removed, whitespace collapsed, clipped at
 * [limit] characters on a word boundary with an ellipsis.
 */
fun chopNotes(notes: String?, limit: Int = NOTES_LIMIT): String {
    val cleaned = notes.orEmpty()
        // GitHub release bodies sometimes contain escaped newline characters literally.
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n")
        .replace("\r\n", "\n")
        .split('\n')
        .joinToString(" ") { line ->
            line.trim()
                .removePrefix("#").trim()
                .removePrefix("*").trim()
                .removePrefix("-").trim()
                .replace("**", "")
                .replace("__", "")
                .replace("`", "")
        }
        .replace(Regex("\\s+"), " ")
        .trim()
    if (cleaned.length <= limit) return cleaned
    val head = cleaned.substring(0, limit)
    val cut = head.lastIndexOf(' ')
    return (if (cut > limit / 2) head.substring(0, cut) else head).trimEnd() + "…"
}

/** Bytes to a Russian-friendly label: "45,2 МБ", "812 КБ", "1,0 ГБ". */
fun formatBytes(bytes: Long): String {
    if (bytes <= 0L) return "размер неизвестен"
    val units = listOf("Б", "КБ", "МБ", "ГБ")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024.0 && unit < units.lastIndex) {
        value /= 1024.0
        unit++
    }
    if (unit == 0) return "${value.toLong()} ${units[unit]}"
    val tenths = (value * 10 + 0.5).toLong()
    return "${tenths / 10},${tenths % 10} ${units[unit]}"
}

/**
 * "2026-11-20T00:02:39Z" -> "20.11.2026"; anything unrecognised is returned as-is so the
 * sheet never shows an empty date.
 */
fun formatPublishedAt(publishedAt: String?): String {
    val raw = publishedAt.orEmpty()
    val date = raw.substringBefore('T')
    val parts = date.split('-')
    return if (parts.size == 3 && parts.all { it.length == 2 || it.length == 4 } && parts.all { part -> part.isNotEmpty() && part.all { digit -> digit.isAsciiDigit() } }) {
        "${parts[2]}.${parts[1]}.${parts[0]}"
    } else {
        raw
    }
}

private fun Char.isAsciiDigit(): Boolean = this in '0'..'9'
