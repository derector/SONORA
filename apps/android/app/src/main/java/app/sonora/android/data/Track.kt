package app.sonora.android.data

data class Track(
    val id: String,
    val providerTrackId: String,
    val provider: String,
    val title: String,
    val artist: String,
    val album: String? = null,
    val durationSeconds: Int = 0,
    val artworkUrl: String? = null,
    val audioUrl: String? = null,
    val downloadUrl: String? = null,
    val licenseUrl: String? = null,
    val sourceUrl: String? = null,
    val playable: Boolean = false
) {
    val canonicalKey: String
        get() = "${provider.trim().lowercase()}:$providerTrackId"
}
