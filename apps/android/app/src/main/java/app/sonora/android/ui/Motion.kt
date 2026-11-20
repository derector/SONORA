package app.sonora.android.ui

import android.content.Context
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutLinearInEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

// ── Brand tokens for the motion layer ───────────────────────────────────────────────
val Violet = Color(0xFFA78BFA)
val Blue = Color(0xFF60A5FA)
val Teal = Color(0xFF2DD4BF)

/** 20% violet press feedback, as used by the track-row ripple. */
val RippleViolet = Color(0x33A78BFA)

/** One restrained overshoot curve for entries, shared by screens and rails. */
val EaseOutBrand = CubicBezierEasing(0.2f, 0.7f, 0.2f, 1f)

/** 40 ms between the first rows of a list; capped so a long rail never feels laggy. */
const val StaggerStepMillis = 40
const val StaggerMaxSteps = 6

/**
 * Motion is on unless the user or the system says otherwise.
 *
 * Two independent switches are honoured: the system animation scales
 * (Settings.Global *Animation_Scale = 0, and reduce-motion on Android 10+) make every
 * decorative effect here cut instantly, and the in-app switch in
 * Настройки → Внешний вид lets a user opt out without touching developer options.
 */
object MotionSettings {
    var userEnabled by mutableStateOf(true)
        private set

    @Volatile
    private var systemAllowed = true

    fun load(context: Context) {
        systemAllowed = systemMotionAllowed(context)
        userEnabled = SonoraPrefs.bool(context, SonoraPrefs.MOTION_ENABLED, true)
    }

    fun setEnabled(context: Context, value: Boolean) {
        userEnabled = value
        SonoraPrefs.setBool(context, SonoraPrefs.MOTION_ENABLED, value)
    }

    val enabled: Boolean get() = userEnabled && systemAllowed

    /** Duration helper: 0 ms whenever motion is off, so callers can pass it straight to tween(). */
    fun duration(millis: Int): Int = if (enabled) millis else 0
}

fun systemMotionAllowed(context: Context): Boolean {
    val resolver = context.contentResolver
    val scales = floatArrayOf(
        Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f),
        Settings.Global.getFloat(resolver, Settings.Global.TRANSITION_ANIMATION_SCALE, 1f),
        Settings.Global.getFloat(resolver, Settings.Global.WINDOW_ANIMATION_SCALE, 1f)
    )
    if (scales.any { it <= 0f }) return false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val manager = context.getSystemService(AccessibilityManager::class.java)
        // Queried reflectively: the synthetic property is missing from some compile stubs,
        // while the platform method has existed since API 29, which this branch already guards.
        val reduce = runCatching {
            AccessibilityManager::class.java.getMethod("isReduceMotionEnabled").invoke(manager) as? Boolean
        }.getOrDefault(false)
        if (manager != null && reduce == true) return false
    }
    return true
}

/** True while motion is allowed. Reads observable state, so screens re-compose on the switch. */
@Composable
fun rememberMotionEnabled(): Boolean {
    val context = LocalContext.current
    LaunchedEffect(context) { MotionSettings.load(context) }
    return MotionSettings.enabled
}

// Press feedback is left to Material 3's own ripple: it takes colour and alpha from the
// row's contentColor, which is already brand violet wherever SONORA tints a control. The
// fixed-colour rememberRipple() that would allow supplying 20% violet at CompositionLocal
// level is deprecated at ERROR level in this Compose version, so an exact hand-set ripple
// colour needs the newer createRippleNode API — tracked as follow-up, not faked here.


/**
 * Entry animation for the first rows of a list or rail: fade in while rising 12dp,
 * each row starting [StaggerStepMillis] after the previous one (capped, so row 12 is
 * not waiting half a second). Skipped completely when animations are off.
 */
@Composable
fun Modifier.staggerEnter(index: Int): Modifier {
    val motion = rememberMotionEnabled()
    val visible = remember(index) { mutableStateOf(!motion) }
    LaunchedEffect(index, motion) { if (motion) visible.value = true }
    val delay = if (motion) index.coerceAtMost(StaggerMaxSteps) * StaggerStepMillis else 0
    val alphaValue by animateFloatAsState(
        targetValue = if (visible.value) 1f else 0f,
        animationSpec = if (motion) tween(280, delayMillis = delay, easing = EaseOutBrand) else snap(),
        label = "stagger-alpha"
    )
    val rise by animateFloatAsState(
        targetValue = if (visible.value) 0f else 1f,
        animationSpec = if (motion) tween(320, delayMillis = delay, easing = EaseOutBrand) else snap(),
        label = "stagger-rise"
    )
    val risePx = with(LocalDensity.current) { 12.dp.toPx() }
    return this
        .then(Modifier.alpha(alphaValue))
        .then(Modifier.graphicsLayer { translationY = rise * risePx })
}

/**
 * Keyframe pop for the like button: 1 → 1.25 → 1 on every state change of [trigger]
 * (pass a counter or the new value, the very first composition never pops).
 */
@Composable
fun Modifier.popOn(trigger: Any?, peak: Float = 1.25f): Modifier {
    val motion = rememberMotionEnabled()
    val scale = remember { Animatable(1f) }
    var primed by remember { mutableStateOf(false) }
    LaunchedEffect(trigger) {
        if (!primed) {
            primed = true
            return@LaunchedEffect
        }
        if (!motion) {
            scale.snapTo(1f)
            return@LaunchedEffect
        }
        scale.animateTo(peak, tween(110, easing = FastOutLinearInEasing))
        scale.animateTo(1f, spring(dampingRatio = 0.42f, stiffness = Spring.StiffnessMedium))
    }
    return this.then(Modifier.graphicsLayer {
        scaleX = scale.value
        scaleY = scale.value
    })
}

