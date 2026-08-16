#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cctype>
#include <cstdlib>
#include <deque>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#endif

#if defined(YP_ENABLE_ONNXRUNTIME)
#include <onnxruntime_cxx_api.h>
#endif

namespace tinyjson {

struct Value {
  enum Type { Null, Bool, Number, String, Array, Object } type = Null;
  bool b = false;
  double n = 0.0;
  std::string s;
  std::vector<Value> a;
  std::map<std::string, Value> o;

  bool is_null() const { return type == Null; }
  bool is_string() const { return type == String; }
  bool is_array() const { return type == Array; }
  bool is_object() const { return type == Object; }
  std::string string_or(const std::string& fallback) const { return type == String ? s : fallback; }
  double number_or(double fallback) const { return type == Number ? n : fallback; }
  bool bool_or(bool fallback) const { return type == Bool ? b : fallback; }
  const Value& get(const std::string& key) const {
    static Value null_value;
    if (type != Object) return null_value;
    auto it = o.find(key);
    return it == o.end() ? null_value : it->second;
  }
};

class Parser {
 public:
  explicit Parser(const std::string& text) : text_(text) {}
  Value parse() {
    Value v = parse_value();
    skip_ws();
    if (pos_ != text_.size()) throw std::runtime_error("unexpected trailing json");
    return v;
  }

 private:
  const std::string& text_;
  size_t pos_ = 0;

  void skip_ws() {
    while (pos_ < text_.size() && std::isspace(static_cast<unsigned char>(text_[pos_]))) pos_++;
  }

  bool consume(char c) {
    skip_ws();
    if (pos_ < text_.size() && text_[pos_] == c) {
      pos_++;
      return true;
    }
    return false;
  }

  void expect(char c) {
    if (!consume(c)) throw std::runtime_error(std::string("expected '") + c + "'");
  }

  Value parse_value() {
    skip_ws();
    if (pos_ >= text_.size()) throw std::runtime_error("unexpected end of json");
    char c = text_[pos_];
    if (c == '"') return parse_string();
    if (c == '{') return parse_object();
    if (c == '[') return parse_array();
    if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) return parse_number();
    if (text_.compare(pos_, 4, "true") == 0) {
      pos_ += 4;
      Value v;
      v.type = Value::Bool;
      v.b = true;
      return v;
    }
    if (text_.compare(pos_, 5, "false") == 0) {
      pos_ += 5;
      Value v;
      v.type = Value::Bool;
      v.b = false;
      return v;
    }
    if (text_.compare(pos_, 4, "null") == 0) {
      pos_ += 4;
      return Value();
    }
    throw std::runtime_error("bad json value");
  }

  Value parse_string() {
    expect('"');
    std::string out;
    while (pos_ < text_.size()) {
      char c = text_[pos_++];
      if (c == '"') {
        Value v;
        v.type = Value::String;
        v.s = out;
        return v;
      }
      if (c == '\\') {
        if (pos_ >= text_.size()) throw std::runtime_error("bad json escape");
        char e = text_[pos_++];
        if (e == '"' || e == '\\' || e == '/') out.push_back(e);
        else if (e == 'b') out.push_back('\b');
        else if (e == 'f') out.push_back('\f');
        else if (e == 'n') out.push_back('\n');
        else if (e == 'r') out.push_back('\r');
        else if (e == 't') out.push_back('\t');
        else throw std::runtime_error("unsupported json escape");
      } else {
        out.push_back(c);
      }
    }
    throw std::runtime_error("unterminated json string");
  }

  Value parse_number() {
    skip_ws();
    const char* begin = text_.c_str() + pos_;
    char* end = nullptr;
    double number = std::strtod(begin, &end);
    if (end == begin) throw std::runtime_error("bad json number");
    pos_ += static_cast<size_t>(end - begin);
    Value v;
    v.type = Value::Number;
    v.n = number;
    return v;
  }

  Value parse_array() {
    expect('[');
    Value v;
    v.type = Value::Array;
    if (consume(']')) return v;
    while (true) {
      v.a.push_back(parse_value());
      if (consume(']')) return v;
      expect(',');
    }
  }

  Value parse_object() {
    expect('{');
    Value v;
    v.type = Value::Object;
    if (consume('}')) return v;
    while (true) {
      Value key = parse_string();
      expect(':');
      v.o[key.s] = parse_value();
      if (consume('}')) return v;
      expect(',');
    }
  }
};

