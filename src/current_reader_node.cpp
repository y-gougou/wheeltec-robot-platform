#include "current_reader_node.h"
#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iomanip>
#include <sstream>
#include <stdexcept>

static const std::string FRAME_HEADER = "$CURRENT,";
static const std::string FRAME_TAIL = "*";

CurrentReader::CurrentReader()
    : read_count_(0), valid_count_(0), total_valid_count_(0),
      timeout_count_(0), parse_error_count_(0), checksum_error_count_(0),
      seq_gap_count_(0), last_seq_(-1), last_current_time_(0.0),
      last_connect_attempt_(0.0), connected_(false),
      has_pending_config_(false), cfg_baud_(0), cfg_timeout_(0.0),
      cfg_reconnect_(false)
{
    ros::NodeHandle private_nh("~");

    private_nh.param<std::string>("port", port_, "/dev/ttyUSB1");
    private_nh.param("baud", baud_, 115200);
    private_nh.param("timeout", timeout_, 0.05);
    private_nh.param("open_retries", open_retries_, 3);
    private_nh.param("open_retry_delay", open_retry_delay_, 1.0);
    private_nh.param("loop_rate", loop_rate_, 200.0);
    private_nh.param("report_interval", report_interval_, 5.0);
    private_nh.param("max_frames_per_cycle", max_frames_per_cycle_, 20);
    private_nh.param<std::string>("config_topic", config_topic_, "/web/current_reader_config");
    private_nh.param<std::string>("status_topic", status_topic_, "/web/current_reader_status");

    data_pub_ = nh_.advertise<std_msgs::Float32MultiArray>("/current_data", 10);
    status_pub_ = nh_.advertise<std_msgs::String>(status_topic_, 1, true);  // latched
    config_sub_ = nh_.subscribe(config_topic_, 5, &CurrentReader::configCallback, this);

    last_report_time_ = ros::Time::now().toSec();
    connect();
}

CurrentReader::~CurrentReader() {
    disconnect();
}

unsigned char CurrentReader::xorChecksum(const std::string& payload) {
    unsigned char checksum = 0;
    for (size_t i = 0; i < payload.size(); ++i)
        checksum ^= static_cast<unsigned char>(payload[i]);
    return checksum;
}

bool CurrentReader::openSerialWithRetries() {
    serial::Serial* ser = &serial_port_;
    for (int attempt = 1; attempt <= open_retries_; ++attempt) {
        ROS_INFO("Opening current serial port %s @ %d (%d/%d)",
                 port_.c_str(), baud_, attempt, open_retries_);
        try {
            ser->setPort(port_);
            ser->setBaudrate(baud_);
            serial::Timeout to = serial::Timeout::simpleTimeout(
                static_cast<uint32_t>(timeout_ * 1000));
            ser->setTimeout(to);
            ser->open();
            ROS_INFO("Current serial port opened: %s", port_.c_str());
            return true;
        } catch (serial::IOException& e) {
            ROS_WARN("Open %s failed: %s; retry in %.1fs",
                     port_.c_str(), e.what(), open_retry_delay_);
            if (attempt < open_retries_ && ros::ok())
                ros::Duration(open_retry_delay_).sleep();
        } catch (const std::exception& e) {
            ROS_WARN("Configure/open %s failed: %s; retry in %.1fs",
                     port_.c_str(), e.what(), open_retry_delay_);
            if (attempt < open_retries_ && ros::ok())
                ros::Duration(open_retry_delay_).sleep();
        }
    }
    return false;
}

bool CurrentReader::connect() {
    last_connect_attempt_ = ros::Time::now().toSec();
    disconnect();
    if (openSerialWithRetries()) {
        serial_port_.flushInput();
        connected_ = true;
        last_error_.clear();
        publishStatus();
        return true;
    }
    last_error_ = "open failed";
    connected_ = false;
    publishStatus();
    return false;
}

void CurrentReader::disconnect() {
    if (serial_port_.isOpen()) {
        serial_port_.close();
        ROS_INFO("Current serial port closed");
    }
    connected_ = false;
}

