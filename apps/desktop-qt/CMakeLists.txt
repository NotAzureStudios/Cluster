cmake_minimum_required(VERSION 3.31.0...4.4)

project(ClusterDesktop VERSION 0.482.0 LANGUAGES CXX)

set(CLUSTER_RUNTIME_VERSION "0.546.0" CACHE STRING "Cluster runtime version paired with native helpers")
set(CLUSTER_WORKSTATION_PROTOCOL 1 CACHE STRING "Cluster Workstation source-control protocol")
option(CLUSTER_REQUIRE_PRIVATE_GIT_RUNTIME "Require the private Git/Git LFS runtime for packaged Desktop builds" OFF)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

find_package(Qt6 6.11 REQUIRED COMPONENTS Core Gui Quick QuickControls2 Network Widgets Concurrent WebView)
if(UNIX AND NOT APPLE)
    find_package(Qt6 6.11 REQUIRED COMPONENTS DBus)
endif()
qt_standard_project_setup(REQUIRES 6.11)

find_package(PkgConfig QUIET)

set(CLUSTER_FUSE3_FOUND FALSE)
if(WIN32)
    find_path(CLUSTER_FUSE3_INCLUDE_DIR fuse3/fuse.h
        HINTS "$ENV{ProgramFiles}/WinFsp/inc" "$ENV{ProgramFiles(x86)}/WinFsp/inc")
    if(CMAKE_SIZEOF_VOID_P EQUAL 8)
        find_library(CLUSTER_FUSE3_LIBRARY NAMES winfsp-x64 winfsp
            HINTS "$ENV{ProgramFiles}/WinFsp/lib" "$ENV{ProgramFiles(x86)}/WinFsp/lib")
    else()
        find_library(CLUSTER_FUSE3_LIBRARY NAMES winfsp-x86 winfsp
            HINTS "$ENV{ProgramFiles}/WinFsp/lib" "$ENV{ProgramFiles(x86)}/WinFsp/lib")
    endif()
    if(CLUSTER_FUSE3_INCLUDE_DIR AND CLUSTER_FUSE3_LIBRARY)
        set(CLUSTER_FUSE3_FOUND TRUE)
    endif()
elseif(UNIX AND PkgConfig_FOUND)
    pkg_check_modules(CLUSTER_FUSE3 QUIET fuse3)
endif()

set(CLUSTER_LIBSECRET_FOUND FALSE)
if(UNIX AND NOT APPLE AND PkgConfig_FOUND)
    pkg_check_modules(CLUSTER_LIBSECRET QUIET libsecret-1)
    if(CLUSTER_LIBSECRET_FOUND)
        set(CLUSTER_LIBSECRET_FOUND TRUE)
    endif()
endif()

set(CLUSTER_PLATFORM_SOURCES)
if(WIN32)
    list(APPEND CLUSTER_PLATFORM_SOURCES assets/windows/cluster.rc)
elseif(APPLE)
    list(APPEND CLUSTER_PLATFORM_SOURCES assets/cluster.icns)
    set_source_files_properties(assets/cluster.icns PROPERTIES MACOSX_PACKAGE_LOCATION "Resources")
endif()

qt_add_executable(cluster-desktop
    src/main.cpp
    src/AppController.cpp
    src/AppController.h
    src/ApiClient.cpp
    src/ApiClient.h
    src/PersistentCookieJar.cpp
    src/PersistentCookieJar.h
    src/VariantListModel.cpp
    src/VariantListModel.h
    src/DesktopIntegration.cpp
    src/DesktopIntegration.h
    src/TransferManager.cpp
    src/TransferManager.h
    src/LibraryMountManager.cpp
    src/LibraryMountManager.h
    src/ClusterFuseMount.cpp
    src/ClusterFuseMount.h
    src/GlobalShortcutManager.cpp
    src/GlobalShortcutManager.h
    src/DesktopPreferences.cpp
    src/DesktopPreferences.h
    src/ServerProfileStore.cpp
    src/ServerProfileStore.h
    src/NativeCapabilityBroker.cpp
    src/NativeCapabilityBroker.h
    src/WorkstationServiceManager.cpp
    src/WorkstationServiceManager.h
    src/DeepLinkRouter.cpp
    src/DeepLinkRouter.h
    src/CrashReporter.cpp
    src/CrashReporter.h
    src/NativeUpdateManager.cpp
    src/NativeUpdateManager.h
    ${CLUSTER_PLATFORM_SOURCES}
)