static std::string escape(const std::string& s) {
  std::ostringstream out;
  for (char c : s) {
    if (c == '"' || c == '\\') out << '\\' << c;
    else if (c == '\n') out << "\\n";
    else if (c == '\r') out << "\\r";
    else if (c == '\t') out << "\\t";
    else out << c;
  }
  return out.str();
}

static std::string quote(const std::string& s) { return "\"" + escape(s) + "\""; }

}  // namespace tinyjson

using tinyjson::Value;

struct ModelConfig {
  std::string backend = "onnxruntime";
  std::string model_path;
  std::string scaler_path;
  std::string guard_config_path;
  std::vector<std::string> labels;
  std::vector<int64_t> input_shape = {1, 15, 50};
  bool prefer_cuda = true;
};

struct GuardConfig {
  int window_size = 50;
  int input_channels = 15;
  double static_linear_speed_threshold = 0.08;
  double static_angular_speed_threshold = 0.08;
  double static_wheel_speed_threshold = 0.08;
  int static_required_windows = 5;
  int vote_window_size = 5;
  int vote_required_count = 3;
  double low_confidence_threshold = 0.70;
  double margin_threshold = 0.15;
  std::string static_display_label = "normal_static";
  std::string static_report_label = "normal";
  bool ambiguous_pair_hold_enabled = true;
};

struct MotionStats {
  double linear_speed_mean = 0.0;
  double linear_speed_max = 0.0;
  double angular_speed_mean = 0.0;
  double angular_speed_max = 0.0;
  double wheel_speed_mean_abs = 0.0;
  double wheel_speed_max_abs = 0.0;
};

struct GuardDecision {
  size_t class_id = 0;
  std::string class_name;
  double confidence = 0.0;
  std::string raw_model_label;
  double raw_model_prob = 0.0;
  std::string stable_label;
  double stable_prob = 0.0;
  bool is_static = false;
  bool is_low_confidence = false;
  bool ambiguous_slip_eccentricity = false;
  std::vector<std::string> top2_labels;
  std::vector<double> top2_probs;
  MotionStats motion_stats;
};

struct Scaler {
  std::string type = "identity";
  std::vector<float> min;
  std::vector<float> scale;
  std::vector<float> mean;

  std::vector<float> transform_window(const std::vector<std::vector<float>>& rows) const {
    if (rows.size() != 50) throw std::runtime_error("predict window must contain 50 rows");
    std::vector<float> out(15 * 50, 0.0f);
    for (size_t t = 0; t < rows.size(); ++t) {
      if (rows[t].size() != 15) throw std::runtime_error("each predict row must contain 15 features");
      for (size_t c = 0; c < 15; ++c) {
        float v = rows[t][c];
        if (type == "minmax") {
          v = v * scale.at(c) + min.at(c);
        } else if (type == "standard") {
          v = (v - mean.at(c)) / scale.at(c);
        }
        out[c * 50 + t] = v;
      }
    }
    return out;
  }
};

struct PredictResult {
  std::vector<float> logits;
  std::string backend;
  std::string device;
};

class IInferenceBackend {
 public:
  virtual ~IInferenceBackend() = default;
  virtual void load(const ModelConfig& config) = 0;
  virtual PredictResult predict(const std::vector<float>& input, const std::vector<int64_t>& shape) = 0;
  virtual std::string status_json() const = 0;
  virtual void unload() = 0;
};

class UnavailableBackend : public IInferenceBackend {
 public:
  UnavailableBackend(std::string name, std::string reason) : name_(std::move(name)), reason_(std::move(reason)) {}
  void load(const ModelConfig&) override { throw std::runtime_error(name_ + " backend unavailable: " + reason_); }
  PredictResult predict(const std::vector<float>&, const std::vector<int64_t>&) override {
    throw std::runtime_error(name_ + " backend unavailable: " + reason_);
  }
  std::string status_json() const override {
    return "{\"backend\":" + tinyjson::quote(name_) + ",\"available\":false,\"device\":\"unavailable\",\"error\":" +
           tinyjson::quote(reason_) + "}";
  }
  void unload() override {}

 private:
  std::string name_;
  std::string reason_;
};

#if defined(YP_ENABLE_ONNXRUNTIME)
static std::basic_string<ORTCHAR_T> ort_path(const std::string& path) {
#if defined(_WIN32)
  int size = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, nullptr, 0);
  std::wstring out(static_cast<size_t>(std::max(size - 1, 0)), L'\0');
  if (size > 1) MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &out[0], size);
  return out;
#else
  return path;
#endif
}

