package app.sonora.android.ui

import android.graphics.Bitmap
import android.graphics.drawable.BitmapDrawable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.ColorUtils
import coil.compose.AsyncImage
import coil.request.ImageRequest

/** Derive one readable accent from a small sample of the artwork. Very dark,
 * grey or unusually bright pixels do not dominate the hue estimate. */
private fun artworkAccent(image: Bitmap): Color? {
    val sample = Bitmap.createScaledBitmap(image, 24, 24, true)
    val pixels = IntArray(24 * 24)
    sample.getPixels(pixels, 0, 24, 0, 0, 24, 24)
    if (sample !== image) sample.recycle()
    val buckets = FloatArray(18)
    val hsl = FloatArray(3)
    for (pixel in pixels) {
        if ((pixel ushr 24) < 200) continue
        ColorUtils.colorToHSL(pixel, hsl)
        if (hsl[1] < 0.25f || hsl[2] !in 0.18f..0.82f) continue
        val bucket = (hsl[0] / 20f).toInt().coerceIn(buckets.indices)
        buckets[bucket] += hsl[1]
    }
    val peak = buckets.indices.maxByOrNull { buckets[it] } ?: return null
    if (buckets[peak] < 4f) return null
    return Color(ColorUtils.HSLToColor(floatArrayOf(peak * 20f + 10f, 0.70f, 0.71f)))
}

@Composable
internal fun PlayerArtwork(
    artworkUrl: String?,
    vinyl: Boolean,
    playing: Boolean,
    accent: Color,
    onAccent: (Color?) -> Unit
) {
    val context = LocalContext.current
    val hasMotion = MotionSettings.enabled && playing
    val rotation = if (vinyl && hasMotion) {
        val transition = rememberInfiniteTransition(label = "vinyl-rotation")
        val angle by transition.animateFloat(
            initialValue = 0f, targetValue = 360f,
            animationSpec = infiniteRepeatable(tween(6200, easing = LinearEasing)),
            label = "vinyl-angle"
        )
        angle
    } else 0f
    val request = remember(context, artworkUrl) {
        ImageRequest.Builder(context).data(artworkUrl).allowHardware(false).build()
    }
    val shape = if (vinyl) CircleShape else RoundedCornerShape(26.dp)
    Box(
        Modifier.widthIn(max = 360.dp).fillMaxWidth().aspectRatio(1f)
            .sonoraGlass(shape, GlassTone.Accent).padding(9.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(
            Modifier.fillMaxSize().clip(shape).background(
                Brush.linearGradient(listOf(accent.copy(alpha = 0.45f), Color(0xFF131123), Color(0xFF09131D)))
            ),
            contentAlignment = Alignment.Center
        ) {
            if (vinyl) {
                Canvas(Modifier.fillMaxSize()) {
                    val radius = size.minDimension / 2f
                    drawCircle(Color(0xFF10101A), radius)
                    for (ring in 1..18) {
                        drawCircle(
                            color = if (ring % 3 == 0) accent.copy(alpha = 0.26f) else Color.White.copy(alpha = 0.10f),
                            radius = radius * (0.59f + ring * 0.021f),
                            style = androidx.compose.ui.graphics.drawscope.Stroke(width = 0.8.dp.toPx())
                        )
                    }
                }
            }
            val cover = if (vinyl) Modifier.fillMaxSize(0.54f).graphicsLayer { rotationZ = rotation }.clip(CircleShape)
                else Modifier.fillMaxSize().clip(RoundedCornerShape(20.dp))
            Icon(Icons.Default.GraphicEq, null, tint = accent, modifier = Modifier.size(51.dp))
            AsyncImage(
                model = request, contentDescription = null, modifier = cover, contentScale = ContentScale.Crop,
                onSuccess = { result ->
                    val image = (result.result.drawable as? BitmapDrawable)?.bitmap
                    onAccent(image?.let { runCatching { artworkAccent(it) }.getOrNull() })
                },
                onError = { onAccent(null) }
            )
            if (vinyl) Box(Modifier.size(10.dp).clip(CircleShape).background(Color(0xFF10101A)))
        }
    }
}
