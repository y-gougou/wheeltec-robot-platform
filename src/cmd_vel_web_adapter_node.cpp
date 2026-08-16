#include "cmd_vel_web_adapter_node.h"
#include <cstdio>

// --- PIDController ---

PIDController::PIDController(double kp, double ki, double kd, double output_limit)
    : kp_(kp), ki_(ki), kd_(kd), output_limit_(output_limit),
      integral_(0.0), prev_error_(0.0) {}

double PIDController::compute(double target, double current, double dt) {
    double error = target - current;
    double derivative = (dt > 0) ? (error - prev_error_) / dt : 0.0;
    integral_ += error * dt;
    integral_ = std::max(-0.5, std::min(0.5, integral_));
    double output = kp_ * error + ki_ * integral_ + kd_ * derivative;
    output = std::max(-output_limit_, std::min(output_limit_, output));
    prev_error_ = error;
    return output;
}

void PIDController::reset() {
    integral_ = 0.0;
    prev_error_ = 0.0;
}

// --- CmdVelWebAdapter ---

CmdVelWebAdapter::CmdVelWebAdapter()
    : have_cmd_(false), estop_latched_(false),
      cruise_active_(false), test_active_(false)
{
    ros::NodeHandle private_nh("~");

    private_nh.param<std::string>("input_topic", input_topic_, "/cmd_vel_web");
    private_nh.param<std::string>("output_topic", output_topic_, "/cmd_vel");
    private_nh.param<std::string>("heartbeat_topic", heartbeat_topic_, "/web/heartbeat");
    private_nh.param<std::string>("estop_topic", estop_topic_, "/web/estop");
    private_nh.param<std::string>("status_topic", status_topic_, "/web/control_status");
    private_nh.param<std::string>("cruise_cmd_topic", cruise_cmd_topic_, "/web/cruise_cmd");
    private_nh.param<std::string>("test_cmd_topic", test_cmd_topic_, "/web/test_cmd");
    private_nh.param<std::string>("test_enable_topic", test_enable_topic_, "/web/test_enable");
    private_nh.param<std::string>("odom_topic", odom_topic_, "/odom");

    private_nh.param("publish_rate", publish_rate_, 20.0);
    private_nh.param("cmd_timeout", cmd_timeout_, 0.5);
    private_nh.param("heartbeat_timeout", heartbeat_timeout_, 1.0);
    private_nh.param("max_linear_x", max_linear_x_, 0.4);
    private_nh.param("max_linear_y", max_linear_y_, 0.4);
    private_nh.param("max_angular_z", max_angular_z_, 1.0);
    private_nh.param("linear_deadband", linear_deadband_, 0.02);
    private_nh.param("angular_deadband", angular_deadband_, 0.03);
    private_nh.param("response_exponent", response_exponent_, 0.70);
    private_nh.param("min_linear_ratio", min_linear_ratio_, 0.20);
    private_nh.param("min_lateral_ratio", min_lateral_ratio_, 0.15);
    private_nh.param("min_angular_ratio", min_angular_ratio_, 0.24);
    private_nh.param("cruise_correction_ratio", cruise_correction_ratio_, 0.50);

    last_cmd_time_ = ros::Time(0);
    last_heartbeat_time_ = ros::Time(0);
    test_cmd_time_ = ros::Time(0);

    double correction_x_limit = max_linear_x_ * cruise_correction_ratio_;
    double correction_y_limit = max_linear_y_ * cruise_correction_ratio_;
    pid_x_ = PIDController(0.35, 0.03, 0.0, correction_x_limit);
    pid_y_ = PIDController(0.35, 0.03, 0.0, correction_y_limit);

    cmd_pub_ = nh_.advertise<geometry_msgs::Twist>(output_topic_, 10);
    status_pub_ = nh_.advertise<std_msgs::String>(status_topic_, 10, true);  // latched
    cruise_status_pub_ = nh_.advertise<std_msgs::String>("/web/cruise_status", 10, true);

    cmd_sub_ = nh_.subscribe(input_topic_, 10, &CmdVelWebAdapter::cmdCallback, this);
    heartbeat_sub_ = nh_.subscribe(heartbeat_topic_, 5, &CmdVelWebAdapter::heartbeatCallback, this);
    estop_sub_ = nh_.subscribe(estop_topic_, 5, &CmdVelWebAdapter::estopCallback, this);
    cruise_cmd_sub_ = nh_.subscribe(cruise_cmd_topic_, 5, &CmdVelWebAdapter::cruiseCmdCallback, this);
    cruise_enable_sub_ = nh_.subscribe("/web/cruise_enable", 5, &CmdVelWebAdapter::cruiseEnableCallback, this);
    test_cmd_sub_ = nh_.subscribe(test_cmd_topic_, 5, &CmdVelWebAdapter::testCmdCallback, this);
    test_enable_sub_ = nh_.subscribe(test_enable_topic_, 5, &CmdVelWebAdapter::testEnableCallback, this);
    odom_sub_ = nh_.subscribe(odom_topic_, 20, &CmdVelWebAdapter::odomCallback, this);

    publishStatus("idle");

    ROS_INFO("web_cmd_vel_adapter ready: %s -> %s (cmd_timeout=%.2fs, heartbeat_timeout=%.2fs)",
             input_topic_.c_str(), output_topic_.c_str(), cmd_timeout_, heartbeat_timeout_);
}

