package com.aedst.core.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aedst.core.ui.R
import com.aedst.core.ui.theme.AedstTheme

/** Diameter of [AedstAvatar]: web `avatar.tsx` `size` (sm 24, default 32, lg 40 dp). */
enum class AedstAvatarSize {
    DEFAULT,
    SM,
    LG,
}

private fun AedstAvatarSize.toDp() = when (this) {
    AedstAvatarSize.SM -> 24.dp
    AedstAvatarSize.DEFAULT -> 32.dp
    AedstAvatarSize.LG -> 40.dp
}

private fun AedstAvatarSize.toFontSize() = when (this) {
    AedstAvatarSize.SM -> 12.sp
    AedstAvatarSize.DEFAULT -> 14.sp
    AedstAvatarSize.LG -> 14.sp
}

/**
 * Circular user avatar. `core:ui` has no image-loading dependency (Coil) wired up yet, so
 * [imageUrl] is accepted for future use but is not dereferenced — the component always renders
 * an initials fallback.
 */
@Suppress("UnusedParameter")
@Composable
fun AedstAvatar(
    modifier: Modifier = Modifier,
    imageUrl: String? = null,
    initials: String? = null,
    size: AedstAvatarSize = AedstAvatarSize.DEFAULT,
) {
    val diameter = size.toDp()
    val label = initials?.trim()?.take(2)?.uppercase().orEmpty()
    val description = if (label.isNotEmpty()) {
        stringResource(R.string.aedst_a11y_avatar_named, label)
    } else {
        stringResource(R.string.aedst_a11y_avatar)
    }
    Box(
        modifier = modifier
            .size(diameter)
            .background(MaterialTheme.colorScheme.secondary, CircleShape)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = MaterialTheme.colorScheme.onSecondary,
            fontSize = size.toFontSize(),
            fontWeight = FontWeight.Medium,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Preview(name = "Dark", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES, showBackground = true)
@Composable
private fun AedstAvatarPreview() {
    AedstTheme {
        Surface {
            androidx.compose.foundation.layout.Row(
                horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.background(MaterialTheme.colorScheme.background),
            ) {
                AedstAvatar(initials = "JD", size = AedstAvatarSize.SM)
                AedstAvatar(initials = "AK", size = AedstAvatarSize.DEFAULT)
                AedstAvatar(initials = "M", size = AedstAvatarSize.LG)
                AedstAvatar(initials = "", size = AedstAvatarSize.DEFAULT)
            }
        }
    }
}