# Qt requires singleton source properties in addition to pragma Singleton.
set_source_files_properties(qml/Theme.qml qml/ThemeTokens.qml
    PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_qml_module(cluster-desktop
    URI Cluster.Desktop
    VERSION 1.0
    QML_FILES
        qml/Main.qml
        qml/Theme.qml
        qml/ThemeTokens.qml
        qml/components/ClusterLogo.qml
        qml/components/ClusterButton.qml
        qml/components/ClusterTextField.qml
        qml/components/ClusterComboBox.qml
        qml/components/ClusterChevron.qml
        qml/components/ClusterSwitch.qml
        qml/components/Surface.qml
        qml/components/UpdateDialog.qml
        qml/pages/ServerPage.qml
        qml/pages/SharedRendererPage.qml
        qml/pages/AppSettingsWindow.qml
        qml/pages/ServerProfilesWindow.qml
    RESOURCES
        assets/cluster-logo.png
        assets/cluster-icon.png
        assets/cluster-icon-1024.png
        assets/update-public-key.pem
)

target_compile_definitions(cluster-desktop PRIVATE
    CLUSTER_DESKTOP_VERSION="${PROJECT_VERSION}"
    CLUSTER_RUNTIME_VERSION="${CLUSTER_RUNTIME_VERSION}"
    CLUSTER_WORKSTATION_PROTOCOL=${CLUSTER_WORKSTATION_PROTOCOL}
    CLUSTER_TRANSPORT_PROTOCOL=2
    QT_NO_CAST_FROM_ASCII
    QT_NO_CAST_TO_ASCII
)

if(MSVC)
    target_compile_options(cluster-desktop PRIVATE /W4 /permissive- /Zc:__cplusplus)
else()
    target_compile_options(cluster-desktop PRIVATE -Wall -Wextra -Wpedantic)
endif()

target_link_libraries(cluster-desktop PRIVATE
    Qt6::Core
    Qt6::Gui
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
    Qt6::Widgets
    Qt6::Concurrent
    Qt6::WebView
)
if(UNIX AND NOT APPLE)
    target_link_libraries(cluster-desktop PRIVATE Qt6::DBus)
endif()

if(CLUSTER_LIBSECRET_FOUND)
    target_compile_definitions(cluster-desktop PRIVATE CLUSTER_HAS_LIBSECRET=1)
    target_include_directories(cluster-desktop PRIVATE ${CLUSTER_LIBSECRET_INCLUDE_DIRS})
    target_link_directories(cluster-desktop PRIVATE ${CLUSTER_LIBSECRET_LIBRARY_DIRS})
    target_link_libraries(cluster-desktop PRIVATE ${CLUSTER_LIBSECRET_LIBRARIES})
    target_compile_options(cluster-desktop PRIVATE ${CLUSTER_LIBSECRET_CFLAGS_OTHER})
endif()

if(CLUSTER_FUSE3_FOUND)
    target_compile_definitions(cluster-desktop PRIVATE CLUSTER_HAS_FUSE3=1)
    if(WIN32)
        target_include_directories(cluster-desktop PRIVATE "${CLUSTER_FUSE3_INCLUDE_DIR}")
        target_link_libraries(cluster-desktop PRIVATE "${CLUSTER_FUSE3_LIBRARY}")
    else()
        target_include_directories(cluster-desktop PRIVATE ${CLUSTER_FUSE3_INCLUDE_DIRS})
        target_link_directories(cluster-desktop PRIVATE ${CLUSTER_FUSE3_LIBRARY_DIRS})
        target_link_libraries(cluster-desktop PRIVATE ${CLUSTER_FUSE3_LIBRARIES})
        target_compile_options(cluster-desktop PRIVATE ${CLUSTER_FUSE3_CFLAGS_OTHER})
    endif()
endif()

if(WIN32)
    target_link_libraries(cluster-desktop PRIVATE Crypt32)
    set_target_properties(cluster-desktop PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

if(APPLE)
    target_link_libraries(cluster-desktop PRIVATE "-framework Carbon" "-framework Security")
    set_target_properties(cluster-desktop PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_BUNDLE_NAME "Cluster"
        MACOSX_BUNDLE_ICON_FILE "cluster.icns"
        MACOSX_BUNDLE_GUI_IDENTIFIER "studio.cluster.desktop"
        MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
        MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    )
endif()

set_target_properties(cluster-desktop PROPERTIES
    OUTPUT_NAME "Cluster"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)

include(GNUInstallDirs)
install(TARGETS cluster-desktop
    BUNDLE DESTINATION .
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

if(WIN32)
    set(CLUSTER_UPDATE_HELPER_NAME "cluster-update-helper.exe")
else()
    set(CLUSTER_UPDATE_HELPER_NAME "cluster-update-helper")
endif()
set(CLUSTER_UPDATE_HELPER_REPOSITORY "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/${CLUSTER_UPDATE_HELPER_NAME}")
set(CLUSTER_UPDATE_HELPER_STANDALONE "${CMAKE_CURRENT_SOURCE_DIR}/bin/${CLUSTER_UPDATE_HELPER_NAME}")
if(EXISTS "${CLUSTER_UPDATE_HELPER_REPOSITORY}")
    set(CLUSTER_UPDATE_HELPER_SOURCE "${CLUSTER_UPDATE_HELPER_REPOSITORY}")
elseif(EXISTS "${CLUSTER_UPDATE_HELPER_STANDALONE}")
    set(CLUSTER_UPDATE_HELPER_SOURCE "${CLUSTER_UPDATE_HELPER_STANDALONE}")
else()
    message(FATAL_ERROR "Cluster update verification helper is missing. Run npm run desktop:build-helper in the full source tree.")
endif()
install(PROGRAMS "${CLUSTER_UPDATE_HELPER_SOURCE}" DESTINATION ${CMAKE_INSTALL_BINDIR})

if(WIN32)
    set(CLUSTER_WORKSTATION_HELPER_NAME "cluster-workstation-service.exe")
else()
    set(CLUSTER_WORKSTATION_HELPER_NAME "cluster-workstation-service")
endif()
set(CLUSTER_WORKSTATION_HELPER_REPOSITORY "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/${CLUSTER_WORKSTATION_HELPER_NAME}")
set(CLUSTER_WORKSTATION_HELPER_STANDALONE "${CMAKE_CURRENT_SOURCE_DIR}/bin/${CLUSTER_WORKSTATION_HELPER_NAME}")
if(EXISTS "${CLUSTER_WORKSTATION_HELPER_REPOSITORY}")
    set(CLUSTER_WORKSTATION_HELPER_SOURCE "${CLUSTER_WORKSTATION_HELPER_REPOSITORY}")
elseif(EXISTS "${CLUSTER_WORKSTATION_HELPER_STANDALONE}")
    set(CLUSTER_WORKSTATION_HELPER_SOURCE "${CLUSTER_WORKSTATION_HELPER_STANDALONE}")
else()
    message(FATAL_ERROR "Cluster Workstation helper is missing. Run npm run native:reconstruction:workstation in the full source tree.")
endif()
set(CLUSTER_WORKSTATION_MANIFEST_REPOSITORY "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/cluster-workstation-service.manifest.json")
set(CLUSTER_WORKSTATION_MANIFEST_STANDALONE "${CMAKE_CURRENT_SOURCE_DIR}/bin/cluster-workstation-service.manifest.json")
if(EXISTS "${CLUSTER_WORKSTATION_MANIFEST_REPOSITORY}")
    set(CLUSTER_WORKSTATION_MANIFEST_SOURCE "${CLUSTER_WORKSTATION_MANIFEST_REPOSITORY}")
elseif(EXISTS "${CLUSTER_WORKSTATION_MANIFEST_STANDALONE}")
    set(CLUSTER_WORKSTATION_MANIFEST_SOURCE "${CLUSTER_WORKSTATION_MANIFEST_STANDALONE}")
else()
    message(FATAL_ERROR "Cluster Workstation integrity manifest is missing. Rebuild the Workstation helper with the official toolchain.")
endif()
file(READ "${CLUSTER_WORKSTATION_MANIFEST_SOURCE}" CLUSTER_WORKSTATION_MANIFEST_JSON)
string(JSON CLUSTER_WORKSTATION_MANIFEST_VERSION GET "${CLUSTER_WORKSTATION_MANIFEST_JSON}" clusterVersion)
string(JSON CLUSTER_WORKSTATION_MANIFEST_PROTOCOL GET "${CLUSTER_WORKSTATION_MANIFEST_JSON}" protocol)
if(NOT CLUSTER_WORKSTATION_MANIFEST_VERSION STREQUAL CLUSTER_RUNTIME_VERSION)
    message(FATAL_ERROR "Workstation helper version ${CLUSTER_WORKSTATION_MANIFEST_VERSION} does not match Cluster runtime ${CLUSTER_RUNTIME_VERSION}.")
endif()
if(NOT CLUSTER_WORKSTATION_MANIFEST_PROTOCOL STREQUAL "${CLUSTER_WORKSTATION_PROTOCOL}")
    message(FATAL_ERROR "Workstation helper protocol ${CLUSTER_WORKSTATION_MANIFEST_PROTOCOL} does not match Desktop protocol ${CLUSTER_WORKSTATION_PROTOCOL}.")
endif()
install(PROGRAMS "${CLUSTER_WORKSTATION_HELPER_SOURCE}" DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES "${CLUSTER_WORKSTATION_MANIFEST_SOURCE}" DESTINATION ${CMAKE_INSTALL_BINDIR})

# The native Package Stager is part of the Desktop product, not the Server.
# Install it through CMake so the portable tree and CPack/NSIS contain the
# same helper and disclosure instead of silently omitting it from NSIS.
if(WIN32)
    set(CLUSTER_PACKAGE_STAGER_NAME "cluster-package-stager.exe")
else()
    set(CLUSTER_PACKAGE_STAGER_NAME "cluster-package-stager")
endif()
set(CLUSTER_PACKAGE_STAGER_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/${CLUSTER_PACKAGE_STAGER_NAME}")
set(CLUSTER_PACKAGE_STAGER_NOTICE "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/PACKAGE_STAGER_SECURITY.txt")
if(CLUSTER_REQUIRE_PRIVATE_GIT_RUNTIME AND
   (NOT EXISTS "${CLUSTER_PACKAGE_STAGER_SOURCE}" OR NOT EXISTS "${CLUSTER_PACKAGE_STAGER_NOTICE}"))
    message(FATAL_ERROR "Distributable Cluster Desktop requires the compiled Package Stager and security notice.")
endif()
if(EXISTS "${CLUSTER_PACKAGE_STAGER_SOURCE}" AND EXISTS "${CLUSTER_PACKAGE_STAGER_NOTICE}")
    install(PROGRAMS "${CLUSTER_PACKAGE_STAGER_SOURCE}" DESTINATION ${CMAKE_INSTALL_BINDIR})
    install(FILES "${CLUSTER_PACKAGE_STAGER_NOTICE}" DESTINATION ${CMAKE_INSTALL_BINDIR})
endif()


if(WIN32)
    set(CLUSTER_PRIVATE_GIT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/runtime/git")
    set(CLUSTER_PRIVATE_GIT_LFS_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../../bin/runtime/git-lfs")
    set(CLUSTER_PRIVATE_GIT_EXE "${CLUSTER_PRIVATE_GIT_ROOT}/cmd/git.exe")
    set(CLUSTER_PRIVATE_GIT_LFS_EXE "${CLUSTER_PRIVATE_GIT_LFS_ROOT}/git-lfs.exe")
    if(CLUSTER_REQUIRE_PRIVATE_GIT_RUNTIME AND (NOT EXISTS "${CLUSTER_PRIVATE_GIT_EXE}" OR NOT EXISTS "${CLUSTER_PRIVATE_GIT_LFS_EXE}"))
        message(FATAL_ERROR "Packaged Cluster Desktop requires staged private Git and Git LFS runtimes. Run npm run desktop:runtime:verify after staging the pinned runtimes.")
    endif()
    if(EXISTS "${CLUSTER_PRIVATE_GIT_EXE}")
        install(DIRECTORY "${CLUSTER_PRIVATE_GIT_ROOT}" DESTINATION ${CMAKE_INSTALL_BINDIR}/runtime)
    endif()
    if(EXISTS "${CLUSTER_PRIVATE_GIT_LFS_EXE}")
        install(DIRECTORY "${CLUSTER_PRIVATE_GIT_LFS_ROOT}" DESTINATION ${CMAKE_INSTALL_BINDIR}/runtime)
    endif()
endif()

install(FILES assets/update-public-key.pem DESTINATION ${CMAKE_INSTALL_BINDIR})
if(UNIX AND NOT APPLE)
    install(FILES assets/cluster-icon.png DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/512x512/apps RENAME cluster.png)
    install(FILES assets/linux/studio.cluster.desktop.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)
endif()

qt_generate_deploy_qml_app_script(
    TARGET cluster-desktop
    OUTPUT_SCRIPT cluster_desktop_deploy_script
    NO_UNSUPPORTED_PLATFORM_ERROR
)
install(SCRIPT ${cluster_desktop_deploy_script})


set(CPACK_PACKAGE_NAME "Cluster Desktop")
set(CPACK_PACKAGE_VENDOR "Cluster Studio")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_INSTALL_DIRECTORY "Cluster")
set(CPACK_PACKAGE_FILE_NAME "Cluster-Desktop-${PROJECT_VERSION}-${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR}")
set(CPACK_VERBATIM_VARIABLES YES)
if(WIN32)
    set(CPACK_GENERATOR "NSIS;ZIP")
    set(CPACK_NSIS_DISPLAY_NAME "Cluster")
    set(CPACK_NSIS_MUI_ICON "${CMAKE_CURRENT_SOURCE_DIR}/assets/cluster-icon.ico")
    set(CPACK_NSIS_MUI_UNIICON "${CMAKE_CURRENT_SOURCE_DIR}/assets/cluster-icon.ico")
    set(CPACK_NSIS_INSTALLED_ICON_NAME "bin\\Cluster.exe")
    set(CPACK_NSIS_PACKAGE_NAME "Cluster Desktop")
    set(CPACK_NSIS_ENABLE_UNINSTALL_BEFORE_INSTALL ON)
    set(CPACK_NSIS_MODIFY_PATH OFF)
    set(CPACK_NSIS_EXTRA_INSTALL_COMMANDS "WriteRegStr HKCU 'Software\\Classes\\cluster' '' 'URL:Cluster Desktop Protocol'\nWriteRegStr HKCU 'Software\\Classes\\cluster' 'URL Protocol' ''\nWriteRegStr HKCU 'Software\\Classes\\cluster\\DefaultIcon' '' '$\"$INSTDIR\\bin\\Cluster.exe$\",0'\nWriteRegStr HKCU 'Software\\Classes\\cluster\\shell\\open\\command' '' '$\"$INSTDIR\\bin\\Cluster.exe$\" $\"%1$\"'\nWriteRegStr HKCU 'Software\\Classes\\.clusterlink' '' 'Cluster.Desktop.Link'\nWriteRegStr HKCU 'Software\\Classes\\Cluster.Desktop.Link\\DefaultIcon' '' '$\"$INSTDIR\\bin\\Cluster.exe$\",0'\nWriteRegStr HKCU 'Software\\Classes\\Cluster.Desktop.Link\\shell\\open\\command' '' '$\"$INSTDIR\\bin\\Cluster.exe$\" $\"%1$\"'")
    set(CPACK_NSIS_EXTRA_UNINSTALL_COMMANDS "DeleteRegKey HKCU 'Software\\Classes\\cluster'\nDeleteRegKey HKCU 'Software\\Classes\\.clusterlink'\nDeleteRegKey HKCU 'Software\\Classes\\Cluster.Desktop.Link'")
endif()
include(CPack)

if(WIN32)
  target_link_libraries(cluster-desktop PRIVATE psapi)
endif()
