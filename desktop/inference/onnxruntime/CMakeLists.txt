cmake_minimum_required(VERSION 3.16)
project(yp_fault_infer LANGUAGES CXX)

include(FetchContent)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(YP_FETCH_ONNXRUNTIME "Download a prebuilt ONNX Runtime package with FetchContent" ON)
set(YP_ONNXRUNTIME_VERSION "1.18.1" CACHE STRING "ONNX Runtime release version used by FetchContent")
set(YP_ONNXRUNTIME_PACKAGE_URL "" CACHE STRING "Override URL for a prebuilt ONNX Runtime package")

add_executable(yp_fault_infer
  src/main.cpp
)

target_compile_definitions(yp_fault_infer PRIVATE NOMINMAX)

if(DEFINED ENV{ONNXRUNTIME_ROOT})
  set(ONNXRUNTIME_ROOT "$ENV{ONNXRUNTIME_ROOT}")
endif()

function(yp_resolve_onnxruntime_package_url out_var)
  if(YP_ONNXRUNTIME_PACKAGE_URL)
    set(${out_var} "${YP_ONNXRUNTIME_PACKAGE_URL}" PARENT_SCOPE)
    return()
  endif()

  if(WIN32)
    set(_asset "onnxruntime-win-x64-${YP_ONNXRUNTIME_VERSION}.zip")
  elseif(APPLE)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
      set(_asset "onnxruntime-osx-arm64-${YP_ONNXRUNTIME_VERSION}.tgz")
    else()
      set(_asset "onnxruntime-osx-x86_64-${YP_ONNXRUNTIME_VERSION}.tgz")
    endif()
  else()
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
      set(_asset "onnxruntime-linux-aarch64-${YP_ONNXRUNTIME_VERSION}.tgz")
    else()
      set(_asset "onnxruntime-linux-x64-${YP_ONNXRUNTIME_VERSION}.tgz")
    endif()
  endif()

  set(${out_var}
    "https://github.com/microsoft/onnxruntime/releases/download/v${YP_ONNXRUNTIME_VERSION}/${_asset}"
    PARENT_SCOPE
  )
endfunction()

function(yp_find_onnxruntime_root candidate out_var)
  if(EXISTS "${candidate}/include/onnxruntime_cxx_api.h")
    set(${out_var} "${candidate}" PARENT_SCOPE)
    return()
  endif()

  file(GLOB _children LIST_DIRECTORIES true "${candidate}/onnxruntime-*")
  foreach(_child IN LISTS _children)
    if(IS_DIRECTORY "${_child}" AND EXISTS "${_child}/include/onnxruntime_cxx_api.h")
      set(${out_var} "${_child}" PARENT_SCOPE)
      return()
    endif()
  endforeach()

  set(${out_var} "" PARENT_SCOPE)
endfunction()

function(yp_enable_onnxruntime ort_root)
  set(_include_dir "${ort_root}/include")

  if(WIN32)
    if(EXISTS "${ort_root}/lib/onnxruntime.lib")
      set(_import_lib "${ort_root}/lib/onnxruntime.lib")
    elseif(EXISTS "${ort_root}/lib/libonnxruntime.dll.a")
      set(_import_lib "${ort_root}/lib/libonnxruntime.dll.a")
    else()
      set(_import_lib "${ort_root}/lib/onnxruntime.lib")
    endif()

    set(_runtime_lib "${ort_root}/lib/onnxruntime.dll")
  elseif(APPLE)
    set(_import_lib "${ort_root}/lib/libonnxruntime.dylib")
    set(_runtime_lib "${_import_lib}")
  else()
    set(_import_lib "${ort_root}/lib/libonnxruntime.so")
    set(_runtime_lib "${_import_lib}")
  endif()

  if(NOT EXISTS "${_include_dir}/onnxruntime_cxx_api.h" OR NOT EXISTS "${_import_lib}")
    message(WARNING "ONNX Runtime root is invalid: ${ort_root}")
    return()
  endif()

  add_library(onnxruntime::onnxruntime SHARED IMPORTED GLOBAL)

  set_target_properties(onnxruntime::onnxruntime PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${_include_dir}"
    IMPORTED_LOCATION "${_runtime_lib}"
  )

  if(WIN32)
    set_target_properties(onnxruntime::onnxruntime PROPERTIES
      IMPORTED_IMPLIB "${_import_lib}"
    )
  endif()

  target_link_libraries(yp_fault_infer PRIVATE onnxruntime::onnxruntime)
  target_compile_definitions(yp_fault_infer PRIVATE YP_ENABLE_ONNXRUNTIME=1)

  add_custom_command(TARGET yp_fault_infer POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${_runtime_lib}"
      "$<TARGET_FILE_DIR:yp_fault_infer>"
    COMMENT "Copying ONNX Runtime shared library"
  )

  set(YP_ONNXRUNTIME_ENABLED TRUE PARENT_SCOPE)
  message(STATUS "ONNX Runtime enabled: ${ort_root}")
endfunction()

set(YP_ONNXRUNTIME_ENABLED FALSE)

if(ONNXRUNTIME_ROOT)
  yp_enable_onnxruntime("${ONNXRUNTIME_ROOT}")
elseif(YP_FETCH_ONNXRUNTIME)
  yp_resolve_onnxruntime_package_url(_ort_url)
  message(STATUS "Fetching ONNX Runtime: ${_ort_url}")

  FetchContent_Declare(onnxruntime_prebuilt
    URL "${_ort_url}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  )

  FetchContent_MakeAvailable(onnxruntime_prebuilt)

  yp_find_onnxruntime_root("${onnxruntime_prebuilt_SOURCE_DIR}" _fetched_ort_root)

  if(_fetched_ort_root)
    yp_enable_onnxruntime("${_fetched_ort_root}")
  else()
    message(WARNING "Fetched ONNX Runtime package did not contain expected headers/libs")
  endif()
else()
  message(STATUS "ONNX Runtime fetch disabled and ONNXRUNTIME_ROOT not set")
endif()

if(NOT YP_ONNXRUNTIME_ENABLED)
  message(STATUS "Building unavailable ONNX Runtime backend")
endif()