double CmdVelWebAdapter::clampValue(double value, double limit) const {
    if (value > limit) return limit;
    if (value < -limit) return -limit;
    return value;
}

double CmdVelWebAdapter::shapeAxis(double value, double limit, double deadband, double min_ratio) const {
    if (limit <= 0.0) return 0.0;
    double magnitude = fabs(value);
    if (magnitude <= 0.0) return 0.0;
    double normalized = std::min(1.0, magnitude / limit);
    if (normalized <= deadband) return 0.0;
    double span = std::max(1e-6, 1.0 - deadband);
    normalized = (normalized - deadband) / span;
    double shaped = min_ratio + (1.0 - min_ratio) * pow(normalized, response_exponent_);
    return (value >= 0.0) ? shaped * limit : -shaped * limit;
}

geometry_msgs::Twist CmdVelWebAdapter::zeroTwist() const {
    geometry_msgs::Twist t;
    t.linear.x = 0; t.linear.y = 0; t.linear.z = 0;
    t.angular.x = 0; t.angular.y = 0; t.angular.z = 0;
    return t;
}

void CmdVelWebAdapter::publishStatus(const std::string& status) {
    if (status != last_status_) {
        last_status_ = status;
        std_msgs::String msg;
        msg.data = status;
        status_pub_.publish(msg);
        ROS_INFO("web_cmd_vel_adapter status: %s", status.c_str());
    }
}

void CmdVelWebAdapter::publishCruiseStatus() {
    std_msgs::String msg;
    if (cruise_active_) {
        char buf[256];
        snprintf(buf, sizeof(buf),
                 "cruise: vx=%.2f(%.2f) vy=%.2f(%.2f) wz=%.2f(%.2f)",
                 cruise_target_.linear.x, current_velocity_.linear.x,
                 cruise_target_.linear.y, current_velocity_.linear.y,
                 cruise_target_.angular.z, current_velocity_.angular.z);
        msg.data = buf;
    } else {
        msg.data = "cruise: off";
    }
    cruise_status_pub_.publish(msg);
}

void CmdVelWebAdapter::cmdCallback(const geometry_msgs::Twist::ConstPtr& msg) {
    geometry_msgs::Twist limited;
    limited.linear.x = shapeAxis(clampValue(msg->linear.x, max_linear_x_),
                                  max_linear_x_, linear_deadband_, min_linear_ratio_);
    limited.linear.y = shapeAxis(clampValue(msg->linear.y, max_linear_y_),
                                  max_linear_y_, linear_deadband_, min_lateral_ratio_);
    limited.angular.z = shapeAxis(clampValue(msg->angular.z, max_angular_z_),
                                   max_angular_z_, angular_deadband_, min_angular_ratio_);
    last_cmd_ = limited;
    last_cmd_time_ = ros::Time::now();
    have_cmd_ = true;
}

