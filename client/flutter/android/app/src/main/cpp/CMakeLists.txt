cmake_minimum_required(VERSION 3.22.1)
project(ai_world_state_engine C)
include(FetchContent)
FetchContent_Declare(quickjs
  URL https://bellard.org/quickjs/quickjs-2026-06-04.tar.xz
  URL_HASH SHA256=b376e839b322978313d929fd20663b11ba58b75df5a46c126dd19ea2fa70ad2a)
FetchContent_GetProperties(quickjs)
if(NOT quickjs_POPULATED)
  FetchContent_Populate(quickjs)
endif()
file(READ "${quickjs_SOURCE_DIR}/LICENSE" upstream_license)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../assets/quickjs-LICENSE.txt" packaged_license)
string(STRIP "${upstream_license}" upstream_license)
string(STRIP "${packaged_license}" packaged_license)
if(NOT "${upstream_license}" STREQUAL "${packaged_license}")
  message(FATAL_ERROR "Packaged QuickJS license differs from the pinned source archive")
endif()
add_library(ai_world_state_engine SHARED state_engine.c
  ${quickjs_SOURCE_DIR}/quickjs.c ${quickjs_SOURCE_DIR}/dtoa.c
  ${quickjs_SOURCE_DIR}/libregexp.c ${quickjs_SOURCE_DIR}/libunicode.c
  ${quickjs_SOURCE_DIR}/cutils.c)
target_include_directories(ai_world_state_engine PRIVATE ${quickjs_SOURCE_DIR})
target_compile_definitions(ai_world_state_engine PRIVATE _GNU_SOURCE CONFIG_VERSION="2026-06-04")
target_compile_features(ai_world_state_engine PRIVATE c_std_11)
target_link_libraries(ai_world_state_engine m dl log)