void CurrentReader::configCallback(const std_msgs::String::ConstPtr& msg) {
    // Accept both the original key=value format and the JSON object emitted by
    // the Web/Electron clients. Values used here do not contain commas.
    std::string data = msg->data;
    if (data.find('{') != std::string::npos) {
        std::string normalized;
        for (size_t i = 0; i < data.size(); ++i) {
            const char c = data[i];
            if (c == '{' || c == '}' || c == '"' || std::isspace(static_cast<unsigned char>(c)))
                continue;
            normalized.push_back(c == ':' ? '=' : c);
        }
        data.swap(normalized);
    } else if (data == "reconnect") {
        data = "reconnect=true";
    }
    // Parse simple key=value pairs
    std::istringstream ss(data);
    std::string token;
    while (std::getline(ss, token, ',')) {
        size_t eq = token.find('=');
        if (eq == std::string::npos) continue;
        std::string key = token.substr(0, eq);
        std::string val = token.substr(eq + 1);
        if (key == "port") { cfg_port_ = val; has_pending_config_ = true; }
        else if (key == "baud") { cfg_baud_ = std::atoi(val.c_str()); has_pending_config_ = true; }
        else if (key == "timeout") { cfg_timeout_ = std::atof(val.c_str()); has_pending_config_ = true; }
        else if (key == "reconnect") {
            cfg_reconnect_ = (val != "false" && val != "0");
            has_pending_config_ = true;
        }
    }
}

void CurrentReader::applyPendingConfig() {
    if (!has_pending_config_) return;
    has_pending_config_ = false;

    bool changed = false;
    if (!cfg_port_.empty() && cfg_port_ != port_) { port_ = cfg_port_; changed = true; }
    if (cfg_baud_ > 0 && cfg_baud_ != baud_) { baud_ = cfg_baud_; changed = true; }
    if (cfg_timeout_ > 0 && fabs(cfg_timeout_ - timeout_) > 1e-6) { timeout_ = cfg_timeout_; changed = true; }

    cfg_port_.clear();
    cfg_baud_ = 0;
    cfg_timeout_ = 0;

    if (changed || cfg_reconnect_) {
        cfg_reconnect_ = false;
        ROS_INFO("Current reader reconnect requested: port=%s baud=%d", port_.c_str(), baud_);
        connect();
    } else {
        publishStatus();
    }
}

void CurrentReader::publishStatus() {
    std::ostringstream ss;
    ss << "{\"connected\":" << (connected_ ? "true" : "false")
       << ",\"port\":\"" << port_ << "\""
       << ",\"baud\":" << baud_
       << ",\"timeout\":" << std::fixed << std::setprecision(3) << timeout_
       << ",\"valid_total\":" << total_valid_count_;

    double now = ros::Time::now().toSec();
    if (last_current_time_ > 0)
        ss << ",\"last_current_age\":" << (now - last_current_time_);
    else
        ss << ",\"last_current_age\":null";

    ss << ",\"last_seq\":" << last_seq_
       << ",\"error\":\"" << last_error_ << "\"}";

    std_msgs::String msg;
    msg.data = ss.str();
    status_pub_.publish(msg);
}

std::vector<float> CurrentReader::parseFrame(const std::string& raw_line) {
    std::string line = raw_line;
    // Trim
    size_t start = line.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) { parse_error_count_++; return std::vector<float>(); }
    line = line.substr(start);
    size_t end = line.find_last_not_of(" \t\r\n");
    if (end != std::string::npos) line = line.substr(0, end + 1);

    size_t header_pos = line.find(FRAME_HEADER);
    if (header_pos == std::string::npos) { parse_error_count_++; return std::vector<float>(); }
    if (header_pos > 0) line = line.substr(header_pos);

    size_t tail_pos = line.find(FRAME_TAIL);
    if (tail_pos == std::string::npos) { parse_error_count_++; return std::vector<float>(); }

    std::string data_str = line.substr(FRAME_HEADER.size(), tail_pos - FRAME_HEADER.size());
    size_t checksum_start = tail_pos + 1;
    std::string recv_checksum_str = line.substr(checksum_start, 2);
    if (recv_checksum_str.size() != 2) { parse_error_count_++; return std::vector<float>(); }

    std::string payload_for_checksum = line.substr(0, tail_pos);
    unsigned char calc_checksum = xorChecksum(payload_for_checksum);

    unsigned int recv_checksum;
    {
        std::istringstream hex_ss(recv_checksum_str);
        hex_ss >> std::hex >> recv_checksum;
        if (hex_ss.fail()) { parse_error_count_++; return std::vector<float>(); }
    }

    if (calc_checksum != static_cast<unsigned char>(recv_checksum)) {
        checksum_error_count_++;
        return std::vector<float>();
    }

    // Split data by comma
    std::vector<std::string> parts;
    {
        std::istringstream ds(data_str);
        std::string part;
        while (std::getline(ds, part, ','))
            parts.push_back(part);
    }

    int seq = -1;
    if (parts.size() == 4) {
        seq = static_cast<int>(std::atof(parts[0].c_str()));
        parts.erase(parts.begin());
    }

    if (parts.size() != 3) { parse_error_count_++; return std::vector<float>(); }

    std::vector<float> values;
    for (int i = 0; i < 3; ++i) {
        char* endptr;
        float v = strtof(parts[i].c_str(), &endptr);
        while (endptr && std::isspace(static_cast<unsigned char>(*endptr))) ++endptr;
        if (endptr == parts[i].c_str() || (endptr && *endptr != '\0')) {
            parse_error_count_++;
            return std::vector<float>();
        }
        values.push_back(v);
    }

    if (seq >= 0) {
        if (last_seq_ >= 0 && seq != last_seq_ + 1)
            seq_gap_count_++;
        last_seq_ = seq;
        values.push_back(static_cast<float>(seq));
    }
    return values;
}

