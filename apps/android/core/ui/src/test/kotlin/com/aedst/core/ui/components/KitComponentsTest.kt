package com.aedst.core.ui.components

import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.aedst.core.ui.theme.AedstTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Behaviour of the stateful shadcn-parity components (Robolectric, English resources; JUnit 4 runner). */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "en")
class KitComponentsTest {

    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `pagination shows first, last and the neighbours of the current page with ellipses`() {
        assertEquals(listOf(1, null, 4, 5, 6, null, 12), paginationPages(current = 5, total = 12))
        assertEquals(listOf(1, 2, 3), paginationPages(current = 1, total = 3))
        assertEquals(listOf(1, 2, null, 12), paginationPages(current = 1, total = 12))
        assertEquals(emptyList<Int?>(), paginationPages(current = 1, total = 0))
    }

    @Test
    fun `pagination reports the pressed page and the next page`() {
        val pages = mutableListOf<Int>()
        compose.setContent {
            AedstTheme { AedstPagination(currentPage = 5, pageCount = 12, onPageChange = { pages += it }) }
        }

        compose.onNodeWithContentDescription("Page 4").performClick()
        compose.onNodeWithContentDescription("Next").performClick()

        assertEquals(listOf(4, 6), pages)
    }

    @Test
    fun `collapsible hides its content until the trigger is pressed`() {
        var expanded by mutableStateOf(false)
        compose.setContent {
            AedstTheme {
                AedstCollapsible(title = "Advanced", expanded = expanded, onExpandedChange = { expanded = it }) {
                    Text("Hidden detail")
                }
            }
        }
        compose.onNodeWithText("Hidden detail").assertDoesNotExist()

        compose.onNodeWithText("Advanced").performClick()

        compose.onNodeWithText("Hidden detail").assertExists()
    }

    @Test
    fun `single toggle group replaces the selection and clears it on a second press`() {
        var selected by mutableStateOf(setOf("Day"))
        compose.setContent {
            AedstTheme {
                AedstToggleGroup(
                    options = listOf("Day", "Week"),
                    selected = selected,
                    onSelectedChange = { selected = it },
                    optionLabel = { it },
                )
            }
        }
        compose.onNodeWithText("Day").assertIsOn()

        compose.onNodeWithText("Week").performClick()
        assertEquals(setOf("Week"), selected)
        compose.onNodeWithText("Day").assertIsOff()

        compose.onNodeWithText("Week").performClick()
        assertEquals(emptySet<String>(), selected)
    }

    @Test
    fun `data table header asks for ascending first, then descending`() {
        var sort by mutableStateOf<AedstDataTableSort?>(null)
        compose.setContent {
            AedstTheme {
                AedstDataTable(
                    columns = listOf(AedstDataTableColumn<String>("Name", sortable = true) { it }),
                    rows = listOf("Ada"),
                    emptyText = "Empty",
                    sort = sort,
                    onSortChange = { sort = it },
                )
            }
        }

        compose.onNodeWithText("Name").performClick()
        assertEquals(AedstDataTableSort(column = 0, ascending = true), sort)

        compose.onNodeWithText("Name").performClick()
        assertEquals(AedstDataTableSort(column = 0, ascending = false), sort)
    }

    @Test
    fun `otp input keeps digits only and never more than its length`() {
        var value by mutableStateOf("")
        compose.setContent {
            AedstTheme { AedstInputOtp(value = value, onValueChange = { value = it }, label = "Code", length = 4) }
        }

        compose.onNodeWithContentDescription("Code").performTextInput("12a3456")

        assertEquals("1234", value)
    }

    @Test
    fun `command filters items and reports the chosen one`() {
        val chosen = mutableListOf<String>()
        compose.setContent {
            AedstTheme {
                AedstCommand(
                    groups = listOf(
                        AedstCommandGroup("Tasks", listOf(AedstCommandItem("new", "New task"))),
                        AedstCommandGroup("Account", listOf(AedstCommandItem("out", "Sign out"))),
                    ),
                    onItemSelected = { chosen += it.id },
                    searchLabel = "Search commands",
                    emptyText = "No results",
                )
            }
        }

        compose.onNodeWithText("Search commands").performTextInput("sign")

        compose.onNodeWithText("New task").assertDoesNotExist()
        compose.onNodeWithText("Sign out").performClick()
        assertEquals(listOf("out"), chosen)
    }
}
