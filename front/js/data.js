/**
 * 角色数据、对话脚本、情绪模型
 */
const CHARACTERS = {
  dazhi: {
    id: 'dazhi',
    name: '李大志',
    avatar: '😔',
    color: '#e74c3c',
    bgGradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    tagline: '"我觉得我不行……"',
    desc: '内向沉默，长期被忽视，有明显的习得性无助倾向。回答问题时总低着头，声音很小。',
    traits: {
      confidence: 15,
      expressiveness: 25,
      anxiety: 85,
      motivation: 20,
      socialSkill: 30
    },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    personality: '习得性无助型',
    emotion: { joy: 20, activation: 15, anxiety: 75 },
    dialogues: [
      {
        trigger: '提问',
        reply: '……嗯……我不太确定……',
        innerThought: '完了完了，又被点名了。我肯定又要答错了，全班都会笑我的……',
        emotionDelta: { joy: -5, activation: 10, anxiety: 20 }
      },
      {
        trigger: '鼓励',
        reply: '真……真的吗？老师你不是在安慰我吧……',
        innerThought: '老师居然说我做得好？等等，是不是在反讽我？不对，老师的眼神很真诚……好像真的在夸我？',
        emotionDelta: { joy: 15, activation: 5, anxiety: -10 }
      },
      {
        trigger: '批评',
        reply: '……对不起，我下次注意……',
        innerThought: '果然，我就知道我不行。我什么都做不好。算了，反正努力也没用……',
        emotionDelta: { joy: -20, activation: -10, anxiety: 30 }
      },
      {
        trigger: '安抚',
        reply: '嗯……谢谢老师……',
        innerThought: '老师好像真的不讨厌我？可是我还是好紧张……不过感觉稍微好一点了。',
        emotionDelta: { joy: 10, activation: 0, anxiety: -15 }
      },
      {
        trigger: '互动',
        reply: '老师我知道了。',
        innerThought: '完了，其实我一个字没听懂，但我不敢说。万一老师觉得我笨怎么办……',
        emotionDelta: { joy: 0, activation: -5, anxiety: 10 }
      }
    ],
    freeReplies: [
      {
        reply: '嗯……好的老师……',
        innerThought: '老师在说什么？我脑子里一片空白，只想赶紧让这节课结束……',
        emotionDelta: { joy: -3, activation: -5, anxiety: 8 }
      },
      {
        reply: '我……我试试？',
        innerThought: '天哪，我刚才居然主动说了"试试"？！我是不是疯了……',
        emotionDelta: { joy: 5, activation: 10, anxiety: 5 }
      },
      {
        reply: '……',
        innerThought: '沉默是金，沉默是金。只要我不说话就不会说错话。对，就这样。',
        emotionDelta: { joy: -5, activation: -8, anxiety: 12 }
      }
    ]
  },

  yiming: {
    id: 'yiming',
    name: '张一鸣',
    avatar: '😎',
    color: '#3498db',
    bgGradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    tagline: '"老师！我有个问题！"',
    desc: '活泼好动，思维跳跃，课堂上总爱插嘴。聪明但注意力不集中，需要老师引导其专注。',
    traits: {
      confidence: 80,
      expressiveness: 90,
      anxiety: 20,
      motivation: 65,
      socialSkill: 85
    },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    personality: '注意力分散型',
    emotion: { joy: 70, activation: 85, anxiety: 15 },
    dialogues: [
      {
        trigger: '提问',
        reply: '哦这个我知道！等等……好像又不是……嘿嘿',
        innerThought: '我绝对知道答案！是什么来着……算了先举手再说，答案一会儿就想起来了！',
        emotionDelta: { joy: 5, activation: 15, anxiety: 5 }
      },
      {
        trigger: '鼓励',
        reply: '嘿嘿，那当然！老师你眼光真好！',
        innerThought: '哈哈被表扬了！我就说我是天才吧！等下课了一定要告诉我妈！',
        emotionDelta: { joy: 20, activation: 10, anxiety: -5 }
      },
      {
        trigger: '批评',
        reply: '啊？我哪里做错了嘛……好吧好吧我改',
        innerThought: '切，老师也太严了吧。不就是上课折了个纸飞机嘛……好吧确实有点过分了。',
        emotionDelta: { joy: -10, activation: -5, anxiety: 15 }
      },
      {
        trigger: '安抚',
        reply: '老师你放心！我保证这次认真听！',
        innerThought: '老师人还挺好的。行吧，看在老师的面子上，我认真听五分钟……不，三分钟！',
        emotionDelta: { joy: 10, activation: 5, anxiety: -8 }
      },
      {
        trigger: '互动',
        reply: '老师老师！我们能不能做个实验？书上讲的太无聊了！',
        innerThought: '天哪这节课也太长了，我裤兜里的橡皮泥都快被我捏碎了……',
        emotionDelta: { joy: 5, activation: 20, anxiety: 0 }
      }
    ],
    freeReplies: [
      {
        reply: '老师你说的这个让我想到一个笑话——',
        innerThought: '虽然跟上课没关系，但这个笑话真的很好笑啊！忍不住了！',
        emotionDelta: { joy: 10, activation: 15, anxiety: 0 }
      },
      {
        reply: '啊？老师你刚才说什么来着？我走神了嘿嘿……',
        innerThought: '刚才在想放学去哪里玩，完全没听……希望老师别生气。',
        emotionDelta: { joy: -5, activation: -10, anxiety: 10 }
      },
      {
        reply: '好嘞老师！包在我身上！',
        innerThought: '虽然我也不知道老师让我干啥，但先答应了再说！',
        emotionDelta: { joy: 8, activation: 10, anxiety: 3 }
      }
    ]
  },

  xiaorou: {
    id: 'xiaorou',
    name: '林暖暖',
    avatar: '🥺',
    color: '#9b59b6',
    bgGradient: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
    tagline: '"老师，你是不是生气了……"',
    desc: '敏感细腻，善于察言观色，情绪容易受外界影响。很在意老师的评价，容易过度解读。',
    traits: {
      confidence: 35,
      expressiveness: 55,
      anxiety: 70,
      motivation: 50,
      socialSkill: 60
    },
    traitLabels: ['自信心', '表达力', '焦虑度', '学习动力', '社交能力'],
    personality: '高敏感型',
    emotion: { joy: 45, activation: 40, anxiety: 55 },
    dialogues: [
      {
        trigger: '提问',
        reply: '老师，我觉得答案可能是这个……但我不太确定，你觉得呢？',
        innerThought: '其实我挺确定的，但万一说错了老师会不会失望？还是加个"不确定"保险一点……',
        emotionDelta: { joy: 0, activation: 10, anxiety: 10 }
      },
      {
        trigger: '鼓励',
        reply: '谢谢老师！你这么说我真的好开心……',
        innerThought: '呜呜呜老师太温柔了吧！我都要哭了。这种被认可的感觉真好……',
        emotionDelta: { joy: 25, activation: 10, anxiety: -20 }
      },
      {
        trigger: '批评',
        reply: '对不起老师……我是不是让你失望了……',
        innerThought: '完了，老师一定讨厌我了。我要怎么做才能让老师不生气……我好难过……',
        emotionDelta: { joy: -25, activation: -5, anxiety: 35 }
      },
      {
        trigger: '安抚',
        reply: '老师……你真的不生气吗？那我就放心了……',
        innerThought: '老师说没生气，但真的吗？看老师的表情好像确实没有生气……好吧我选择相信。',
        emotionDelta: { joy: 15, activation: 5, anxiety: -20 }
      },
      {
        trigger: '互动',
        reply: '好的老师，我这就去做。',
        innerThought: '老师交代的事情一定要做好！不能让老师失望！加油林暖暖！',
        emotionDelta: { joy: 5, activation: 8, anxiety: -5 }
      }
    ],
    freeReplies: [
      {
        reply: '老师，你今天看起来好像不太开心？',
        innerThought: '老师是不是因为我上次作业写得不好所以不开心？一定是我的错……',
        emotionDelta: { joy: -5, activation: 5, anxiety: 15 }
      },
      {
        reply: '嗯……我觉得你说得对，老师。',
        innerThought: '其实我有不同意见，但我怕说出来会让气氛变得尴尬……算了。',
        emotionDelta: { joy: -3, activation: -5, anxiety: 8 }
      },
      {
        reply: '老师，我能问你一个问题吗……如果你不忙的话……',
        innerThought: '好紧张好紧张，老师会不会觉得我很烦？可是我真的有不懂的地方……',
        emotionDelta: { joy: 0, activation: 8, anxiety: 12 }
      }
    ]
  }
};

