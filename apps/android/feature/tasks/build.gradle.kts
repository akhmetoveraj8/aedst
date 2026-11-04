plugins {
    alias(libs.plugins.android.feature.convention)
}

android {
    namespace = "com.aedst.feature.tasks"
}

dependencies {
    implementation(project(":core:network"))
    // Offline writes: task.create / task.complete handlers and the queue behind the create form.
    implementation(project(":core:outbox"))
    // Attachments on the task detail screen: MediaRepository, upload pipeline, thumbnails, Photo Picker.
    implementation(project(":core:media"))
    implementation(project(":core:analytics"))
    implementation(libs.compose.material.icons.extended)
    // Two-pane tasks list-detail (NavigableListDetailPaneScaffold + navigator); BOM-managed, see core/ui.
    implementation(libs.compose.material3.adaptive)
    implementation(libs.compose.material3.adaptive.layout)
    implementation(libs.compose.material3.adaptive.navigation)

    // Robolectric tests (TaskListDetailScreenTest, the outbox delivery test) run on JUnit 4 rules/runners with no
    // Jupiter-native equivalent. testImplementation (not runtimeOnly): the engine brings the junit:junit 4 API.
    testImplementation(libs.junit.vintage.engine)
    testImplementation(libs.work.testing)

    // TaskOutboxDeliveryTest sends the real generated client through MockWebServer.
    testImplementation(libs.connect.kotlin.okhttp)
    testImplementation(libs.okhttp.core)
    testImplementation(libs.okhttp.mockwebserver)
}