class OnnxRuntimeBackend : public IInferenceBackend {
 public:
  OnnxRuntimeBackend() : env_(ORT_LOGGING_LEVEL_WARNING, "yp_fault_infer") {}

  void load(const ModelConfig& config) override {
    unload();
    config_ = config;
    Ort::SessionOptions options;
    options.SetIntraOpNumThreads(1);
    options.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_EXTENDED);
    provider_ = "CPUExecutionProvider";

    session_.reset(new Ort::Session(env_, ort_path(config.model_path).c_str(), options));
    loaded_ = true;
  }

  PredictResult predict(const std::vector<float>& input, const std::vector<int64_t>& shape) override {
    if (!loaded_ || !session_) throw std::runtime_error("model is not loaded");
    Ort::MemoryInfo memory = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    Ort::Value tensor = Ort::Value::CreateTensor<float>(
        memory, const_cast<float*>(input.data()), input.size(), shape.data(), shape.size());
    const char* input_names[] = {"input"};
    const char* output_names[] = {"logits"};
    auto outputs = session_->Run(Ort::RunOptions{nullptr}, input_names, &tensor, 1, output_names, 1);
    float* raw = outputs.front().GetTensorMutableData<float>();
    auto info = outputs.front().GetTensorTypeAndShapeInfo();
    size_t count = info.GetElementCount();
    PredictResult result;
    result.logits.assign(raw, raw + count);
    result.backend = "onnxruntime";
    result.device = provider_;
    return result;
  }

  std::string status_json() const override {
    return std::string("{\"backend\":\"onnxruntime\",\"available\":true,\"loaded\":") +
           (loaded_ ? "true" : "false") + ",\"device\":" + tinyjson::quote(provider_) + ",\"error\":\"\"}";
  }

  void unload() override {
    session_.reset();
    loaded_ = false;
  }

 private:
  Ort::Env env_;
  std::unique_ptr<Ort::Session> session_;
  ModelConfig config_;
  std::string provider_ = "CPUExecutionProvider";
  bool loaded_ = false;
};
#endif