std::vector<float> CurrentReader::readFrame() {
    std::string line = serial_port_.readline(512, "\n");
    if (line.empty()) {
        timeout_count_++;
        return std::vector<float>();
    }
    read_count_++;
    return parseFrame(line);
}

void CurrentReader::publishFrame(const std::vector<float>& data) {
    std_msgs::Float32MultiArray msg;
    msg.data = data;
    data_pub_.publish(msg);
    valid_count_++;
    total_valid_count_++;
    last_current_time_ = ros::Time::now().toSec();
}

void CurrentReader::report() {
    double now = ros::Time::now().toSec();
    if (now - last_report_time_ < report_interval_) return;

    double dt = std::max(1e-6, now - last_report_time_);
    double current_age = (last_current_time_ > 0) ? (now - last_current_time_) : -1.0;
    ROS_INFO("Current reader: read_rate=%.1f Hz valid_rate=%.1f Hz read=%d valid=%d timeout=%d parse_error=%d checksum_error=%d seq_gap=%d last_seq=%d last_current_age=%.3fs",
             read_count_ / dt, valid_count_ / dt,
             read_count_, valid_count_, timeout_count_,
             parse_error_count_, checksum_error_count_, seq_gap_count_,
             last_seq_, current_age);

    read_count_ = 0;
    valid_count_ = 0;
    timeout_count_ = 0;
    parse_error_count_ = 0;
    checksum_error_count_ = 0;
    seq_gap_count_ = 0;
    last_report_time_ = now;
    publishStatus();
}

void CurrentReader::run() {
    ROS_INFO("Start reading current data from %s timeout=%.3fs loop_rate=%.1fHz",
             port_.c_str(), timeout_, loop_rate_);
    ros::Rate rate(loop_rate_);

    while (ros::ok()) {
        applyPendingConfig();

        if (!connected_ || !serial_port_.isOpen()) {
            double now = ros::Time::now().toSec();
            if (now - last_connect_attempt_ >= open_retry_delay_) {
                ROS_WARN("Current reader disconnected, retrying open: port=%s", port_.c_str());
                connect();
            } else {
                publishStatus();
            }
            ros::spinOnce();
            rate.sleep();
            continue;
        }

        int frames_read = 0;
        while (ros::ok() && frames_read < max_frames_per_cycle_) {
            std::vector<float> data;
            try {
                data = readFrame();
            } catch (serial::SerialException& e) {
                last_error_ = e.what();
                ROS_ERROR("Current reader read failed: %s", e.what());
                disconnect();
                publishStatus();
                break;
            } catch (serial::IOException& e) {
                last_error_ = e.what();
                ROS_ERROR("Current reader read failed: %s", e.what());
                disconnect();
                publishStatus();
                break;
            }
            if (!data.empty())
                publishFrame(data);
            frames_read++;
            if (serial_port_.available() <= 0)
                break;
        }
        report();
        ros::spinOnce();
        rate.sleep();
    }
}

int main(int argc, char** argv) {
    ros::init(argc, argv, "current_reader");
    CurrentReader reader;
    reader.run();
    return 0;
}