const QUICK_PHRASES = [
  { id: 'ask', label: '✋ 提问', trigger: '提问', text: '来，这道题你来回答一下？' },
  { id: 'encourage', label: '👏 鼓励', trigger: '鼓励', text: '你做得很好，老师为你感到骄傲！' },
  { id: 'criticize', label: '😤 批评', trigger: '批评', text: '你这样做是不对的，需要改正。' },
  { id: 'comfort', label: '🤗 安抚', trigger: '安抚', text: '没关系，老师不会怪你的，慢慢来。' },
  { id: 'interact', label: '💬 互动', trigger: '互动', text: '我们一起来讨论一下这个问题好不好？' }
];

const EMOTION_LABELS = {
  joy: { name: '愉悦度', color: '#2ecc71', icon: '😊' },
  activation: { name: '激活度', color: '#3498db', icon: '⚡' },
  anxiety: { name: '焦虑度', color: '#e74c3c', icon: '😰' }
};

const STATUS_THRESHOLDS = [
  { condition: (e) => e.anxiety > 80, label: '😱 极度焦虑', color: '#c0392b' },
  { condition: (e) => e.anxiety > 60, label: '😰 有点紧张', color: '#e74c3c' },
  { condition: (e) => e.joy > 70 && e.anxiety < 30, label: '🌟 深受鼓舞', color: '#27ae60' },
  { condition: (e) => e.joy > 50, label: '😊 心情不错', color: '#2ecc71' },
  { condition: (e) => e.activation > 70, label: '🔥 非常活跃', color: '#e67e22' },
  { condition: (e) => e.activation < 20, label: '😴 昏昏欲睡', color: '#95a5a6' },
  { condition: () => true, label: '😐 状态一般', color: '#7f8c8d' }
];

