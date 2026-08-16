#include "wheeltec_robot.h"
#include "Quaternion_Solution.h"
#include <cstring>

sensor_msgs::Imu Mpu6050;//Instantiate an IMU object //实例化IMU对象 

static short Clamp_Alpha_Permille(float alpha)
{
  if (alpha < 0.0f)
    alpha = 0.0f;
  if (alpha > 1.0f)
    alpha = 1.0f;
  return (short)(alpha * 1000.0f + 0.5f);
}

/**************************************
Date: January 28, 2021
Function: The main function, ROS initialization, creates the Robot_control object through the Turn_on_robot class and automatically calls the constructor initialization
功能: 主函数，ROS初始化，通过turn_on_robot类创建Robot_control对象并自动调用构造函数初始化
***************************************/
int main(int argc, char** argv)
{
  ros::init(argc, argv, "wheeltec_robot"); //ROS initializes and sets the node name //ROS初始化 并设置节点名称 
  turn_on_robot Robot_Control; //Instantiate an object //实例化一个对象
  Robot_Control.Control(); //Loop through data collection and publish the topic //循环执行数据采集和发布话题等操作
  return 0;  
} 

/**************************************
Date: January 28, 2021
Function: Data conversion function
功能: 数据转换函数
***************************************/
short turn_on_robot::IMU_Trans(uint8_t Data_High,uint8_t Data_Low)
{
  short transition_16;
  transition_16 = 0;
  transition_16 |=  Data_High<<8;   
  transition_16 |=  Data_Low;
  return transition_16;     
}
float turn_on_robot::Odom_Trans(uint8_t Data_High,uint8_t Data_Low)
{
  float data_return;
  short transition_16;
  transition_16 = 0;
  transition_16 |=  Data_High<<8;  //Get the high 8 bits of data   //获取数据的高8位
  transition_16 |=  Data_Low;      //Get the lowest 8 bits of data //获取数据的低8位
  data_return   =  (transition_16 / 1000)+(transition_16 % 1000)*0.001; // The speed unit is changed from mm/s to m/s //速度单位从mm/s转换为m/s
  return data_return;
}
/**************************************
Date: January 28, 2021
Function: The speed topic subscription Callback function, according to the subscribed instructions through the serial port command control of the lower computer
功能: 速度话题订阅回调函数Callback，根据订阅的指令通过串口发指令控制下位机
***************************************/
void turn_on_robot::Send_Chassis_Command(float vx, float vy, float wz, unsigned char angle_flag, float angle_deg)
{
  short transition;

  Send_Data.tx[0]=FRAME_HEADER;
  Send_Data.tx[1]=0;
  Send_Data.tx[2]=angle_flag;

  transition = (short)(vx*1000);
  Send_Data.tx[4] = transition;
  Send_Data.tx[3] = transition>>8;

  transition = (short)(vy*1000);
  Send_Data.tx[6] = transition;
  Send_Data.tx[5] = transition>>8;

  transition = (short)(wz*1000);
  Send_Data.tx[8] = transition;
  Send_Data.tx[7] = transition>>8;

  transition = (short)(angle_deg*10);
  Send_Data.tx[10] = transition;
  Send_Data.tx[9] = transition>>8;

  Send_Data.tx[11]=Check_Sum(11,SEND_DATA_CHECK);
  Send_Data.tx[12]=FRAME_TAIL;

  try
  {
    Stm32_Serial.write(Send_Data.tx,sizeof(Send_Data.tx));
  }
  catch (serial::IOException& e)
  {
    ROS_ERROR_STREAM("Unable to send data through serial port");
  }
}

