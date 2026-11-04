import com.android.build.api.dsl.ApplicationExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

/**
 * Applied by every application module (`app/`, `app-tv/`). Everything cross-cutting (Hilt, Compose, Detekt, the
 * release TLS-pin gate, locale config, leak detection) is composed in, so a new application module gets it for free.
 */
class AndroidApplicationConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.android.application")
            pluginManager.apply("aedst.detekt")
            configureKover()

            extensions.configure<ApplicationExtension> {
                compileSdk = ANDROID_COMPILE_SDK

                configureLint(lint)

                // Generates res/xml/_generated_res_locale_config from the values-<locale> folders (en, tg, uz, ar) plus the
                // module's `unqualifiedResLocale` (ru, in res/resources.properties), so the system per-app language
                // picker offers exactly the locales the app ships.
                androidResources {
                    generateLocaleConfig = true
                }

                defaultConfig {
                    targetSdk = ANDROID_TARGET_SDK
                    minSdk = ANDROID_MIN_SDK
                    // Release pipeline injects AEDST_VERSION_CODE (or the CI run number); local builds stay at 1.
                    versionCode = listOf("AEDST_VERSION_CODE", "GITHUB_RUN_NUMBER")
                        .firstNotNullOfOrNull { providers.environmentVariable(it).orNull?.takeIf(String::isNotBlank) }
                        ?.toInt()
                        ?: 1
                    versionName = providers.gradleProperty("aedst.versionName").get()
                    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
                }

                compileOptions {
                    sourceCompatibility = JavaVersion.VERSION_17
                    targetCompatibility = JavaVersion.VERSION_17
                    isCoreLibraryDesugaringEnabled = true
                }

                // Release signing comes only from the environment (CI secrets); nothing is committed. Without
                // AEDST_KEYSTORE_FILE the release build stays unsigned, as before.
                val keystoreFile = providers.environmentVariable("AEDST_KEYSTORE_FILE").orNull?.takeIf(String::isNotBlank)
                if (keystoreFile != null) {
                    signingConfigs {
                        create("release") {
                            storeFile = rootProject.file(keystoreFile)
                            storePassword = providers.environmentVariable("AEDST_KEYSTORE_PASSWORD").orNull
                            keyAlias = providers.environmentVariable("AEDST_KEY_ALIAS").orNull
                            keyPassword = providers.environmentVariable("AEDST_KEY_PASSWORD").orNull
                        }
                    }
                }

                buildTypes {
                    release {
                        if (keystoreFile != null) signingConfig = signingConfigs.getByName("release")
                        isMinifyEnabled = true
                        isShrinkResources = true
                        proguardFiles(
                            getDefaultProguardFile("proguard-android-optimize.txt"),
                            "proguard-rules.pro",
                        )
                    }
                }
            }

            // Some Firebase artifacts ship protolite-well-known-types, whose classes duplicate
            // protobuf-javalite (needed by core/datastore + connect-kotlin) and break dexing.
            configurations.configureEach {
                exclude(mapOf("group" to "com.google.firebase", "module" to "protolite-well-known-types"))
            }

            // A release APK without TLS pins is a security regression (core/network/build.gradle.kts): every application
            // module is a shippable APK, so each one gets the gate, not only the phone app.
            tasks.matching { it.name == "preReleaseBuild" }.configureEach {
                dependsOn(":core:network:verifyReleaseCertPins")
            }

            dependencies {
                add("coreLibraryDesugaring", versionCatalog.findLibrary("desugar-jdk-libs").get())
                // Leak detection in debug builds only (installs itself through a content provider; no code needed).
                add("debugImplementation", versionCatalog.findLibrary("leakcanary-android").get())
            }
        }
    }
}
