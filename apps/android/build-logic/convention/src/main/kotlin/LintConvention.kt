import com.android.build.api.dsl.Lint
import org.gradle.api.Project

/**
 * Android Lint as a hard gate, identical for every module (applied by the library and application conventions).
 * Warnings fail the build; module `lint-baseline.xml` files (committed, reviewed) are the only way to carry known
 * findings, and `lint.xml` at the project root escalates the checks we never want to regress.
 */
@Suppress("DEPRECATION") // sarifReport
fun Project.configureLint(lint: Lint) {
    lint.apply {
        warningsAsErrors = true
        abortOnError = true
        checkDependencies = true
        // AGP 9 deprecates the flag (reports are always generated); kept explicit so the intent survives a downgrade.
        sarifReport = true
        lintConfig = rootProject.file("lint.xml")
        val baselineFile = file("lint-baseline.xml")
        if (baselineFile.exists()) baseline = baselineFile
        // Backups would copy the Tink keyset preferences and the encrypted store off the device (allowBackup=false is
        // the first line of defence; the data extraction rules are the second).
        error += "DataExtractionRules"
    }
}