void turn_on_robot::Send_Fault_Config_Command(bool enable, unsigned char wheel_mask, float alpha_a, float alpha_b, float alpha_c)
{
  short transition;

  wheel_mask = wheel_mask & 0x07;

  Send_Data.tx[0]=FRAME_HEADER;
  Send_Data.tx[1]=4;
  Send_Data.tx[2]=1;
  Send_Data.tx[3]=enable ? 1 : 0;
  Send_Data.tx[4]=wheel_mask;

  transition = Clamp_Alpha_Permille(alpha_a);
  Send_Data.tx[6] = transition;
  Send_Data.tx[5] = transition>>8;

  transition = Clamp_Alpha_Permille(alpha_b);
  Send_Data.tx[8] = transition;
  Send_Data.tx[7] = transition>>8;

  transition = Clamp_Alpha_Permille(alpha_c);
  Send_Data.tx[10] = transition;
  Send_Data.tx[9] = transition>>8;

  Send_Data.tx[11]=Check_Sum(11,SEND_DATA_CHECK);
  Send_Data.tx[12]=FRAME_TAIL;

  try
  {
    Stm32_Serial.write(Send_Data.tx,sizeof(Send_Data.tx));
  }
  catch (serial::IOException& e)
  {
    ROS_ERROR_STREAM("Unable to send fault config through serial port");
  }
}

void turn_on_robot::Cmd_Vel_Callback(const geometry_msgs::Twist &twist_aux)
{
  Send_Chassis_Command(twist_aux.linear.x, twist_aux.linear.y, twist_aux.angular.z, 0, target_angle);
}

void turn_on_robot::Fault_Config_Callback(const std_msgs::Float32MultiArray &fault_config)
{
  if (fault_config.data.size() < 5)
  {
    ROS_WARN_STREAM("fault_config requires [enable, wheel_mask, alpha_a, alpha_b, alpha_c]");
    return;
  }

  bool enable = fault_config.data[0] > 0.5f;
  unsigned char wheel_mask = (unsigned char)((int)fault_config.data[1] & 0x07);
  Send_Fault_Config_Command(
      enable,
      wheel_mask,
      fault_config.data[2],
      fault_config.data[3],
      fault_config.data[4]);
}

void turn_on_robot::Heading_Callback(const std_msgs::Float32 &heading_msg)
{
  external_heading_deg = heading_msg.data;
  Send_Chassis_Command(0.0f, 0.0f, 0.0f, 3, external_heading_deg);
}

void turn_on_robot::Angle_Callback(const std_msgs::Float32 &angle_msg)
{
  target_angle = angle_msg.data;
  Send_Chassis_Command(0.0f, 0.0f, 0.0f, 1, target_angle);
}

void turn_on_robot::Angle_Reset_Callback(const std_msgs::Empty &reset_msg)
{
  (void)reset_msg;
  target_angle = 0.0f;
  Send_Chassis_Command(0.0f, 0.0f, 0.0f, 2, 0.0f);
}

