package app.sonora.android.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/** One tab of the bottom navigation: stable route key, short caption, icon. */
data class NavTab(val key: String, val label: String, val icon: ImageVector)

/**
 * Route keys stay exactly what MainActivity switches on; only the captions were shortened
 * where a Russian word cannot fit a sixth of the screen ("Загрузки" → "Оффлайн").
 */
val NavTabs = listOf(
    NavTab("Главная", "Главная", Icons.Default.Home),
    NavTab("Поиск", "Поиск", Icons.Default.Search),
    NavTab("Медиатека", "Медиатека", Icons.Default.LibraryMusic),
    NavTab("Загрузки", "Оффлайн", Icons.Default.Download),
    NavTab("Настройки", "Настройки", Icons.Default.Settings),
    NavTab("Профиль", "Профиль", Icons.Default.Person),
)

private val NavLabel = Color(0xFFF1EDFF)
private val NavMuted = Color(0xFFC2BFD4)

/**
 * Bottom navigation with a glass surface and a single active indicator.
 *
 * Two defects of Material's NavigationBar with six labels are fixed here:
 *  - captions no longer wrap onto two rows. Each label is one line and the type size
 *    steps 11 → 10 → 9 sp with the label length, instead of the indicator squeezing it.
 *  - the indicator is painted *under* the content, not inside the item layout (Material
 *    put it in the icon slot, which is what crushed the text). One compact glass pill lives
 *    in the bar's Box and animates around the selected icon + caption with a spring.
 */
@Composable
fun SonoraBottomBar(
    tabs: List<NavTab>,
    selectedKey: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val motion = rememberMotionEnabled()
    val density = LocalDensity.current
    val barWidthPx = remember { mutableFloatStateOf(0f) }
    val labelSizes = remember { mutableStateMapOf<Int, IntSize>() }
    val selectedIndex = tabs.indexOfFirst { it.key == selectedKey }

    // The player is a full-screen route with no tab highlighted: the pill stays where it
    // was instead of sliding to column zero and fading out mid-flight.
    var lastIndex by remember { mutableStateOf(0) }
    LaunchedEffect(selectedIndex) { if (selectedIndex >= 0) lastIndex = selectedIndex }
    val pillIndex = if (selectedIndex >= 0) selectedIndex else lastIndex

    val iconBoxPx = with(density) { 24.dp.toPx() }
    val gapPx = with(density) { 4.dp.toPx() }
    val topPx = with(density) { 10.dp.toPx() }
    val padXPx = with(density) { 10.dp.toPx() }
    val padYPx = with(density) { 5.dp.toPx() }

    val cellPx = barWidthPx.value / tabs.size.coerceAtLeast(1)
    val measured = labelSizes[pillIndex]
    val labelW = measured?.width?.toFloat() ?: with(density) { 30.dp.toPx() }
    val labelH = measured?.height?.toFloat() ?: with(density) { 13.dp.toPx() }

    val spec = if (motion) {
        spring<Float>(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow)
    } else {
        snap()
    }
    val cx by animateFloatAsState(
        if (cellPx > 0f) cellPx * (pillIndex + 0.5f) else 0f, spec, label = "pill-cx"
    )
    // The glass wraps the complete selected tab, not just the label row.
    val contentHeightPx = iconBoxPx + gapPx + labelH
    val cy by animateFloatAsState(topPx + contentHeightPx / 2f, spec, label = "pill-cy")
    val widthPx by animateFloatAsState(
        (labelW + padXPx * 2f).coerceAtMost((cellPx - 4f).coerceAtLeast(1f)),
        spec,
        label = "pill-width"
    )
    val heightPx by animateFloatAsState(contentHeightPx + padYPx * 2f, spec, label = "pill-height")
    val pillAlpha by animateFloatAsState(
        if (barWidthPx.value > 0f && measured != null) 1f else 0f,
        if (motion) tween(180) else snap(),
        label = "pill-alpha"
    )

    Box(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 4.dp)
            .height(72.dp)
            .sonoraGlass(RoundedCornerShape(28.dp))
            .onSizeChanged { barWidthPx.value = it.width.toFloat() }
    ) {
        // First child, therefore painted behind the row.
        Box(
            Modifier
                .offset {
                    IntOffset(
                        (cx - widthPx / 2f).roundToInt(),
                        (cy - heightPx / 2f).roundToInt()
                    )
                }
                // widthPx/heightPx are measured in physical pixels; converting them back to
                // dp avoids the density multiplication that made the old pill span multiple tabs.
                .size(
                    width = with(density) { widthPx.toDp() },
                    height = with(density) { heightPx.toDp() }
                )
                .alpha(pillAlpha)
                .sonoraGlass(RoundedCornerShape(percent = 50), GlassTone.Accent)
        )

        Row(
            Modifier
                .fillMaxWidth()
                .selectableGroup()
                .padding(top = 10.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            tabs.forEachIndexed { index, tab ->
                val active = index == selectedIndex
                val iconColor by animateColorAsState(
                    if (active) Color(0xFFE7DFFF) else NavMuted,
                    if (motion) tween(180) else snap(),
                    label = "tab-icon-color"
                )
                val textColor by animateColorAsState(
                    if (active) NavLabel else NavMuted,
                    if (motion) tween(180) else snap(),
                    label = "tab-text-color"
                )
                Column(
                    Modifier
                        .weight(1f)
                        .heightIn(min = 48.dp)
                        .selectable(
                            selected = active,
                            interactionSource = null,
                            indication = null,
                            role = Role.Tab,
                            onClick = { onSelect(tab.key) }
                        ),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                        Icon(
                            tab.icon,
                            contentDescription = null,
                            modifier = Modifier.size(22.dp),
                            tint = iconColor
                        )
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = tab.label,
                        color = textColor,
                        fontSize = when {
                            tab.label.length <= 6 -> 11.sp
                            tab.label.length <= 8 -> 10.sp
                            else -> 9.sp
                        },
                        fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                        maxLines = 1,
                        softWrap = false,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.onGloballyPositioned { labelSizes[index] = it.size }
                    )
                }
            }
        }
    }
}
