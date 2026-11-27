package com.aedst.core.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.password
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection
import com.aedst.core.ui.a11y.AedstMinTouchTarget
import com.aedst.core.ui.theme.AedstHairline
import com.aedst.core.ui.theme.AedstShapesScale
import com.aedst.core.ui.theme.AedstSpacing
import com.aedst.core.ui.theme.AedstTheme

/**
 * One-time-code input drawn as [length] cells, mirroring web's `input-otp.tsx`. It is a single text field (one
 * accessibility node named by [label], one IME session, paste works), not [length] separate fields. The node is
 * marked `ContentType.SmsOtpCode`, so the platform autofill service can offer the code from an SMS. Only digits are
 * kept; [onValueChange] never receives more than [length] characters. Digits are always laid out left to right, also
 * in RTL locales. [errorMessage] marks the field invalid for accessibility services. With [masked] the cells show a
 * dot instead of each digit and the node is a password field (screen readers do not echo it); the code itself is
 * never logged or stored by this component.
 */
@Composable
fun AedstInputOtp(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    length: Int = 6,
    enabled: Boolean = true,
    errorMessage: String? = null,
    masked: Boolean = false,
) {
    val colorScheme = MaterialTheme.colorScheme
    BasicTextField(
        value = value,
        onValueChange = { input -> onValueChange(input.filter(Char::isDigit).take(length)) },
        modifier = modifier.semantics {
            contentDescription = label
            contentType = ContentType.SmsOtpCode
            if (masked) password()
            if (!enabled) disabled()
            if (errorMessage != null) this.error(errorMessage)
        },
        enabled = enabled,
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        // The cells show the digits: the inner text field (its text and cursor) is deliberately not placed.
        decorationBox = {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                Row(horizontalArrangement = Arrangement.spacedBy(AedstSpacing.sm)) {
                    repeat(length) { index ->
                        val isNext = enabled && index == value.length
                        val borderColor = when {
                            errorMessage != null -> colorScheme.error
                            isNext -> colorScheme.primary
                            else -> colorScheme.outline
                        }
                        Surface(
                            modifier = Modifier.size(AedstMinTouchTarget),
                            shape = AedstShapesScale.medium,
                            border = BorderStroke(if (isNext) AedstSpacing.xxs else AedstHairline, borderColor),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = value.getOrNull(index)?.let {
                                        if (masked) MASK else it.toString()
                                    }.orEmpty(),
                                    style = MaterialTheme.typography.titleLarge,
                                )
                            }
                        }
                    }
                }
            }
        },
    )
}

private const val MASK = "•"

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstInputOtpPreview() {
    AedstTheme {
        Surface {
            AedstInputOtp(
                value = "123",
                onValueChange = {},
                label = "Verification code",
                modifier = Modifier.padding(AedstSpacing.lg),
            )
        }
    }
}
