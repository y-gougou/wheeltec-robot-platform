
#include "Quaternion_Solution.h"
#include "wheeltec_robot.h"
/**************************************
Date: May 31, 2020
Function: 平方根倒数 求四元数用到
***************************************/
float InvSqrt(float number)
{
  volatile long i;
    volatile float x, y;
    volatile const float f = 1.5F;
    x = number * 0.5F;
    y = number;
    i = * (( long * ) &y);
    i = 0x5f375a86 - ( i >> 1 );
    y = * (( float * ) &i);
    y = y * ( f - ( x * y * y ) );

  return y;
}
/**************************************
Date: May 31, 2020
Function: 四元数解算
***************************************/
void Quaternion_Solution(QuaternionState& state, float gx, float gy, float gz,
                         float ax, float ay, float az, float sampling_freq)
{
  float recipNorm;
  float halfvx, halfvy, halfvz;
  float halfex, halfey, halfez;
  float qa, qb, qc;
  float inv_freq = 1.0f / sampling_freq;
  // Compute feedback only if accelerometer measurement valid (avoids NaN in accelerometer normalisation)
  if(!((ax == 0.0f) && (ay == 0.0f) && (az == 0.0f))) {
    // 首先把加速度计采集到的值(三维向量)转化为单位向量，即向量除以模
    recipNorm = InvSqrt(ax * ax + ay * ay + az * az);
    ax *= recipNorm;
    ay *= recipNorm;
    az *= recipNorm;
    // 把四元数换算成方向余弦中的第三行的三个元素
    halfvx = state.q1 * state.q3 - state.q0 * state.q2;
    halfvy = state.q0 * state.q1 + state.q2 * state.q3;
    halfvz = state.q0 * state.q0 - 0.5f + state.q3 * state.q3;
    //误差是估计的重力方向和测量的重力方向的交叉乘积之和
    halfex = (ay * halfvz - az * halfvy);
    halfey = (az * halfvx - ax * halfvz);
    halfez = (ax * halfvy - ay * halfvx);
    // 计算并应用积分反馈（如果启用）
    if(state.twoKi > 0.0f) {
      state.integralFBx += state.twoKi * halfex * inv_freq;
      state.integralFBy += state.twoKi * halfey * inv_freq;
      state.integralFBz += state.twoKi * halfez * inv_freq;
      gx += state.integralFBx;
      gy += state.integralFBy;
      gz += state.integralFBz;
    }
    else {
      state.integralFBx = 0.0f;
      state.integralFBy = 0.0f;
      state.integralFBz = 0.0f;
    }
    // Apply proportional feedback
    gx += state.twoKp * halfex;
    gy += state.twoKp * halfey;
    gz += state.twoKp * halfez;
  }
  // Integrate rate of change of quaternion
  gx *= (0.5f * inv_freq);
  gy *= (0.5f * inv_freq);
  gz *= (0.5f * inv_freq);
  qa = state.q0;
  qb = state.q1;
  qc = state.q2;
  state.q0 += (-qb * gx - qc * gy - state.q3 * gz);
  state.q1 += (qa * gx + qc * gz - state.q3 * gy);
  state.q2 += (qa * gy - qb * gz + state.q3 * gx);
  state.q3 += (qa * gz + qb * gy - qc * gx);
  // Normalise quaternion
  recipNorm = InvSqrt(state.q0 * state.q0 + state.q1 * state.q1 + state.q2 * state.q2 + state.q3 * state.q3);
  state.q0 *= recipNorm;
  state.q1 *= recipNorm;
  state.q2 *= recipNorm;
  state.q3 *= recipNorm;
  Mpu6050.orientation.w = state.q0;
  Mpu6050.orientation.x = state.q1;
  Mpu6050.orientation.y = state.q2;
  Mpu6050.orientation.z = state.q3;
}