function getStatusLabel(emotion) {
  for (const t of STATUS_THRESHOLDS) {
    if (t.condition(emotion)) return t;
  }
  return STATUS_THRESHOLDS[STATUS_THRESHOLDS.length - 1];
}

/**
 * 个性化路径模型 —— 每个角色的理想教学策略 + 预警规则
 */
const PATH_PROFILES = {
  dazhi: {
    ideal: { '鼓励': 35, '安抚': 30, '互动': 20, '提问': 10, '批评': 5 },
    recommended: ['鼓励', '安抚'],
    neutral: ['互动', '提问'],
    harmful: ['批评'],
    warnings: [
      {
        id: 'dazhi-crit',
        check: (hist) => hist.filter(m => m.role === 'teacher' && m.trigger === '批评').length >= 2,
        level: 'danger',
        title: '🚨 路径严重偏离',
        message: '连续批评正在摧毁大志仅存的自信心！当前路径走向→「学生彻底放弃自我」',
        glow: 'red'
      },
      {
        id: 'dazhi-crit1',
        check: (hist) => {
          const msgs = hist.filter(m => m.role === 'teacher');
          return msgs.length > 0 && msgs[msgs.length - 1].trigger === '批评';
        },
        level: 'warning',
        title: '⚠️ 路径偏离预警',
        message: '对习得性无助型学生使用批评，焦虑值正在飙升。建议立即切换到「安抚」或「鼓励」策略。',
        glow: 'orange'
      },
      {
        id: 'dazhi-noenc',
        check: (hist) => {
          const t = hist.filter(m => m.role === 'teacher');
          return t.length >= 4 && t.filter(m => m.trigger === '鼓励').length === 0;
        },
        level: 'info',
        title: '💡 路径建议',
        message: '大志已经很久没有收到鼓励了。研究表明，每3-4轮对话至少需要1次正向反馈来维持他的信心。',
        glow: 'blue'
      }
    ]
  },
  yiming: {
    ideal: { '互动': 30, '提问': 25, '鼓励': 20, '批评': 15, '安抚': 10 },
    recommended: ['互动', '提问'],
    neutral: ['鼓励', '批评'],
    harmful: [],
    warnings: [
      {
        id: 'yiming-nostructure',
        check: (hist) => {
          const t = hist.filter(m => m.role === 'teacher');
          return t.length >= 4 && t.filter(m => m.trigger === '批评' || m.trigger === '提问').length === 0;
        },
        level: 'warning',
        title: '⚠️ 缺乏结构引导',
        message: '一鸣的注意力正在涣散！需要适当的「提问」或温和「批评」来帮助他重新聚焦。',
        glow: 'orange'
      },
      {
        id: 'yiming-overenc',
        check: (hist) => {
          const t = hist.filter(m => m.role === 'teacher');
          const enc = t.filter(m => m.trigger === '鼓励').length;
          return t.length >= 3 && enc / t.length > 0.7;
        },
        level: 'info',
        title: '💡 策略提醒',
        message: '过多鼓励可能让一鸣更加飘飘然。试试用「提问」来引导他把聪明劲用在正事上！',
        glow: 'blue'
      }
    ]
  },
  xiaorou: {
    ideal: { '安抚': 30, '鼓励': 30, '互动': 25, '提问': 10, '批评': 5 },
    recommended: ['安抚', '鼓励'],
    neutral: ['互动'],
    harmful: ['批评', '提问'],
    warnings: [
      {
        id: 'xiaorou-crit',
        check: (hist) => hist.filter(m => m.role === 'teacher' && m.trigger === '批评').length >= 1,
        level: 'danger',
        title: '🚨 高敏感警报',
        message: '小柔的心门正在关闭！高敏感型学生承受批评后，需要至少2次「安抚」才能恢复信任。当前路径→「学生闭锁心扉」',
        glow: 'red'
      },
      {
        id: 'xiaorou-rapid',
        check: (hist) => {
          const t = hist.filter(m => m.role === 'teacher');
          if (t.length < 3) return false;
          const last3 = t.slice(-3);
          const span = last3[2].timestamp - last3[0].timestamp;
          return span < 8000;
        },
        level: 'warning',
        title: '⚠️ 语速过快预警',
        message: '您的回复频率过高！小柔需要更多消化时间，过快的节奏会让她更加紧张焦虑。',
        glow: 'orange'
      },
      {
        id: 'xiaorou-nocomfort',
        check: (hist) => {
          const t = hist.filter(m => m.role === 'teacher');
          return t.length >= 3 && t.filter(m => m.trigger === '安抚').length === 0;
        },
        level: 'info',
        title: '💡 路径建议',
        message: '小柔一直没有收到安抚信号。高敏感型学生需要频繁的情绪确认，试试告诉她"老师不会生气"。',
        glow: 'blue'
      }
    ]
  }
};

const GLOW_MAP = {
  happy: { className: 'glow-happy', threshold: (e) => e.joy > 55 && e.anxiety < 40 },
  sad: { className: 'glow-sad', threshold: (e) => e.joy < 25 },
  anxious: { className: 'glow-anxious', threshold: (e) => e.anxiety > 70 },
  excited: { className: 'glow-excited', threshold: (e) => e.activation > 75 && e.joy > 50 }
};

function getEmotionGlow(emotion) {
  if (GLOW_MAP.anxious.threshold(emotion)) return 'glow-anxious';
  if (GLOW_MAP.sad.threshold(emotion)) return 'glow-sad';
  if (GLOW_MAP.excited.threshold(emotion)) return 'glow-excited';
  if (GLOW_MAP.happy.threshold(emotion)) return 'glow-happy';
  return '';
}