void CmdVelWebAdapter::heartbeatCallback(const std_msgs::Empty::ConstPtr&) {
    last_heartbeat_time_ = ros::Time::now();
}

void CmdVelWebAdapter::estopCallback(const std_msgs::Bool::ConstPtr& msg) {
    if (msg->data) {
        estop_latched_ = true;
        if (cruise_active_) exitCruise();
        if (test_active_) exitTestMode();
        publishStatus("estop");
        cmd_pub_.publish(zeroTwist());
    } else {
        estop_latched_ = false;
        publishStatus("idle");
    }
}

void CmdVelWebAdapter::cruiseCmdCallback(const geometry_msgs::Twist::ConstPtr& msg) {
    cruise_target_.linear.x = clampValue(msg->linear.x, max_linear_x_);
    cruise_target_.linear.y = clampValue(msg->linear.y, max_linear_y_);
    cruise_target_.angular.z = clampValue(msg->angular.z, max_angular_z_);
    ROS_INFO("Cruise target set: vx=%.2f vy=%.2f wz=%.2f",
             cruise_target_.linear.x, cruise_target_.linear.y, cruise_target_.angular.z);
}

void CmdVelWebAdapter::cruiseEnableCallback(const std_msgs::Bool::ConstPtr& msg) {
    if (msg->data) {
        if (test_active_) exitTestMode();
        if (!cruise_active_) {
            enterCruise();
            ROS_INFO("Cruise enabled via /web/cruise_enable");
        }
    } else {
        if (cruise_active_) {
            exitCruise();
            ROS_INFO("Cruise disabled via /web/cruise_enable");
        }
    }
}

void CmdVelWebAdapter::testCmdCallback(const geometry_msgs::Twist::ConstPtr& msg) {
    test_target_.linear.x = clampValue(msg->linear.x, max_linear_x_);
    test_target_.linear.y = clampValue(msg->linear.y, max_linear_y_);
    test_target_.angular.z = clampValue(msg->angular.z, max_angular_z_);
    test_cmd_time_ = ros::Time::now();
}

void CmdVelWebAdapter::testEnableCallback(const std_msgs::Bool::ConstPtr& msg) {
    if (msg->data) {
        if (cruise_active_) exitCruise();
        test_active_ = true;
        test_cmd_time_ = ros::Time::now();
        publishStatus("test");
        ROS_INFO("Test mode enabled: vx=%.2f vy=%.2f wz=%.2f",
                 test_target_.linear.x, test_target_.linear.y, test_target_.angular.z);
    } else {
        exitTestMode();
    }
}

void CmdVelWebAdapter::odomCallback(const nav_msgs::Odometry::ConstPtr& msg) {
    current_velocity_.linear.x = msg->twist.twist.linear.x;
    current_velocity_.linear.y = msg->twist.twist.linear.y;
    current_velocity_.angular.z = msg->twist.twist.angular.z;
}

void CmdVelWebAdapter::enterCruise() {
    cruise_active_ = true;
    pid_x_.reset();
    pid_y_.reset();
    publishStatus("cruise");
    ROS_INFO("Cruise control activated");
}

void CmdVelWebAdapter::exitCruise() {
    if (!cruise_active_) return;
    cruise_active_ = false;
    pid_x_.reset();
    pid_y_.reset();
    publishStatus("idle");
    ROS_INFO("Cruise control deactivated");
}

void CmdVelWebAdapter::exitTestMode() {
    if (!test_active_) return;
    test_active_ = false;
    test_target_ = zeroTwist();
    publishStatus("idle");
    cmd_pub_.publish(zeroTwist());
    ROS_INFO("Test mode disabled");
}