static std::string read_text_file(const std::string& path) {
  std::ifstream in(path.c_str(), std::ios::in | std::ios::binary);
  if (!in) throw std::runtime_error("cannot read file: " + path);
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

static bool file_exists(const std::string& path) {
  std::ifstream in(path.c_str(), std::ios::in | std::ios::binary);
  return static_cast<bool>(in);
}

static bool is_absolute_path(const std::string& path) {
  if (path.empty()) return false;
  if (path[0] == '/' || path[0] == '\\') return true;
  return path.size() > 2 && std::isalpha(static_cast<unsigned char>(path[0])) && path[1] == ':';
}

static std::string parent_dir(const std::string& path) {
  size_t pos = path.find_last_of("/\\");
  return pos == std::string::npos ? "." : path.substr(0, pos);
}

static std::string resolve_path(const std::string& base_dir, const std::string& path) {
  if (path.empty() || is_absolute_path(path)) return path;
#if defined(_WIN32)
  return base_dir + "\\" + path;
#else
  return base_dir + "/" + path;
#endif
}

static std::vector<float> number_array(const Value& v) {
  if (!v.is_array()) return {};
  std::vector<float> out;
  for (const auto& item : v.a) out.push_back(static_cast<float>(item.number_or(0.0)));
  return out;
}

static std::vector<int64_t> int_array(const Value& v) {
  std::vector<int64_t> out;
  if (!v.is_array()) return out;
  for (const auto& item : v.a) out.push_back(static_cast<int64_t>(item.number_or(0.0)));
  return out;
}

static ModelConfig parse_manifest(const std::string& path) {
  Value root = tinyjson::Parser(read_text_file(path)).parse();
  std::string base_dir = parent_dir(path);
  ModelConfig cfg;
  cfg.backend = root.get("backend").string_or("onnxruntime");
  cfg.model_path = resolve_path(base_dir, root.get("model_path").string_or(root.get("onnx_path").string_or("")));
  cfg.scaler_path = resolve_path(base_dir, root.get("scaler_path").string_or(""));
  cfg.guard_config_path = resolve_path(
      base_dir, root.get("guard_config_path").string_or("realtime_sage_cnn_guard_config.json"));
  cfg.prefer_cuda = root.get("runtime_options").get("prefer_cuda").bool_or(true);
  auto shape = int_array(root.get("input_shape"));
  if (shape.size() == 2) cfg.input_shape = {1, shape[0], shape[1]};
  if (shape.size() == 3) cfg.input_shape = shape;

  const Value& labels = root.get("labels");
  if (labels.is_array()) {
    for (const auto& label : labels.a) cfg.labels.push_back(label.string_or(""));
  } else if (labels.is_object()) {
    cfg.labels.resize(labels.o.size());
    for (const auto& kv : labels.o) {
      int index = std::atoi(kv.first.c_str());
      if (index >= 0 && static_cast<size_t>(index) < cfg.labels.size()) cfg.labels[index] = kv.second.string_or(kv.first);
    }
  }
  if (cfg.labels.empty()) cfg.labels = {"normal", "drive_abnormal", "wheel_slip", "shaft_eccentricity"};
  if (cfg.model_path.empty()) throw std::runtime_error("manifest is missing model_path");
  if (cfg.scaler_path.empty()) throw std::runtime_error("manifest is missing scaler_path");
  return cfg;
}

static Scaler parse_scaler(const std::string& path) {
  Value root = tinyjson::Parser(read_text_file(path)).parse();
  Scaler scaler;
  scaler.type = root.get("type").string_or("identity");
  scaler.min = number_array(root.get("min"));
  if (scaler.min.empty()) scaler.min = number_array(root.get("min_"));
  scaler.scale = number_array(root.get("scale"));
  if (scaler.scale.empty()) scaler.scale = number_array(root.get("scale_"));
  scaler.mean = number_array(root.get("mean"));
  if (scaler.mean.empty()) scaler.mean = number_array(root.get("mean_"));
  if (scaler.type == "minmax" && (scaler.min.size() != 15 || scaler.scale.size() != 15)) {
    throw std::runtime_error("minmax scaler requires 15 min and 15 scale values");
  }
  if (scaler.type == "standard" && (scaler.mean.size() != 15 || scaler.scale.size() != 15)) {
    throw std::runtime_error("standard scaler requires 15 mean and 15 scale values");
  }
  return scaler;
}

static GuardConfig parse_guard_config(const std::string& path) {
  GuardConfig cfg;
  if (path.empty() || !file_exists(path)) return cfg;
  Value root = tinyjson::Parser(read_text_file(path)).parse();
  cfg.window_size = static_cast<int>(root.get("window_size").number_or(cfg.window_size));
  cfg.input_channels = static_cast<int>(root.get("input_channels").number_or(cfg.input_channels));
  cfg.static_linear_speed_threshold =
      root.get("static_linear_speed_threshold").number_or(cfg.static_linear_speed_threshold);
  cfg.static_angular_speed_threshold =
      root.get("static_angular_speed_threshold").number_or(cfg.static_angular_speed_threshold);
  cfg.static_wheel_speed_threshold =
      root.get("static_wheel_speed_threshold").number_or(cfg.static_wheel_speed_threshold);
  cfg.static_required_windows =
      static_cast<int>(root.get("static_required_windows").number_or(cfg.static_required_windows));
  cfg.vote_window_size = static_cast<int>(root.get("vote_window_size").number_or(cfg.vote_window_size));
  cfg.vote_required_count = static_cast<int>(root.get("vote_required_count").number_or(cfg.vote_required_count));
  cfg.low_confidence_threshold = root.get("low_confidence_threshold").number_or(cfg.low_confidence_threshold);
  cfg.margin_threshold = root.get("margin_threshold").number_or(cfg.margin_threshold);
  cfg.static_display_label = root.get("static_display_label").string_or(cfg.static_display_label);
  cfg.static_report_label = root.get("static_report_label").string_or(cfg.static_report_label);
  cfg.ambiguous_pair_hold_enabled =
      root.get("ambiguous_pair_hold_enabled").bool_or(cfg.ambiguous_pair_hold_enabled);
  cfg.window_size = std::max(cfg.window_size, 1);
  cfg.input_channels = std::max(cfg.input_channels, 1);
  cfg.static_required_windows = std::max(cfg.static_required_windows, 1);
  cfg.vote_window_size = std::max(cfg.vote_window_size, 1);
  cfg.vote_required_count = std::max(cfg.vote_required_count, 1);
  return cfg;
}

static std::unique_ptr<IInferenceBackend> create_backend(const std::string& name) {
  if (name == "onnxruntime") {
#if defined(YP_ENABLE_ONNXRUNTIME)
    return std::unique_ptr<IInferenceBackend>(new OnnxRuntimeBackend());
#else
    return std::unique_ptr<IInferenceBackend>(new UnavailableBackend("onnxruntime", "built without ONNX Runtime; set ONNXRUNTIME_ROOT and rebuild"));
#endif
  }
  if (name == "tensorrt") return std::unique_ptr<IInferenceBackend>(new UnavailableBackend("tensorrt", "backend reserved but not compiled"));
  if (name == "openvino") return std::unique_ptr<IInferenceBackend>(new UnavailableBackend("openvino", "backend reserved but not compiled"));
  if (name == "npu") return std::unique_ptr<IInferenceBackend>(new UnavailableBackend("npu", "backend reserved but not compiled"));
  return std::unique_ptr<IInferenceBackend>(new UnavailableBackend(name, "unknown backend"));
}

static std::vector<float> softmax(const std::vector<float>& logits) {
  if (logits.empty()) return {};
  float max_value = *std::max_element(logits.begin(), logits.end());
  std::vector<float> probs(logits.size());
  double sum = 0.0;
  for (size_t i = 0; i < logits.size(); ++i) {
    probs[i] = std::exp(logits[i] - max_value);
    sum += probs[i];
  }
  if (sum <= 0.0) return probs;
  for (float& p : probs) p = static_cast<float>(p / sum);
  return probs;
}

static std::string label_for_id(const std::vector<std::string>& labels, size_t class_id) {
  return class_id < labels.size() && !labels[class_id].empty() ? labels[class_id] : std::to_string(class_id);
}

static size_t class_id_for_label(const std::vector<std::string>& labels, const std::string& label) {
  for (size_t i = 0; i < labels.size(); ++i) {
    if (labels[i] == label) return i;
  }
  return 0;
}

static void append_json_number_array(std::ostringstream& out, const std::vector<double>& values) {
  out << "[";
  for (size_t i = 0; i < values.size(); ++i) {
    if (i) out << ",";
    out << values[i];
  }
  out << "]";
}

static void append_json_string_array(std::ostringstream& out, const std::vector<std::string>& values) {
  out << "[";
  for (size_t i = 0; i < values.size(); ++i) {
    if (i) out << ",";
    out << tinyjson::quote(values[i]);
  }
  out << "]";
}

static void append_motion_stats_json(std::ostringstream& out, const MotionStats& stats) {
  out << "{\"linear_speed_mean\":" << stats.linear_speed_mean
      << ",\"linear_speed_max\":" << stats.linear_speed_max
      << ",\"angular_speed_mean\":" << stats.angular_speed_mean
      << ",\"angular_speed_max\":" << stats.angular_speed_max
      << ",\"wheel_speed_mean_abs\":" << stats.wheel_speed_mean_abs
      << ",\"wheel_speed_max_abs\":" << stats.wheel_speed_max_abs << "}";
}

static std::vector<std::vector<float>> parse_window(const Value& root) {
  const Value& arr = root.get("params").get("window");
  if (!arr.is_array()) throw std::runtime_error("predict params.window must be an array");
  std::vector<std::vector<float>> rows;
  for (const auto& row : arr.a) {
    if (!row.is_array()) throw std::runtime_error("predict window row must be an array");
    rows.push_back(number_array(row));
  }
  return rows;
}

class RealtimeGuard {
 public:
  void configure(const GuardConfig& config, const std::vector<std::string>& labels) {
    config_ = config;
    labels_ = labels;
    reset();
  }

  void reset() {
    static_history_.clear();
    pred_history_.clear();
    stable_label_.clear();
    stable_prob_ = 0.0;
  }

  MotionStats motion_stats(const std::vector<std::vector<float>>& rows) const {
    if (rows.size() != static_cast<size_t>(config_.window_size)) {
      throw std::runtime_error("guard window size does not match config");
    }
    MotionStats stats;
    double linear_sum = 0.0;
    double angular_sum = 0.0;
    double wheel_sum = 0.0;
    size_t wheel_count = 0;
    for (const auto& row : rows) {
      if (row.size() < static_cast<size_t>(config_.input_channels)) {
        throw std::runtime_error("guard input channels do not match window row");
      }
      double linear = std::sqrt(static_cast<double>(row[0]) * row[0] + static_cast<double>(row[1]) * row[1]);
      double angular = std::fabs(static_cast<double>(row[2]));
      linear_sum += std::fabs(linear);
      angular_sum += angular;
      stats.linear_speed_max = std::max(stats.linear_speed_max, std::fabs(linear));
      stats.angular_speed_max = std::max(stats.angular_speed_max, angular);
      for (size_t c = 3; c < 6 && c < row.size(); ++c) {
        double wheel = std::fabs(static_cast<double>(row[c]));
        wheel_sum += wheel;
        wheel_count++;
        stats.wheel_speed_max_abs = std::max(stats.wheel_speed_max_abs, wheel);
      }
    }
    double row_count = static_cast<double>(rows.size());
    stats.linear_speed_mean = row_count > 0.0 ? linear_sum / row_count : 0.0;
    stats.angular_speed_mean = row_count > 0.0 ? angular_sum / row_count : 0.0;
    stats.wheel_speed_mean_abs = wheel_count > 0 ? wheel_sum / static_cast<double>(wheel_count) : 0.0;
    return stats;
  }

  bool is_static_window(const MotionStats& stats) const {
    return stats.linear_speed_mean < config_.static_linear_speed_threshold &&
           stats.angular_speed_mean < config_.static_angular_speed_threshold &&
           stats.wheel_speed_mean_abs < config_.static_wheel_speed_threshold;
  }

  bool update_static_history(bool is_static) {
    static_history_.push_back(is_static);
    while (static_history_.size() > static_cast<size_t>(config_.static_required_windows)) {
      static_history_.pop_front();
    }
    if (static_history_.size() != static_cast<size_t>(config_.static_required_windows)) return false;
    for (bool item : static_history_) {
      if (!item) return false;
    }
    return true;
  }

  GuardDecision static_result(const MotionStats& stats) {
    stable_label_ = config_.static_display_label;
    stable_prob_ = 1.0;
    pred_history_.clear();

    GuardDecision decision;
    decision.class_id = class_id_for_label(labels_, config_.static_report_label);
    decision.class_name = config_.static_display_label;
    decision.confidence = 1.0;
    decision.raw_model_label = "skipped_static_gate";
    decision.raw_model_prob = 1.0;
    decision.stable_label = config_.static_display_label;
    decision.stable_prob = 1.0;
    decision.is_static = true;
    decision.top2_labels = {config_.static_report_label, "skipped"};
    decision.top2_probs = {1.0, 0.0};
    decision.motion_stats = stats;
    return decision;
  }

  GuardDecision update_from_probabilities(const std::vector<float>& probs, const MotionStats& stats) {
    if (probs.size() < 2) throw std::runtime_error("guard requires at least two class probabilities");
    std::vector<size_t> order(probs.size());
    for (size_t i = 0; i < probs.size(); ++i) order[i] = i;
    std::sort(order.begin(), order.end(), [&](size_t a, size_t b) { return probs[a] > probs[b]; });

    size_t top1 = order[0];
    size_t top2 = order[1];
    double top1_prob = probs[top1];
    double top2_prob = probs[top2];
    double margin = top1_prob - top2_prob;
    bool is_low_confidence = top1_prob < config_.low_confidence_threshold || margin < config_.margin_threshold;
    bool ambiguous = is_ambiguous_slip_eccentricity(top1, top2, margin);

    std::string raw_label = label_for_id(labels_, top1);
    std::string candidate_label = raw_label;
    std::string stable_label = stable_label_.empty() ? candidate_label : stable_label_;
    double stable_prob = stable_label_.empty() || stable_prob_ == 0.0 ? top1_prob : stable_prob_;

    if (ambiguous && config_.ambiguous_pair_hold_enabled && !stable_label_.empty()) {
      stable_label = stable_label_;
      stable_prob = stable_prob_;
    } else if (!is_low_confidence) {
      pred_history_.push_back(std::make_pair(candidate_label, top1_prob));
      while (pred_history_.size() > static_cast<size_t>(config_.vote_window_size)) pred_history_.pop_front();
      std::map<std::string, int> counts;
      for (const auto& item : pred_history_) counts[item.first]++;
      std::string vote_label;
      int vote_count = 0;
      for (const auto& kv : counts) {
        if (kv.second > vote_count) {
          vote_label = kv.first;
          vote_count = kv.second;
        }
      }
      if (vote_count >= config_.vote_required_count) {
        stable_label = vote_label;
        stable_prob = mean_prob_for_label(vote_label);
        stable_label_ = stable_label;
        stable_prob_ = stable_prob;
      }
    } else if (stable_label_.empty()) {
      pred_history_.push_back(std::make_pair(candidate_label, top1_prob));
      while (pred_history_.size() > static_cast<size_t>(config_.vote_window_size)) pred_history_.pop_front();
      stable_label_ = stable_label;
      stable_prob_ = stable_prob;
    }

    GuardDecision decision;
    decision.class_id = class_id_for_label(labels_, stable_label);
    decision.class_name = stable_label;
    decision.confidence = stable_prob;
    decision.raw_model_label = raw_label;
    decision.raw_model_prob = top1_prob;
    decision.stable_label = stable_label;
    decision.stable_prob = stable_prob;
    decision.is_static = false;
    decision.is_low_confidence = is_low_confidence;
    decision.ambiguous_slip_eccentricity = ambiguous;
    decision.top2_labels = {label_for_id(labels_, top1), label_for_id(labels_, top2)};
    decision.top2_probs = {top1_prob, top2_prob};
    decision.motion_stats = stats;
    return decision;
  }

  std::string status_json(const std::string& config_path) const {
    std::ostringstream out;
    out << "{\"enabled\":true"
        << ",\"config_path\":" << tinyjson::quote(file_exists(config_path) ? config_path : "")
        << ",\"static_required_windows\":" << config_.static_required_windows
        << ",\"vote_window_size\":" << config_.vote_window_size
        << ",\"vote_required_count\":" << config_.vote_required_count
        << ",\"low_confidence_threshold\":" << config_.low_confidence_threshold
        << ",\"margin_threshold\":" << config_.margin_threshold << "}";
    return out.str();
  }

 private:
  bool is_ambiguous_slip_eccentricity(size_t top1, size_t top2, double margin) const {
    std::string a = label_for_id(labels_, top1);
    std::string b = label_for_id(labels_, top2);
    bool pair = (a == "wheel_slip" && b == "shaft_eccentricity") ||
                (a == "shaft_eccentricity" && b == "wheel_slip");
    return pair && margin < config_.margin_threshold;
  }

  double mean_prob_for_label(const std::string& label) const {
    double sum = 0.0;
    int count = 0;
    for (const auto& item : pred_history_) {
      if (item.first == label) {
        sum += item.second;
        count++;
      }
    }
    return count > 0 ? sum / static_cast<double>(count) : 0.0;
  }

  GuardConfig config_;
  std::vector<std::string> labels_;
  std::deque<bool> static_history_;
  std::deque<std::pair<std::string, double>> pred_history_;
  std::string stable_label_;
  double stable_prob_ = 0.0;
};

class App {
 public:
  std::string handle(const std::string& line) {
    Value req = tinyjson::Parser(line).parse();
    std::string id = request_id(req);
    std::string method = req.get("method").string_or("");
    try {
      if (method == "load_model" || method == "reload_model") return ok(id, load_model(req));
      if (method == "predict") return ok(id, predict(req));
      if (method == "status") return ok(id, status());
      if (method == "list_backends") return ok(id, list_backends());
      if (method == "shutdown") {
        should_exit_ = true;
        return ok(id, "{\"ok\":true}");
      }
      throw std::runtime_error("unknown method: " + method);
    } catch (const std::exception& e) {
      return err(id, e.what());
    }
  }

  bool should_exit() const { return should_exit_; }

 private:
  std::unique_ptr<IInferenceBackend> backend_;
  ModelConfig config_;
  Scaler scaler_;
  GuardConfig guard_config_;
  RealtimeGuard guard_;
  bool loaded_ = false;
  bool should_exit_ = false;

  static std::string request_id(const Value& req) {
    const Value& id = req.get("id");
    if (id.is_string()) return tinyjson::quote(id.s);
    if (id.type == Value::Number) {
      std::ostringstream ss;
      ss << static_cast<long long>(id.n);
      return ss.str();
    }
    return "null";
  }

  static std::string ok(const std::string& id, const std::string& result) {
    return "{\"id\":" + id + ",\"ok\":true,\"result\":" + result + "}";
  }

  static std::string err(const std::string& id, const std::string& message) {
    return "{\"id\":" + id + ",\"ok\":false,\"error\":" + tinyjson::quote(message) + "}";
  }

  std::string load_model(const Value& req) {
    std::string manifest_path = req.get("params").get("manifest_path").string_or("");
    if (manifest_path.empty()) throw std::runtime_error("load_model requires params.manifest_path");
    config_ = parse_manifest(manifest_path);
    scaler_ = parse_scaler(config_.scaler_path);
    guard_config_ = parse_guard_config(config_.guard_config_path);
    guard_.configure(guard_config_, config_.labels);
    backend_ = create_backend(config_.backend);
    backend_->load(config_);
    loaded_ = true;
    return status();
  }

  std::string predict(const Value& req) {
    if (!loaded_ || !backend_) throw std::runtime_error("model is not loaded");
    auto started = std::chrono::steady_clock::now();
    std::vector<std::vector<float>> rows = parse_window(req);
    MotionStats stats = guard_.motion_stats(rows);
    bool is_static = guard_.is_static_window(stats);
    bool static_confirmed = guard_.update_static_history(is_static);
    if (static_confirmed) {
      GuardDecision decision = guard_.static_result(stats);
      auto finished = std::chrono::steady_clock::now();
      double latency = std::chrono::duration<double, std::milli>(finished - started).count();
      std::vector<float> static_probs(config_.labels.size(), 0.0f);
      if (!static_probs.empty() && decision.class_id < static_probs.size()) static_probs[decision.class_id] = 1.0f;
      return guarded_result_json(decision, static_probs, latency, "guard", "static_gate", "");
    }

    std::vector<float> tensor = scaler_.transform_window(rows);
    PredictResult raw = backend_->predict(tensor, config_.input_shape);
    std::vector<float> probs = softmax(raw.logits);
    if (probs.empty()) throw std::runtime_error("backend returned empty logits");
    GuardDecision decision = guard_.update_from_probabilities(probs, stats);
    auto finished = std::chrono::steady_clock::now();
    double latency = std::chrono::duration<double, std::milli>(finished - started).count();
    return guarded_result_json(decision, probs, latency, raw.backend, raw.device, "");
  }

  std::string guarded_result_json(const GuardDecision& decision,
                                  const std::vector<float>& probs,
                                  double latency,
                                  const std::string& backend,
                                  const std::string& device,
                                  const std::string& error) const {
    std::ostringstream out;
    out << "{\"class_id\":" << decision.class_id
        << ",\"class_name\":" << tinyjson::quote(decision.class_name)
        << ",\"confidence\":" << decision.confidence
        << ",\"probabilities\":[";
    for (size_t i = 0; i < probs.size(); ++i) {
      if (i) out << ",";
      out << probs[i];
    }
    out << "]";
    out << ",\"raw_model_label\":" << tinyjson::quote(decision.raw_model_label)
        << ",\"raw_model_prob\":" << decision.raw_model_prob
        << ",\"stable_label\":" << tinyjson::quote(decision.stable_label)
        << ",\"stable_prob\":" << decision.stable_prob
        << ",\"is_static\":" << (decision.is_static ? "true" : "false")
        << ",\"is_low_confidence\":" << (decision.is_low_confidence ? "true" : "false")
        << ",\"ambiguous_slip_eccentricity\":" << (decision.ambiguous_slip_eccentricity ? "true" : "false")
        << ",\"top2_labels\":";
    append_json_string_array(out, decision.top2_labels);
    out << ",\"top2_probs\":";
    append_json_number_array(out, decision.top2_probs);
    out << ",\"motion_stats\":";
    append_motion_stats_json(out, decision.motion_stats);
    out << ",\"latency_ms\":" << latency
        << ",\"backend\":" << tinyjson::quote(backend)
        << ",\"device\":" << tinyjson::quote(device)
        << ",\"error\":" << tinyjson::quote(error) << "}";
    return out.str();
  }

  std::string status() const {
    if (!backend_) {
      return "{\"loaded\":false,\"backend\":\"none\",\"device\":\"none\",\"error\":\"model not loaded\"}";
    }
    std::string backend_status = backend_->status_json();
    return "{\"loaded\":" + std::string(loaded_ ? "true" : "false") + ",\"backend_status\":" + backend_status +
           ",\"guard_status\":" + guard_.status_json(config_.guard_config_path) + "}";
  }

  std::string list_backends() const {
    return "{\"backends\":["
#if defined(YP_ENABLE_ONNXRUNTIME)
           "{\"name\":\"onnxruntime\",\"available\":true},"
#else
           "{\"name\":\"onnxruntime\",\"available\":false,\"error\":\"built without ONNX Runtime\"},"
#endif
           "{\"name\":\"tensorrt\",\"available\":false,\"error\":\"reserved but not compiled\"},"
           "{\"name\":\"openvino\",\"available\":false,\"error\":\"reserved but not compiled\"},"
           "{\"name\":\"npu\",\"available\":false,\"error\":\"reserved but not compiled\"}"
           "]}";
  }
};

int main() {
  App app;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    try {
      std::cout << app.handle(line) << std::endl;
    } catch (const std::exception& e) {
      std::cout << "{\"id\":null,\"ok\":false,\"error\":" << tinyjson::quote(e.what()) << "}" << std::endl;
    }
    if (app.should_exit()) break;
  }
  return 0;
}
