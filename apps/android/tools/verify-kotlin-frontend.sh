#!/bin/bash
# Front-end type check for the SONORA Android module without Gradle/aapt2.
#
# aapt2 in the cached build-tools is x86-only and this host is arm64, so a full Gradle
# build cannot run here. Instead we compile the module's Kotlin sources with
# kotlin-compiler-embeddable 2.0.21 (the version Gradle resolves) against the classpath
# Gradle already assembled in its cache: android.jar + every transformed AAR
# classes.jar + the plain-JAR dependencies. A minimal R/BuildConfig stub replaces the
# sources AGP would generate, and the Compose compiler plugin (2.0.21 embeddable,
# fetched into /home/ubuntu/toolchain/ktplugins) is loaded so @Composable code is
# checked the way the real build checks it.
#
# Usage: bash /home/ubuntu/scripts/verify-android-kotlin.sh
set -euo pipefail

ANDROID_HOME=${ANDROID_HOME:-/home/ubuntu/android-sdk}
# Resolve the repo root from this script's own location so it runs from any checkout.
WT=${WT:-$(cd "$(dirname "$0")/../../.." && pwd)}
MODULE="$WT/apps/android"
JAVA=${JAVA:-/home/ubuntu/toolchain/jdk-17-arm64/bin/java}
GC=/home/ubuntu/.gradle/caches
WORK=${WORK:-/tmp/ota-verify}
OUT="$WORK/out"
STUB="$WORK/stubs"
CP_FILE="$WORK/classpath.txt"

rm -rf "$OUT"
mkdir -p "$OUT" "$STUB/app/sonora/android" "$STUB/javac" "$WORK/tmp"

find_jar() { find "$GC/modules-2/files-2.1/$1" -name "$2" 2>/dev/null | sort | head -1; }

KC=$(find_jar org.jetbrains.kotlin/kotlin-compiler-embeddable/2.0.21 "kotlin-compiler-embeddable-2.0.21.jar")
KSTD=$(find_jar org.jetbrains.kotlin/kotlin-stdlib/2.0.21 "kotlin-stdlib-2.0.21.jar")
KREFLECT=$(find_jar org.jetbrains.kotlin/kotlin-reflect "*.jar" || true)
KSCRIPT=$(find_jar org.jetbrains.kotlin/kotlin-script-runtime "*.jar" || true)
KXCOROUTINES=$(find_jar org.jetbrains.kotlinx/kotlinx-coroutines-core-jvm "*.jar" || true)
TROVE=$(find "$GC" -name "trove4j*.jar" 2>/dev/null | head -1 || true)
COMPOSE_PLUGIN=${COMPOSE_PLUGIN_JAR:-/home/ubuntu/toolchain/ktplugins/kotlin-compose-compiler-plugin-embeddable-2.0.21.jar}
[ -f "$COMPOSE_PLUGIN" ] || COMPOSE_PLUGIN=""

# ── classpath: a superset of the real compile classpath ─────────────────────────────
{
  echo "$ANDROID_HOME/platforms/android-35/android.jar"
  echo "$KSTD"
  [ -n "$KREFLECT" ] && echo "$KREFLECT"
  find "$GC/8.9/transforms" -name "classes.jar"
  find "$GC/modules-2/files-2.1" -name "*.jar" \
    ! -name "*-sources.jar" ! -name "*-javadoc.jar" \
    ! -path "*kotlin-compiler*" ! -path "*kotlin-daemon*" ! -path "*kotlin-script*" \
    ! -path "*kotlin-ant*" ! -path "*kotlin-gradle*" ! -path "*compose-compiler-gradle*"
} | grep -v "^$" | sort -u > "$CP_FILE"

# ── generated-code stubs ────────────────────────────────────────────────────────────
cat > "$STUB/app/sonora/android/R.java" <<'EOF'
package app.sonora.android;
public final class R {
  public static final class drawable { public static final int ic_sonora = 0x7f080001; }
  public static final class xml { public static final int file_paths = 0x7f130001; }
  public static final class string { public static final int app_name = 0x7f100001; }
}
EOF
cat > "$STUB/app/sonora/android/BuildConfig.java" <<'EOF'
package app.sonora.android;
public final class BuildConfig {
  public static final boolean DEBUG = false;
  public static final String BUILD_TYPE = "release";
  public static final String LIBRARY_PACKAGE_NAME = "app.sonora.android";
  public static final int VERSION_CODE = 156;
  public static final String VERSION_NAME = "0.1.156";
  public static final String SONORA_API_URL = "https://sonora-web-api-production.up.railway.app";
}
EOF
"$(dirname "$JAVA")/javac" -nowarn -d "$STUB/javac" $(find "$STUB" -name "*.java")

# ── compile ─────────────────────────────────────────────────────────────────────────
SRCS=$(find "$MODULE/app/src/main/java" -name "*.kt")
EXTRA=${EXTRA:-}
COMPILER_CP="$KC:$KSTD"
[ -n "$KSCRIPT" ] && COMPILER_CP="$COMPILER_CP:$KSCRIPT"
[ -n "$TROVE" ] && COMPILER_CP="$COMPILER_CP:$TROVE"
[ -n "$KXCOROUTINES" ] && COMPILER_CP="$COMPILER_CP:$KXCOROUTINES"
KANNOT=$(find_jar org.jetbrains/annotations "*.jar" || true)
[ -n "$KANNOT" ] && COMPILER_CP="$COMPILER_CP:$KANNOT"
PLUGIN_ARGS=()
if [ -n "$COMPOSE_PLUGIN" ]; then PLUGIN_ARGS=(-Xplugin="$COMPOSE_PLUGIN"); fi

set +e
"$JAVA" -Djava.io.tmpdir="$WORK/tmp" -Xmx3g -cp "$COMPILER_CP" \
  org.jetbrains.kotlin.cli.jvm.K2JVMCompiler \
  -nowarn -jvm-target 17 "${PLUGIN_ARGS[@]}" \
  -cp "$(paste -sd: "$CP_FILE"):$STUB/javac" \
  -d "$OUT" \
  $SRCS $EXTRA
RC=$?
set -e
echo "== kotlinc exit=$RC on $(echo "$SRCS $EXTRA" | wc -w) files, $(wc -l < "$CP_FILE") classpath entries, plugin=${COMPOSE_PLUGIN:-none}"
exit $RC