/**************************************
Date: January 28, 2021
Function: Publish the IMU data topic
功能: 发布IMU数据话题
***************************************/
void turn_on_robot::Publish_ImuSensor()
{
  sensor_msgs::Imu Imu_Data_Pub; //Instantiate IMU topic data //实例化IMU话题数据
  Imu_Data_Pub.header.stamp = ros::Time::now(); 
  Imu_Data_Pub.header.frame_id = gyro_frame_id; //IMU corresponds to TF coordinates, which is required to use the robot_pose_ekf feature pack 
                                                //IMU对应TF坐标，使用robot_pose_ekf功能包需要设置此项
  Imu_Data_Pub.orientation.x = Mpu6050.orientation.x; //A quaternion represents a three-axis attitude //四元数表达三轴姿态
  Imu_Data_Pub.orientation.y = Mpu6050.orientation.y; 
  Imu_Data_Pub.orientation.z = Mpu6050.orientation.z;
  Imu_Data_Pub.orientation.w = Mpu6050.orientation.w;
  Imu_Data_Pub.orientation_covariance[0] = 1e6; //Three-axis attitude covariance matrix //三轴姿态协方差矩阵
  Imu_Data_Pub.orientation_covariance[4] = 1e6;
  Imu_Data_Pub.orientation_covariance[8] = 1e-6;
  Imu_Data_Pub.angular_velocity.x = Mpu6050.angular_velocity.x; //Triaxial angular velocity //三轴角速度
  Imu_Data_Pub.angular_velocity.y = Mpu6050.angular_velocity.y;
  Imu_Data_Pub.angular_velocity.z = Mpu6050.angular_velocity.z;
  Imu_Data_Pub.angular_velocity_covariance[0] = 1e6; //Triaxial angular velocity covariance matrix //三轴角速度协方差矩阵
  Imu_Data_Pub.angular_velocity_covariance[4] = 1e6;
  Imu_Data_Pub.angular_velocity_covariance[8] = 1e-6;
  Imu_Data_Pub.linear_acceleration.x = Mpu6050.linear_acceleration.x; //Triaxial acceleration //三轴线性加速度
  Imu_Data_Pub.linear_acceleration.y = Mpu6050.linear_acceleration.y; 
  Imu_Data_Pub.linear_acceleration.z = Mpu6050.linear_acceleration.z;  
  imu_publisher.publish(Imu_Data_Pub); //Pub IMU topic //发布IMU话题
}
/**************************************
Date: January 28, 2021
Function: Publish the odometer topic, Contains position, attitude, triaxial velocity, angular velocity about triaxial, TF parent-child coordinates, and covariance matrix
功能: 发布里程计话题，包含位置、姿态、三轴速度、绕三轴角速度、TF父子坐标、协方差矩阵
***************************************/
void turn_on_robot::Publish_Odom()
{
    //Convert the Z-axis rotation Angle into a quaternion for expression 
    //把Z轴转角转换为四元数进行表达
    geometry_msgs::Quaternion odom_quat = tf::createQuaternionMsgFromYaw(Robot_Pos.Z);

    nav_msgs::Odometry odom; //Instance the odometer topic data //实例化里程计话题数据
    odom.header.stamp = ros::Time::now(); 
    odom.header.frame_id = odom_frame_id; // Odometer TF parent coordinates //里程计TF父坐标
    odom.pose.pose.position.x = Robot_Pos.X; //Position //位置
    odom.pose.pose.position.y = Robot_Pos.Y;
    odom.pose.pose.position.z = Robot_Pos.Z;
    odom.pose.pose.orientation = odom_quat; //Posture, Quaternion converted by Z-axis rotation //姿态，通过Z轴转角转换的四元数

    odom.child_frame_id = robot_frame_id; // Odometer TF subcoordinates //里程计TF子坐标
    odom.twist.twist.linear.x =  Robot_Vel.X; //Speed in the X direction //X方向速度
    odom.twist.twist.linear.y =  Robot_Vel.Y; //Speed in the Y direction //Y方向速度
    odom.twist.twist.angular.z = Robot_Vel.Z; //Angular velocity around the Z axis //绕Z轴角速度 

    //There are two types of this matrix, which are used when the robot is at rest and when it is moving.Extended Kalman Filtering officially provides 2 matrices for the robot_pose_ekf feature pack
    //这个矩阵有两种，分别在机器人静止和运动的时候使用。扩展卡尔曼滤波官方提供的2个矩阵，用于robot_pose_ekf功能包
    if(Robot_Vel.X== 0&&Robot_Vel.Y== 0&&Robot_Vel.Z== 0)
      //If the velocity is zero, it means that the error of the encoder will be relatively small, and the data of the encoder will be considered more reliable
      //如果velocity是零，说明编码器的误差会比较小，认为编码器数据更可靠
      memcpy(&odom.pose.covariance, odom_pose_covariance2, sizeof(odom_pose_covariance2)),
      memcpy(&odom.twist.covariance, odom_twist_covariance2, sizeof(odom_twist_covariance2));
    else
      //If the velocity of the trolley is non-zero, considering the sliding error that may be brought by the encoder in motion, the data of IMU is considered to be more reliable
      //如果小车velocity非零，考虑到运动中编码器可能带来的滑动误差，认为imu的数据更可靠
      memcpy(&odom.pose.covariance, odom_pose_covariance, sizeof(odom_pose_covariance)),
      memcpy(&odom.twist.covariance, odom_twist_covariance, sizeof(odom_twist_covariance));       
    odom_publisher.publish(odom); //Pub odometer topic //发布里程计话题
}
/**************************************
Date: January 28, 2021
Function: Publish voltage-related information
功能: 发布电压相关信息
***************************************/
void turn_on_robot::Publish_Voltage()
{
    std_msgs::Float32 voltage_msgs; //Define the data type of the power supply voltage publishing topic //定义电源电压发布话题的数据类型
    static float Count_Voltage_Pub=0;
    if(Count_Voltage_Pub++>10)
      {
        Count_Voltage_Pub=0;  
        voltage_msgs.data = Power_voltage; //The power supply voltage is obtained //电源供电的电压获取
        voltage_publisher.publish(voltage_msgs); //Post the power supply voltage topic unit: V, volt //发布电源电压话题单位：V、伏特
      }
}

