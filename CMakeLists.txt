cmake_minimum_required(VERSION 2.8.3)
project(turn_on_wheeltec_robot)

find_package(catkin REQUIRED COMPONENTS
  geometry_msgs
  nav_msgs
  roscpp
  rospy
  serial
  sensor_msgs
  std_msgs
  tf
)

# ulimit -c unlimited
# ssh firefly@192.168.1.76
add_compile_options(-std=c++11)
if(NOT CMAKE_BUILD_TYPE OR CMAKE_BUILD_TYPE STREQUAL "Debug")
  add_compile_options(-g)
endif()

catkin_package(
  #INCLUDE_DIRS include
  #LIBRARIES turn_on_wheeltec_robot
  #CATKIN_DEPENDS geometry_msgs message_generation nav_msgs nav_msgs roscpp roslib rospy sensor_msgs std_msgs tf
  #DEPENDS system_lib
)

# defind robot status massage
# command atkin_make -DCATKIN_WHITELIST_PACKAGES="new_msg"
include_directories(include ${catkin_INCLUDE_DIRS} ${PCL_INCLUDE_DIRS})
include_directories(include/${PROJECT_NAME})

add_executable(wheeltec_robot_node src/wheeltec_robot.cpp src/Quaternion_Solution.cpp)
target_link_libraries(wheeltec_robot_node ${catkin_LIBRARIES})

add_executable(heading_bridge_node src/heading_bridge_node.cpp)
target_link_libraries(heading_bridge_node ${catkin_LIBRARIES})

add_executable(cmd_vel_web_adapter_node src/cmd_vel_web_adapter_node.cpp)
target_link_libraries(cmd_vel_web_adapter_node ${catkin_LIBRARIES})

add_executable(current_reader_node src/current_reader_node.cpp)
target_link_libraries(current_reader_node ${catkin_LIBRARIES})

install(TARGETS wheeltec_robot_node heading_bridge_node cmd_vel_web_adapter_node current_reader_node
  RUNTIME DESTINATION ${CATKIN_PACKAGE_BIN_DESTINATION}
)

catkin_install_python(PROGRAMS
  scripts/data_collector.py
  scripts/node_ping.py
  scripts/send_mark.py
  scripts/fault_injector.py
  scripts/web_dashboard_server.py
  scripts/build_fault_dataset.py
  DESTINATION ${CATKIN_PACKAGE_BIN_DESTINATION}
)

install(DIRECTORY scripts/core
  DESTINATION ${CATKIN_PACKAGE_BIN_DESTINATION}
  USE_SOURCE_PERMISSIONS
)

install(DIRECTORY launch config map meshes params_costmap_car
                  params_costmap_common params_nav_common urdf docs
  DESTINATION ${CATKIN_PACKAGE_SHARE_DESTINATION}
)

# The dashboard server serves the pre-built bundle. Keeping the bundle in the
# repository makes a fresh robot checkout usable without installing Node.js.
install(DIRECTORY web/dist
  DESTINATION ${CATKIN_PACKAGE_SHARE_DESTINATION}/web
)
