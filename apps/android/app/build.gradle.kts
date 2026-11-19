plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

val ciKeystorePath = System.getenv("SONORA_ANDROID_KEYSTORE_PATH")
val ciKeystorePassword = System.getenv("SONORA_ANDROID_KEYSTORE_PASSWORD")
val ciKeyAlias = System.getenv("SONORA_ANDROID_KEY_ALIAS")
val ciKeyPassword = System.getenv("SONORA_ANDROID_KEY_PASSWORD")
val hasCiSigning = listOf(ciKeystorePath, ciKeystorePassword, ciKeyAlias, ciKeyPassword).all { !it.isNullOrBlank() }

android {
    namespace = "app.sonora.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.sonora.android"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.gradleProperty("sonoraVersionCode").orElse("1").get().toInt()
        versionName = providers.gradleProperty("sonoraVersionName").orElse("0.1.0").get()
        buildConfigField("String", "SONORA_API_URL", "\"https://sonora-web-api-production.up.railway.app\"")
    }

    signingConfigs {
        if (hasCiSigning) {
            create("ciRelease") {
                storeFile = file(ciKeystorePath!!)
                storePassword = ciKeystorePassword
                keyAlias = ciKeyAlias
                keyPassword = ciKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (hasCiSigning) {
                signingConfig = signingConfigs.getByName("ciRelease")
            }
        }
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

// Fail before task execution if somebody requests a release without the persistent key.
// Debug/QA builds remain buildable while repository secrets are being configured.
gradle.taskGraph.whenReady {
    val releaseRequested = allTasks.any { it.name == "assembleRelease" || it.name == "bundleRelease" }
    if (releaseRequested && !hasCiSigning) {
        throw GradleException("Stable SONORA signing secrets are required for release APKs.")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
    implementation("androidx.media3:media3-datasource:1.5.1")
    implementation("androidx.media3:media3-database:1.5.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    implementation("androidx.room:room-compiler:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
