
#ifndef __QUATERNION_SOLUTION_H_
#define __QUATERNION_SOLUTION_H_

struct QuaternionState {
    float twoKp = 1.0f;
    float twoKi = 0.0f;
    float q0 = 1.0f, q1 = 0.0f, q2 = 0.0f, q3 = 0.0f;
    float integralFBx = 0.0f, integralFBy = 0.0f, integralFBz = 0.0f;
};

float InvSqrt(float number);
void Quaternion_Solution(QuaternionState& state, float gx, float gy, float gz,
                         float ax, float ay, float az, float sampling_freq);

#endif