geometry_msgs::Twist CmdVelWebAdapter::computeCruiseCmd(double dt) {
    geometry_msgs::Twist cmd;
    double correction_x = pid_x_.compute(cruise_target_.linear.x,
                                          current_velocity_.linear.x, dt);
    cmd.linear.x = clampValue(cruise_target_.linear.x + correction_x, max_linear_x_);

    double correction_y = pid_y_.compute(cruise_target_.linear.y,
                                          current_velocity_.linear.y, dt);
    cmd.linear.y = clampValue(cruise_target_.linear.y + correction_y, max_linear_y_);

    cmd.angular.z = clampValue(cruise_target_.angular.z, max_angular_z_);
    return cmd;
}

std::pair<std::string, geometry_msgs::Twist> CmdVelWebAdapter::resolveStatusAndCommand() {
    ros::Time now = ros::Time::now();

    if (estop_latched_)
        return {"estop", zeroTwist()};

    if (test_active_) {
        if (heartbeat_timeout_ > 0.0) {
            if (last_heartbeat_time_.isZero())
                return {"waiting_heartbeat", zeroTwist()};
            if ((now - last_heartbeat_time_).toSec() > heartbeat_timeout_) {
                exitTestMode();
                return {"heartbeat_timeout", zeroTwist()};
            }
        }
        if (cmd_timeout_ > 0.0 && (now - test_cmd_time_).toSec() > cmd_timeout_) {
            exitTestMode();
            return {"cmd_timeout", zeroTwist()};
        }
        return {"test", test_target_};
    }

    if (cruise_active_) {
        // Cruise is remotely supervised too. Stop when the client heartbeat
        // disappears instead of keeping the last cruise target forever.
        if (heartbeat_timeout_ > 0.0 &&
            (last_heartbeat_time_.isZero() ||
             (now - last_heartbeat_time_).toSec() > heartbeat_timeout_)) {
            exitCruise();
            return {"heartbeat_timeout", zeroTwist()};
        }
        return {"cruise", zeroTwist()};  // command computed separately
    }

    if (!have_cmd_)
        return {"idle", zeroTwist()};

    if (heartbeat_timeout_ > 0.0) {
        if (last_heartbeat_time_.isZero())
            return {"waiting_heartbeat", zeroTwist()};
        if ((now - last_heartbeat_time_).toSec() > heartbeat_timeout_)
            return {"heartbeat_timeout", zeroTwist()};
    }

    if (cmd_timeout_ > 0.0 && (now - last_cmd_time_).toSec() > cmd_timeout_)
        return {"cmd_timeout", zeroTwist()};

    return {"active", last_cmd_};
}

void CmdVelWebAdapter::onShutdown() {
    cmd_pub_.publish(zeroTwist());
}

void CmdVelWebAdapter::run() {
    ros::Rate rate(publish_rate_);
    ros::Time last_pid_time = ros::Time::now();
    geometry_msgs::Twist cruise_cmd = zeroTwist();

    while (ros::ok()) {
        auto result = resolveStatusAndCommand();
        std::string status = result.first;
        geometry_msgs::Twist manual_cmd = result.second;

        publishStatus(status);

        if (status == "cruise") {
            ros::Time now = ros::Time::now();
            double dt = (now - last_pid_time).toSec();
            if (dt > 0) {
                cruise_cmd = computeCruiseCmd(dt);
                last_pid_time = now;
            }
            cmd_pub_.publish(cruise_cmd);
            publishCruiseStatus();
        } else {
            cmd_pub_.publish(manual_cmd);
            if (status != "estop")
                publishCruiseStatus();
        }

        ros::spinOnce();
        rate.sleep();
    }
    onShutdown();
}

int main(int argc, char** argv) {
    ros::init(argc, argv, "web_cmd_vel_adapter");
    CmdVelWebAdapter adapter;
    adapter.run();
    return 0;
}
