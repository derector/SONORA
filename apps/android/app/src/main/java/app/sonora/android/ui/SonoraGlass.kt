package app.sonora.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp

internal val GlassBackdrop = Brush.verticalGradient(
    0f to Color(0xFF231C39),
    0.34f to Color(0xFF111524),
    0.72f to Color(0xFF090B13),
    1f to Color(0xFF101F29)
)

internal enum class GlassTone {
    Panel, Accent, Primary
}

private val PanelGlass = Brush.linearGradient(
    0f to Color(0xB7554D70),
    0.38f to Color(0xE6212239),
    0.73f to Color(0xEB121B2B),
    1f to Color(0xAF27515C)
)
private val AccentGlass = Brush.linearGradient(
    0f to Color(0xFF716A9F),
    0.28f to Color(0xF4534778),
    0.63f to Color(0xF22F3552),
    1f to Color(0xEA32616D)
)
private val PrimaryGlass = Brush.linearGradient(
    0f to Color(0xFFFFFFFF),
    0.32f to Color(0xFFE2DBFF),
    0.67f to Color(0xFFBEABFA),
    1f to Color(0xFF8AE0E6)
)
private val Reflection = Brush.verticalGradient(
    0f to Color(0x24FFFFFF),
    0.34f to Color(0x00FFFFFF),
    0.81f to Color(0x0010142E),
    1f to Color(0x39466D8B)
)
private val Rim = Brush.linearGradient(
    0f to Color(0xA0FFFFFF),
    0.33f to Color(0x309BA9E8),
    0.67f to Color(0x247B8BD0),
    1f to Color(0x90A1E6ED)
)

/** Cached brushes provide a translucent base, a reflection and a thin rim on all supported Android versions. */
internal fun Modifier.sonoraGlass(
    shape: Shape = RoundedCornerShape(24.dp),
    tone: GlassTone = GlassTone.Panel
): Modifier = clip(shape)
    .background(
        when (tone) {
            GlassTone.Panel -> PanelGlass
            GlassTone.Accent -> AccentGlass
            GlassTone.Primary -> PrimaryGlass
        }
    )
    .background(Reflection)
    .border(1.dp, Rim, shape)
