include_guard(GLOBAL)

# QtKeychain: the OS credential store for the OIDC refresh token (Windows Credential Manager,
# Linux Secret Service / libsecret / KWallet). BSD-3-Clause, https://github.com/frankosterfeld/qtkeychain.
#
# It is built from source as a pinned FetchContent subproject, NOT through vcpkg: the vcpkg port
# would pull vcpkg's own Qt, while this tree deliberately uses Qt's official binaries
# (docs/adr/0002-dependency-management.md). Version 0.17.0 was the latest release on 2026-07-06
# (verified against the GitHub releases API); the tag is annotated, so the commit is the tag's target.
#
# The subproject is EXCLUDE_FROM_ALL so its install() rules never end up in our packages, and it
# is linked statically (no extra shared library to ship or to replace).
#
# Provides AEDST_QTKEYCHAIN_TARGET (a CMake target) and AEDST_QTKEYCHAIN_INCLUDE_DIRS.
option(AEDST_SYSTEM_QTKEYCHAIN "Use an installed QtKeychain (find_package(Qt6Keychain)) instead of fetching it; for sandboxed builds without network (Flatpak)" OFF)

function(aedst_fetch_qtkeychain)
    if(AEDST_SYSTEM_QTKEYCHAIN)
        find_package(Qt6Keychain CONFIG REQUIRED)
        set(AEDST_QTKEYCHAIN_TARGET Qt6Keychain::Qt6Keychain PARENT_SCOPE)
        set(AEDST_QTKEYCHAIN_INCLUDE_DIRS "" PARENT_SCOPE) # the imported target carries its include directory
        return()
    endif()
    include(FetchContent)

    FetchContent_Declare(qtkeychain
        GIT_REPOSITORY https://github.com/frankosterfeld/qtkeychain.git
        # Peeled commit of the annotated tag 0.17.0 (git ls-remote, same commit as the Flatpak manifest). A tag can be
        # moved; a full commit cannot (scripts/check-forbidden-apis.sh, rule cmake-fetch-pin). No GIT_SHALLOW: it does
        # not combine reliably with a commit hash.
        GIT_TAG 875f77d9f61bd97fd84cca47ce3bc71186dfbd09)

    # Directory-scope settings: they only affect the subproject added below. They must be set before
    # FetchContent_MakeAvailable() adds it.
    set(BUILD_WITH_QT5 OFF)
    set(BUILD_TEST_APPLICATION OFF)
    set(BUILD_QTQUICK_DEMO OFF)
    set(BUILD_TRANSLATIONS OFF)
    set(BUILD_SHARED_LIBS OFF)
    FetchContent_MakeAvailable(qtkeychain)
    # EXCLUDE_FROM_ALL for the subproject (no all-target membership, no install() rules). The EXCLUDE_FROM_ALL keyword of
    # FetchContent_Declare() needs CMake 3.28 and this project supports 3.25; the directory property has the same effect
    # when set after the directory was added (checked with CMake 4.4.4: the subproject's targets are not built by `all`
    # and its install rules are skipped). This replaces the single-argument FetchContent_Populate() + CMP0169 OLD
    # pattern, which CMake 3.30 deprecated.
    set_property(DIRECTORY "${qtkeychain_SOURCE_DIR}" PROPERTY EXCLUDE_FROM_ALL TRUE)

    if(TARGET qt6keychain)
        set(target qt6keychain)
    elseif(TARGET Qt6Keychain::Qt6Keychain)
        set(target Qt6Keychain::Qt6Keychain)
    else()
        message(FATAL_ERROR "QtKeychain was fetched but no Qt 6 target was defined (expected qt6keychain).")
    endif()

    set(AEDST_QTKEYCHAIN_TARGET "${target}" PARENT_SCOPE)
    # keychain.h sits at the top of the source tree, the generated export header in the binary tree.
    set(AEDST_QTKEYCHAIN_INCLUDE_DIRS "${qtkeychain_SOURCE_DIR}" "${qtkeychain_BINARY_DIR}" PARENT_SCOPE)
endfunction()
