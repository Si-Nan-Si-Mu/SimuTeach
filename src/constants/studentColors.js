export const STUDENT_COLORS = {
  dazhi: {
    bg: '#F4F6F9',
    primary: '#9fd9f3ff',
    name: '李大志'
  },
  yiming: {
    bg: '#F0F9FF',
    primary: '#3498db',
    name: '张一鸣'
  },
  xiaorou: {
    bg: '#F5F3FF',
    primary: '#9b59b6',
    name: '林暖暖'
  }
}

export function getStudentColors(studentId) {
  return STUDENT_COLORS[studentId] || STUDENT_COLORS.dazhi
}