/**
 * Card/row press: 0.97 scale settle plus the surrounding ripple. One call replaces a
 * plain `clickable`, so press feedback cannot be forgotten on a new surface.
 */
@Composable
fun Modifier.pressScale(
    onClick: () -> Unit,
    enabled: Boolean = true,
    pressedScale: Float = 0.97f
): Modifier {
    val motion = rememberMotionEnabled()
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val callback by rememberUpdatedState(onClick)
    val scale by animateFloatAsState(
        targetValue = if (motion && pressed) pressedScale else 1f,
        animationSpec = spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow),
        label = "press-scale"
    )
    return this
        .then(Modifier.graphicsLayer {
            scaleX = scale
            scaleY = scale
        })
        .then(Modifier.clickable(
            interactionSource = interaction,
            indication = LocalIndication.current,
            enabled = enabled,
            onClick = { callback() }
        ))
}

/**
 * Play/pause control: the glyph crossfades while the whole target turns 15°, which reads
 * as "the control acknowledged the tap" without a hard cut.
 */
@Composable
fun PlayPauseIcon(
    playing: Boolean,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = 24.dp,
    tint: Color = Color.White
) {
    val motion = rememberMotionEnabled()
    val spin = remember { Animatable(0f) }
    LaunchedEffect(playing) {
        if (!motion) return@LaunchedEffect
        spin.animateTo((spin.value + 15f) % 360f, tween(240, easing = EaseOutBrand))
    }
    Box(
        modifier = modifier.graphicsLayer { rotationZ = spin.value },
        contentAlignment = Alignment.Center
    ) {
        AnimatedContent(
            targetState = playing,
            transitionSpec = { fadeIn(tween(150)) togetherWith fadeOut(tween(120)) },
            contentAlignment = Alignment.Center,
            label = "playpause-glyph"
        ) { isPlaying ->
            Icon(
                if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                contentDescription = if (isPlaying) "Пауза" else "Слушать",
                modifier = Modifier.size(size),
                tint = tint
            )
        }
    }
}

/**
 * Seek bar bound to one clock with the time labels around it: the thumb grows while the
 * finger is down, the track thickens with it, and the drag position is authoritative until
 * the gesture ends — after which the real playhead takes over again.
 */
@Composable
fun SeekBar(
    positionMs: Float,
    durationMs: Float,
    enabled: Boolean,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val motion = rememberMotionEnabled()
    var dragging by remember { mutableStateOf(false) }
    var dragFraction by remember { mutableFloatStateOf(0f) }
    val density = LocalDensity.current
    val seekable = enabled && durationMs > 0f
    val target = if (durationMs > 0f) (positionMs / durationMs).coerceIn(0f, 1f) else 0f
    val settled by animateFloatAsState(
        targetValue = target,
        animationSpec = if (motion && !dragging) tween(200, easing = EaseOutBrand) else snap(),
        label = "seek-progress"
    )
    val shown = if (dragging) dragFraction else settled
    val thumbScale by animateFloatAsState(
        targetValue = if (dragging) 1.55f else 1f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = Spring.StiffnessMediumLow),
        label = "seek-thumb"
    )
    val trackHeight by animateFloatAsState(
        targetValue = if (dragging) 7f else 4f,
        animationSpec = if (motion) tween(160, easing = EaseOutBrand) else snap(),
        label = "seek-track"
    )
    val restThumbPx = with(density) { 11.dp.toPx() }
    // The offset lambda below has no PointerInputScope receiver, so the measured box is
    // kept in state instead of reading `size` there.
    var boxSize by remember { mutableStateOf(IntSize.Zero) }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(28.dp)
            .onSizeChanged { boxSize = it }
            .pointerInput(seekable, durationMs) {
                awaitEachGesture {
                    if (!seekable) return@awaitEachGesture
                    val width = size.width.coerceAtLeast(1)
                    val down = awaitFirstDown(requireUnconsumed = false)
                    dragging = true
                    dragFraction = (down.position.x / width).coerceIn(0f, 1f)
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull { it.id == down.id }
                        if (change == null) break
                        dragFraction = (change.position.x / width).coerceIn(0f, 1f)
                        change.consume()
                        if (!change.pressed) break
                    }
                    dragging = false
                    onSeek(dragFraction * durationMs)
                }
            },
        contentAlignment = Alignment.CenterStart
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(trackHeight.dp)
                .clip(CircleShape)
                .background(Color(0xFF3A3B52))
        )
        Box(
            Modifier
                .fillMaxWidth(fraction = shown.coerceIn(0.001f, 1f))
                .height(trackHeight.dp)
                .clip(CircleShape)
                .background(Brush.horizontalGradient(listOf(Violet, Teal)))
        )
        Box(
            Modifier
                .offset {
                    val thumbPx = restThumbPx * thumbScale
                    IntOffset(
                        (shown * boxSize.width - thumbPx / 2f).roundToInt(),
                        ((boxSize.height - thumbPx) / 2f).roundToInt()
                    )
                }
                .size((restThumbPx * thumbScale).dp)
                .clip(CircleShape)
                .background(Color(0xFFF5F6FA))
        )
    }
}

/** Gradient brand tile used behind the splash/empty states, matching the icon artwork. */
@Composable
fun BrandGlow(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(Color(0xFF1A1730), Color(0xFF0A0A0F))))
    )
}
