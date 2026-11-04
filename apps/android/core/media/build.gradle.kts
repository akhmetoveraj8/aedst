plugins {
    alias(libs.plugins.android.library.convention)
    alias(libs.plugins.android.compose.convention)
    alias(libs.plugins.android.hilt.convention)
}

// Shared media building blocks used by feature/media and feature/tasks (attachments):
//  - data: MediaService (CreateUpload / CompleteUpload / Get / List / Delete) behind MediaRepository
//  - upload: Photo Picker → WorkManager chain (prepare + CreateUpload → presigned PUT → CompleteUpload)
//  - processing: image compression (ImageDecoder + Bitmap.compress), video compression (Media3 Transformer),
//    local thumbnails (ContentResolver.loadThumbnail / MediaMetadataRetriever / ThumbnailUtils)
//  - ui: Coil 3 images keyed by media id (presigned URLs rotate), Media3 ExoPlayer video player
android {
    namespace = "com.aedst.core.media"
}

dependencies {
    implementation(project(":core:common"))
    implementation(project(":core:network"))
    implementation(project(":core:ui"))
    implementation(libs.compose.material.icons.extended)

    implementation(libs.androidx.core.ktx)
    implementation(libs.compose.activity)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp.core)
    implementation(libs.okhttp.coroutines)

    implementation(libs.workmanager.runtime)
    implementation(libs.hilt.work)
    ksp(libs.hilt.work.compiler)

    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    implementation(libs.media3.common)
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui.compose)
    implementation(libs.media3.transformer)
    implementation(libs.media3.effect)
}

dependencies {
    testImplementation(project(":core:testing"))
}
