#ifndef CMD_VEL_WEB_ADAPTER_NODE_H
#define CMD_VEL_WEB_ADAPTER_NODE_H

#include <algorithm>
#include <cmath>
#include <string>
#include <utility>

#include <ros/ros.h>
#include <geometry_msgs/Twist.h>
#include <nav_msgs/Odometry.h>
#include <std_msgs/Bool.h>
#include <std_msgs/Empty.h>
#include <std_msgs/String.h>

class PIDController {
public:
    PIDController(double kp = 0.8, double ki = 0.1, double kd = 0.3, double output_limit = 1.0);
    double compute(double target, double current, double dt);
    void reset();

private:
    double kp_, ki_, kd_, output_limit_;
    double integral_;
    double prev_error_;
};

class CmdVelWebAdapter {
public:
    CmdVelWebAdapter();
    void run();

private:
    void cmdCallback(const geometry_msgs::Twist::ConstPtr& msg);
    void heartbeatCallback(const std_msgs::Empty::ConstPtr& msg);
    void estopCallback(const std_msgs::Bool::ConstPtr& msg);
    void cruiseCmdCallback(const geometry_msgs::Twist::ConstPtr& msg);
    void cruiseEnableCallback(const std_msgs::Bool::ConstPtr& msg);
    void testCmdCallback(const geometry_msgs::Twist::ConstPtr& msg);
    void testEnableCallback(const std_msgs::Bool::ConstPtr& msg);
    void odomCallback(const nav_msgs::Odometry::ConstPtr& msg);

    void enterCruise();
    void exitCruise();
    void exitTestMode();
    void publishStatus(const std::string& status);
    void publishCruiseStatus();

    double clampValue(double value, double limit) const;
    double shapeAxis(double value, double limit, double deadband, double min_ratio) const;
    geometry_msgs::Twist zeroTwist() const;
    geometry_msgs::Twist computeCruiseCmd(double dt);
    std::pair<std::string, geometry_msgs::Twist> resolveStatusAndCommand();
    void onShutdown();

    ros::NodeHandle nh_;
    ros::Publisher cmd_pub_;
    ros::Publisher status_pub_;
    ros::Publisher cruise_status_pub_;

    ros::Subscriber cmd_sub_;
    ros::Subscriber heartbeat_sub_;
    ros::Subscriber estop_sub_;
    ros::Subscriber cruise_cmd_sub_;
    ros::Subscriber cruise_enable_sub_;
    ros::Subscriber test_cmd_sub_;
    ros::Subscriber test_enable_sub_;
    ros::Subscriber odom_sub_;

    // Parameters
    std::string input_topic_;
    std::string output_topic_;
    std::string heartbeat_topic_;
    std::string estop_topic_;
    std::string status_topic_;
    std::string cruise_cmd_topic_;
    std::string test_cmd_topic_;
    std::string test_enable_topic_;
    std::string odom_topic_;

    double publish_rate_;
    double cmd_timeout_;
    double heartbeat_timeout_;
    double max_linear_x_;
    double max_linear_y_;
    double max_angular_z_;
    double linear_deadband_;
    double angular_deadband_;
    double response_exponent_;
    double min_linear_ratio_;
    double min_lateral_ratio_;
    double min_angular_ratio_;
    double cruise_correction_ratio_;

    // State
    geometry_msgs::Twist last_cmd_;
    ros::Time last_cmd_time_;
    ros::Time last_heartbeat_time_;
    bool have_cmd_;
    bool estop_latched_;
    std::string last_status_;

    // Cruise state
    bool cruise_active_;
    geometry_msgs::Twist cruise_target_;
    geometry_msgs::Twist current_velocity_;
    PIDController pid_x_;
    PIDController pid_y_;

    // Test state
    bool test_active_;
    geometry_msgs::Twist test_target_;
    ros::Time test_cmd_time_;
};

#endif
