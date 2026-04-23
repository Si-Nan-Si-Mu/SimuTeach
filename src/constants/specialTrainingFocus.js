/**
 * 专项模拟人格与能力评估大类的固定对应（与报告「专项训练」跳转卡一致，见 x-evaluation 三大类）
 */
export const TRAINING_FOCUS_BY_STUDENT_ID = {
  dazhi: '讲解清晰度',
  yiming: '课堂管理',
  xiaorou: '心理沟通'
}

export function trainingFocusForStudentId(id) {
  return (id && TRAINING_FOCUS_BY_STUDENT_ID[id]) || ''
}