void turn_on_robot::Publish_WheelSpeed()
{
    std_msgs::Float32MultiArray wheel_speed_msg;
    wheel_speed_msg.data.resize(3);
    wheel_speed_msg.data[0] = Receive_Data.Wheel_Speed[0];
    wheel_speed_msg.data[1] = Receive_Data.Wheel_Speed[1];
    wheel_speed_msg.data[2] = Receive_Data.Wheel_Speed[2];
    wheel_speed_publisher.publish(wheel_speed_msg);
}

/**************************************
Date: January 28, 2021
Function: Serial port communication check function, packet n has a byte, the NTH -1 byte is the check bit, the NTH byte bit frame end.Bit XOR results from byte 1 to byte n-2 are compared with byte n-1, which is a BCC check
Input parameter: Count_Number: Check the first few bytes of the packet
功能: 串口通讯校验函数，数据包n有个字节，第n-1个字节为校验位，第n个字节位帧尾。第1个字节到第n-2个字节数据按位异或的结果与第n-1个字节对比，即为BCC校验
输入参数： Count_Number：数据包前几个字节加入校验   mode：对发送数据还是接收数据进行校验
***************************************/
unsigned char turn_on_robot::Check_Sum(unsigned char Count_Number,unsigned char mode)
{
  unsigned char check_sum=0,k;
  
  if(mode==0) //Receive data mode //接收数据模式
  {
   for(k=0;k<Count_Number;k++)
    {
     check_sum=check_sum^Receive_Data.rx[k]; //By bit or by bit //按位异或
     }
  }
  if(mode==1) //Send data mode //发送数据模式
  {
   for(k=0;k<Count_Number;k++)
    {
     check_sum=check_sum^Send_Data.tx[k]; //By bit or by bit //按位异或
     }
  }
  return check_sum; //Returns the bitwise XOR result //返回按位异或结果
}
/**************************************
Date: November 18, 2021
Function: Read and verify the data sent by the lower computer frame by frame through the serial port, and then convert the data into international units
功能: 通过串口读取并逐帧校验下位机发送过来的数据，然后数据转换为国际单位
***************************************/
bool turn_on_robot::Get_Sensor_Data_New()
{
  short transition_16=0;

  // Read all available bytes from serial into buffer
  size_t available = Stm32_Serial.available();
  if (available > 0) {
    size_t space = SERIAL_BUF_SIZE - serial_buf_len_;
    size_t to_read = (available < space) ? available : space;
    if (to_read > 0) {
      size_t bytes_read = Stm32_Serial.read(serial_buf_ + serial_buf_len_, to_read);
      serial_buf_len_ += bytes_read;
    }
  }

  // Scan buffer for complete frames
  while (serial_buf_len_ >= RECEIVE_DATA_SIZE) {
    // Find FRAME_HEADER
    int header_pos = -1;
    for (int i = 0; i <= serial_buf_len_ - RECEIVE_DATA_SIZE; ++i) {
      if (serial_buf_[i] == FRAME_HEADER) {
        header_pos = i;
        break;
      }
    }

    if (header_pos < 0) {
      // No header found, discard all but last (RECEIVE_DATA_SIZE-1) bytes
      int discard = serial_buf_len_ - (RECEIVE_DATA_SIZE - 1);
      if (discard > 0) {
        memmove(serial_buf_, serial_buf_ + discard, serial_buf_len_ - discard);
        serial_buf_len_ -= discard;
      }
      break;
    }

    // Discard bytes before header
    if (header_pos > 0) {
      memmove(serial_buf_, serial_buf_ + header_pos, serial_buf_len_ - header_pos);
      serial_buf_len_ -= header_pos;
    }

    if (serial_buf_len_ < RECEIVE_DATA_SIZE)
      break;

    // Check frame tail
    if (serial_buf_[RECEIVE_DATA_SIZE - 1] != FRAME_TAIL) {
      // Bad tail, skip this header byte and rescan
      memmove(serial_buf_, serial_buf_ + 1, serial_buf_len_ - 1);
      serial_buf_len_--;
      continue;
    }

    // BCC checksum must be calculated from the candidate frame currently in
    // serial_buf_. Receive_Data still contains the previous frame here.
    unsigned char check = 0;
    for (int i = 0; i < 28; ++i)
      check ^= serial_buf_[i];
    if (check != serial_buf_[28]) {
      // Checksum failed, skip this header byte
      memmove(serial_buf_, serial_buf_ + 1, serial_buf_len_ - 1);
      serial_buf_len_--;
      continue;
    }

    // Valid frame - copy to Receive_Data
    memcpy(Receive_Data.rx, serial_buf_, RECEIVE_DATA_SIZE);

    // Consume frame from buffer
    memmove(serial_buf_, serial_buf_ + RECEIVE_DATA_SIZE, serial_buf_len_ - RECEIVE_DATA_SIZE);
    serial_buf_len_ -= RECEIVE_DATA_SIZE;

    // Parse frame data
    Receive_Data.Flag_Stop = Receive_Data.rx[1];
    Robot_Vel.X = Odom_Trans(Receive_Data.rx[2], Receive_Data.rx[3]);
    Robot_Vel.Y = Odom_Trans(Receive_Data.rx[4], Receive_Data.rx[5]);
    Robot_Vel.Z = Odom_Trans(Receive_Data.rx[6], Receive_Data.rx[7]);

    Mpu6050_Data.accele_x_data = IMU_Trans(Receive_Data.rx[8],  Receive_Data.rx[9]);
    Mpu6050_Data.accele_y_data = IMU_Trans(Receive_Data.rx[10], Receive_Data.rx[11]);
    Mpu6050_Data.accele_z_data = IMU_Trans(Receive_Data.rx[12], Receive_Data.rx[13]);
    Mpu6050_Data.gyros_x_data  = IMU_Trans(Receive_Data.rx[14], Receive_Data.rx[15]);
    Mpu6050_Data.gyros_y_data  = IMU_Trans(Receive_Data.rx[16], Receive_Data.rx[17]);
    Mpu6050_Data.gyros_z_data  = IMU_Trans(Receive_Data.rx[18], Receive_Data.rx[19]);

    Mpu6050.linear_acceleration.x = Mpu6050_Data.accele_x_data / ACCEl_RATIO;
    Mpu6050.linear_acceleration.y = Mpu6050_Data.accele_y_data / ACCEl_RATIO;
    Mpu6050.linear_acceleration.z = Mpu6050_Data.accele_z_data / ACCEl_RATIO;
    Mpu6050.angular_velocity.x = Mpu6050_Data.gyros_x_data * GYROSCOPE_RATIO;
    Mpu6050.angular_velocity.y = Mpu6050_Data.gyros_y_data * GYROSCOPE_RATIO;
    Mpu6050.angular_velocity.z = Mpu6050_Data.gyros_z_data * GYROSCOPE_RATIO;

    transition_16 = 0;
    transition_16 |= Receive_Data.rx[20] << 8;
    transition_16 |= Receive_Data.rx[21];
    Power_voltage = transition_16 / 1000 + (transition_16 % 1000) * 0.001;

    Receive_Data.Wheel_Speed[0] = Odom_Trans(Receive_Data.rx[22], Receive_Data.rx[23]);
    Receive_Data.Wheel_Speed[1] = Odom_Trans(Receive_Data.rx[24], Receive_Data.rx[25]);
    Receive_Data.Wheel_Speed[2] = Odom_Trans(Receive_Data.rx[26], Receive_Data.rx[27]);

    return true;
  }

  return false;
}
/**************************************
Date: January 28, 2021
Function: Loop access to the lower computer data and issue topics
功能: 循环获取下位机数据与发布话题
***************************************/
void turn_on_robot::Control()
{
  ros::NodeHandle private_nh("~");
  double control_rate = 200.0;
  private_nh.param("control_rate", control_rate, 200.0);
  ros::Rate loop_rate(control_rate > 0.0 ? control_rate : 200.0);
  while(ros::ok())
  {
    if (true == Get_Sensor_Data_New()) //The serial port reads and verifies the data sent by the lower computer, and then the data is converted to international units
                                       //通过串口读取并校验下位机发送过来的数据，然后数据转换为国际单位
    {
      _Now = ros::Time::now();
      if(_Last_Time.toSec()==0) _Last_Time=_Now; //Perform this operation when entering for the first time to avoid excessive integration time
                                                 //首次进入时进行此操作，避免积分时间过大
      Sampling_Time = (_Now - _Last_Time).toSec(); //Retrieves time interval, which is used to integrate velocity to obtain displacement (mileage) 
                                                   //获取时间间隔，用于积分速度获得位移(里程)
      
      //Odometer correction parameters
      //里程计误差修正
      Robot_Vel.X=Robot_Vel.X*odom_x_scale;
      Robot_Vel.Y=Robot_Vel.Y*odom_y_scale;
      if(Robot_Vel.Z>=0)
        Robot_Vel.Z=Robot_Vel.Z*odom_z_scale_positive;
      else
        Robot_Vel.Z=Robot_Vel.Z*odom_z_scale_negative;

      //Speed * Time = displacement (odometer)
      //速度*时间=位移（里程计）
      Robot_Pos.X+=(Robot_Vel.X * cos(Robot_Pos.Z) - Robot_Vel.Y * sin(Robot_Pos.Z)) * Sampling_Time; //Calculate the displacement in the X direction, unit: m //计算X方向的位移，单位：m
      Robot_Pos.Y+=(Robot_Vel.X * sin(Robot_Pos.Z) + Robot_Vel.Y * cos(Robot_Pos.Z)) * Sampling_Time; //Calculate the displacement in the Y direction, unit: m //计算Y方向的位移，单位：m
      Robot_Pos.Z+=Robot_Vel.Z * Sampling_Time; //The angular displacement about the Z axis, in rad //绕Z轴的角位移，单位：rad 

      //Calculate the three-axis attitude from the IMU with the angular velocity around the three-axis and the three-axis acceleration
      //通过IMU绕三轴角速度与三轴加速度计算三轴姿态
      Quaternion_Solution(quat_state_, Mpu6050.angular_velocity.x, Mpu6050.angular_velocity.y, Mpu6050.angular_velocity.z,\
                Mpu6050.linear_acceleration.x, Mpu6050.linear_acceleration.y, Mpu6050.linear_acceleration.z,\
                (Sampling_Time > 0.0f) ? (1.0f / Sampling_Time) : 20.0f);

      Publish_Odom();      //Pub the speedometer topic //发布里程计话题
      Publish_WheelSpeed(); //Pub the wheel-speed topic //发布轮速话题
      Publish_ImuSensor(); //Pub the IMU topic //发布IMU话题    
      Publish_Voltage();   //Pub the topic of power supply voltage //发布电源电压话题

      _Last_Time = _Now; //Record the time and use it to calculate the time interval //记录时间，用于计算时间间隔
    }
    
    ros::spinOnce();   //The loop waits for the callback function //循环等待回调函数
    loop_rate.sleep();
    }
}
/**************************************
Date: January 28, 2021
Function: Constructor, executed only once, for initialization
功能: 构造函数, 只执行一次，用于初始化
***************************************/
turn_on_robot::turn_on_robot():Sampling_Time(0),Power_voltage(0),target_angle(0),external_heading_deg(0)
{
  //Clear the data
  //清空数据
  memset(&Robot_Pos, 0, sizeof(Robot_Pos));
  memset(&Robot_Vel, 0, sizeof(Robot_Vel));
  memset(&Receive_Data, 0, sizeof(Receive_Data)); 
  memset(&Send_Data, 0, sizeof(Send_Data));
  memset(&Mpu6050_Data, 0, sizeof(Mpu6050_Data));
  memset(serial_buf_, 0, sizeof(serial_buf_));
  serial_buf_len_ = 0;

  ros::NodeHandle private_nh("~"); //Create a node handle //创建节点句柄
  //The private_nh.param() entry parameter corresponds to the initial value of the name of the parameter variable on the parameter server
  //private_nh.param()入口参数分别对应：参数服务器上的名称  参数变量名  初始值
  private_nh.param<std::string>("usart_port_name",  usart_port_name,  "/dev/wheeltec_controller"); //Fixed serial port number //固定串口号
  private_nh.param<int>        ("serial_baud_rate", serial_baud_rate, 115200); //Communicate baud rate 115200 to the lower machine //和下位机通信波特率115200
  private_nh.param<std::string>("odom_frame_id",    odom_frame_id,    "odom_combined");      //The odometer topic corresponds to the parent TF coordinate //里程计话题对应父TF坐标
  private_nh.param<std::string>("robot_frame_id",   robot_frame_id,   "base_footprint"); //The odometer topic corresponds to sub-TF coordinates //里程计话题对应子TF坐标
  private_nh.param<std::string>("gyro_frame_id",    gyro_frame_id,    "gyro_link"); //IMU topics correspond to TF coordinates //IMU话题对应TF坐标

  //Odometer correction parameters
  //里程计误差修正参数
  private_nh.param<float>("odom_x_scale",    odom_x_scale,    1.0); 
  private_nh.param<float>("odom_y_scale",    odom_y_scale,    1.0); 
  private_nh.param<float>("odom_z_scale_positive",    odom_z_scale_positive,    1.0); 
  private_nh.param<float>("odom_z_scale_negative",    odom_z_scale_negative,    1.0); 


  voltage_publisher = n.advertise<std_msgs::Float32>("PowerVoltage", 10); //Create a battery-voltage topic publisher //创建电池电压话题发布者
  odom_publisher    = n.advertise<nav_msgs::Odometry>("odom", 50); //Create the odometer topic publisher //创建里程计话题发布者
  imu_publisher     = n.advertise<sensor_msgs::Imu>("imu", 20); //Create an IMU topic publisher //创建IMU话题发布者
  wheel_speed_publisher = n.advertise<std_msgs::Float32MultiArray>("wheel_speed", 50); //Create wheel-speed topic publisher //创建轮速话题发布者

  //Set the velocity control command callback function
  //速度控制命令订阅回调函数设置
  Cmd_Vel_Sub     = n.subscribe("cmd_vel",     100, &turn_on_robot::Cmd_Vel_Callback, this); 
  Fault_Config_Sub = n.subscribe("/chassis/fault_config", 10, &turn_on_robot::Fault_Config_Callback, this);

  //Set the angle control command callback function
  //角度控制命令订阅回调函数设置
  Angle_Sub       = n.subscribe("target_angle", 10, &turn_on_robot::Angle_Callback, this);
  Angle_Reset_Sub = n.subscribe("target_angle_reset", 10, &turn_on_robot::Angle_Reset_Callback, this);
  Heading_Sub     = n.subscribe("/chassis/heading_deg", 10, &turn_on_robot::Heading_Callback, this);

  ROS_INFO_STREAM("Data ready"); //Prompt message //提示信息

  // Open serial port with retries
  const int max_retries = 5;
  const double retry_delay = 2.0;
  bool serial_opened = false;
  for (int attempt = 1; attempt <= max_retries; ++attempt) {
    try {
      ROS_INFO("Opening serial port %s @ %d (%d/%d)",
               usart_port_name.c_str(), serial_baud_rate, attempt, max_retries);
      Stm32_Serial.setPort(usart_port_name);
      Stm32_Serial.setBaudrate(serial_baud_rate);
      serial::Timeout _time = serial::Timeout::simpleTimeout(2000);
      Stm32_Serial.setTimeout(_time);
      Stm32_Serial.open();
      Stm32_Serial.flushInput();
      serial_opened = true;
      break;
    } catch (serial::IOException& e) {
      ROS_ERROR("Serial open failed (attempt %d/%d): %s", attempt, max_retries, e.what());
      if (attempt < max_retries && ros::ok())
        ros::Duration(retry_delay).sleep();
    }
  }
  if (serial_opened) {
    ROS_INFO_STREAM("wheeltec_robot serial port opened");
  } else {
    ROS_FATAL("Failed to open serial port after %d attempts. Shutting down.", max_retries);
    ros::shutdown();
  }
}
/**************************************
Date: January 28, 2021
Function: Destructor, executed only once and called by the system when an object ends its life cycle
功能: 析构函数，只执行一次，当对象结束其生命周期时系统会调用这个函数
***************************************/
turn_on_robot::~turn_on_robot()
{
  //Sends the stop motion command to the lower machine before the turn_on_robot object ends
  //对象turn_on_robot结束前向下位机发送停止运动命令
  Send_Data.tx[0]=FRAME_HEADER;
  Send_Data.tx[1] = 0;  
  Send_Data.tx[2] = 0; 

  //The target velocity of the X-axis of the robot //机器人X轴的目标线速度 
  Send_Data.tx[4] = 0;     
  Send_Data.tx[3] = 0;  

  //The target velocity of the Y-axis of the robot //机器人Y轴的目标线速度 
  Send_Data.tx[6] = 0;
  Send_Data.tx[5] = 0;  

  //The target angular velocity of the robot's Z axis //机器人Z轴的目标角速度 
  Send_Data.tx[8] = 0;  
  Send_Data.tx[7] = 0;    

  //The target angle (set to 0 when stopping) //停止时目标角度设为0
  Send_Data.tx[10] = 0;
  Send_Data.tx[9] = 0;

  Send_Data.tx[11]=Check_Sum(11,SEND_DATA_CHECK); //Check the bits for the Check_Sum function //校验位，规则参见Check_Sum函数
  Send_Data.tx[12]=FRAME_TAIL; 
  try
  {
    if (Stm32_Serial.isOpen())
      Stm32_Serial.write(Send_Data.tx,sizeof (Send_Data.tx)); //Send data to the serial port //向串口发数据  
  }
  catch (serial::IOException& e)   
  {
    ROS_ERROR_STREAM("Unable to send data through serial port"); //If sending data fails, an error message is printed //如果发送数据失败,打印错误信息
  }
  if (Stm32_Serial.isOpen())
    Stm32_Serial.close(); //Close the serial port //关闭串口  
  ROS_INFO_STREAM("Shutting down"); //Prompt message //提示信息
}
