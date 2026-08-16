#include "heading_bridge_node.h"
#include <iomanip>

HeadingBridge::HeadingBridge()
    : last_raw_(0.0), last_unwrapped_(0.0), last_heading_(0.0),
      valid_(false), unwrap_turns_(0.0), has_prev_raw_(false), prev_raw_(0.0)
{
    ros::NodeHandle private_nh("~");

    private_nh.param<std::string>("imu_topic", imu_topic_, "/n100/imu");
    private_nh.param<std::string>("heading_topic", heading_topic_, "/chassis/heading_deg");
    private_nh.param<std::string>("status_topic", status_topic_, "/web/heading_status");
    private_nh.param("heading_zero_offset", heading_zero_offset_, 0.0);

    double rate_val;
    private_nh.param("publish_rate", rate_val, 30.0);
    if (rate_val < 1.0) rate_val = 1.0;
    publish_rate_ = rate_val;
    min_publish_period_ = 1.0 / publish_rate_;

    heading_pub_ = nh_.advertise<std_msgs::Float32>(heading_topic_, 10);
    status_pub_ = nh_.advertise<std_msgs::String>(status_topic_, 1, true);  // latched

    imu_sub_ = nh_.subscribe(imu_topic_, 50, &HeadingBridge::imuCallback, this);
    zero_sub_ = nh_.subscribe("/web/heading_zero", 5, &HeadingBridge::zeroCallback, this);
    offset_sub_ = nh_.subscribe("/web/heading_offset", 5, &HeadingBridge::offsetCallback, this);

    last_publish_time_ = ros::Time(0);
    last_status_publish_time_ = ros::Time(0);

    publishStatus();
    ROS_INFO("heading_bridge ready: %s -> %s", imu_topic_.c_str(), heading_topic_.c_str());
}

HeadingBridge::~HeadingBridge() {
    publishStatus();
}

double HeadingBridge::quatToYawDeg(double qw, double qx, double qy, double qz) {
    double siny_cosp = 2.0 * (qw * qz + qx * qy);
    double cosy_cosp = 1.0 - 2.0 * (qy * qy + qz * qz);
    return atan2(siny_cosp, cosy_cosp) * 180.0 / M_PI;
}

double HeadingBridge::normalizeAngleDeg(double angle) {
    while (angle >= 180.0) angle -= 360.0;
    while (angle < -180.0) angle += 360.0;
    return angle;
}

void HeadingBridge::imuCallback(const sensor_msgs::Imu::ConstPtr& msg) {
    double raw = quatToYawDeg(
        msg->orientation.w, msg->orientation.x,
        msg->orientation.y, msg->orientation.z);

    double unwrapped;
    if (!has_prev_raw_) {
        unwrapped = raw;
        has_prev_raw_ = true;
    } else {
        double delta = raw - prev_raw_;
        if (delta > 180.0)
            unwrap_turns_ -= 1.0;
        else if (delta < -180.0)
            unwrap_turns_ += 1.0;
        unwrapped = raw + 360.0 * unwrap_turns_;
    }
    prev_raw_ = raw;
    last_raw_ = raw;
    last_unwrapped_ = unwrapped;
    last_heading_ = normalizeAngleDeg(unwrapped - heading_zero_offset_);
    valid_ = true;

    ros::Time now = ros::Time::now();
    if ((now - last_publish_time_).toSec() < min_publish_period_)
        return;
    last_publish_time_ = now;

    std_msgs::Float32 heading_msg;
    heading_msg.data = static_cast<float>(last_heading_);
    heading_pub_.publish(heading_msg);

    ros::Time now2 = ros::Time::now();
    if ((now2 - last_status_publish_time_).toSec() >= 0.5) {
        last_status_publish_time_ = now2;
        publishStatus();
    }
}

void HeadingBridge::zeroCallback(const std_msgs::Empty::ConstPtr&) {
    heading_zero_offset_ = last_unwrapped_;
    publishStatus();
}

void HeadingBridge::offsetCallback(const std_msgs::Float32::ConstPtr& msg) {
    heading_zero_offset_ = msg->data;
    publishStatus();
}

void HeadingBridge::publishStatus() {
    std::ostringstream ss;
    ss << "{\"valid\":" << (valid_ ? "true" : "false")
       << ",\"heading\":" << std::fixed << std::setprecision(3) << last_heading_
       << ",\"raw\":" << last_raw_
       << ",\"unwrapped\":" << last_unwrapped_
       << ",\"zero_offset\":" << heading_zero_offset_
       << ",\"error\":\"" << last_error_ << "\"}";

    std_msgs::String status_msg;
    status_msg.data = ss.str();
    status_pub_.publish(status_msg);
}

int main(int argc, char** argv) {
    ros::init(argc, argv, "heading_bridge");
    HeadingBridge bridge;
    ros::spin();
    return 0;
}
