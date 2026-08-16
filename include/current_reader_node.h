#ifndef CURRENT_READER_NODE_H
#define CURRENT_READER_NODE_H

#include <cmath>
#include <sstream>
#include <string>
#include <vector>

#include <ros/ros.h>
#include <serial/serial.h>
#include <std_msgs/Float32MultiArray.h>
#include <std_msgs/String.h>

class CurrentReader {
public:
    CurrentReader();
    ~CurrentReader();
    void run();

private:
    bool connect();
    void disconnect();
    bool openSerialWithRetries();

    void configCallback(const std_msgs::String::ConstPtr& msg);
    void applyPendingConfig();
    void publishStatus();

    std::vector<float> parseFrame(const std::string& line);
    std::vector<float> readFrame();
    void publishFrame(const std::vector<float>& data);
    void report();

    static unsigned char xorChecksum(const std::string& payload);

    ros::NodeHandle nh_;
    ros::Publisher data_pub_;
    ros::Publisher status_pub_;
    ros::Subscriber config_sub_;

    serial::Serial serial_port_;

    // Parameters
    std::string port_;
    int baud_;
    double timeout_;
    int open_retries_;
    double open_retry_delay_;
    double loop_rate_;
    double report_interval_;
    int max_frames_per_cycle_;
    std::string config_topic_;
    std::string status_topic_;

    // Counters
    int read_count_;
    int valid_count_;
    int total_valid_count_;
    int timeout_count_;
    int parse_error_count_;
    int checksum_error_count_;
    int seq_gap_count_;
    int last_seq_;
    double last_current_time_;
    double last_report_time_;
    double last_connect_attempt_;
    std::string last_error_;
    bool connected_;

    // Pending config
    bool has_pending_config_;
    std::string cfg_port_;
    int cfg_baud_;
    double cfg_timeout_;
    bool cfg_reconnect_;
};

#endif
