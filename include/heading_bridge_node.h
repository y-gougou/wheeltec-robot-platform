#ifndef HEADING_BRIDGE_NODE_H
#define HEADING_BRIDGE_NODE_H

#include <cmath>
#include <sstream>
#include <string>

#include <ros/ros.h>
#include <sensor_msgs/Imu.h>
#include <std_msgs/Empty.h>
#include <std_msgs/Float32.h>
#include <std_msgs/String.h>

class HeadingBridge {
public:
    HeadingBridge();
    ~HeadingBridge();

private:
    void imuCallback(const sensor_msgs::Imu::ConstPtr& msg);
    void zeroCallback(const std_msgs::Empty::ConstPtr& msg);
    void offsetCallback(const std_msgs::Float32::ConstPtr& msg);
    void publishStatus();

    static double quatToYawDeg(double qw, double qx, double qy, double qz);
    static double normalizeAngleDeg(double angle);

    ros::NodeHandle nh_;
    ros::Publisher heading_pub_;
    ros::Publisher status_pub_;
    ros::Subscriber imu_sub_;
    ros::Subscriber zero_sub_;
    ros::Subscriber offset_sub_;

    std::string imu_topic_;
    std::string heading_topic_;
    std::string status_topic_;
    double heading_zero_offset_;
    double publish_rate_;
    double min_publish_period_;

    double last_raw_;
    double last_unwrapped_;
    double last_heading_;
    bool valid_;
    std::string last_error_;
    double unwrap_turns_;
    bool has_prev_raw_;
    double prev_raw_;
    ros::Time last_publish_time_;
    ros::Time last_status_publish_time_;
};

#endif
