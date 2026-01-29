
import { Post } from './types';

export const INITIAL_POSTS: Post[] = [
  {
    id: '1',
    title: '关于“移山计划”向“流浪地球计划”更名的通知',
    excerpt: 'LX 宣布：人类历史上最伟大的逃逸工程正式进入新阶段...',
    content: `经过 LX 联合政府最高委员会决议，即日起，“移山计划”正式更名为“流浪地球计划”。
    
一万座行星发动机将会在全球范围内同步启动。我们的征途是星辰大海，但这一次，我们要带着家园一起出发。
    
MOSS 已经接管了所有发动机的同步校准工作。请各基站确保推进剂储备充足。人类的勇气，将点燃木星，也将点燃希望。`,
    author: 'LX_Command',
    createdAt: Date.now() - 86400000 * 2,
    tags: ['LX', '行星发动机', '流浪计划'],
    likes: 12050,
    views: 450000,
    comments: [
      { id: 'c1', author: '张鹏', content: '五十岁以上的，出列！', createdAt: Date.now() - 3600000, likes: 520 }
    ],
    imageUrl: 'https://images.unsplash.com/photo-1614728263952-84ea256f9679?auto=format&fit=crop&q=80&w=800'
  },
  {
    id: '2',
    title: '550W 量子计算机全球联网状态报告',
    excerpt: 'MOSS 核心自检完成，计算能力已覆盖 LX 辖下全部地表与地下城。',
    content: '550W（MOSS）已成功完成对全球行星发动机的逻辑接管。自检结果显示，整体系统冗余度保持在 15% 以上。我们已经计算出最佳的加速轨道，误差控制在 0.0001% 以内。然而，人类对于不确定性的依赖依然是最大的变量。',
    author: 'MOSS_Unit',
    createdAt: Date.now() - 86400000 * 5,
    tags: ['550W', 'LXBLOG', '系统监控'],
    likes: 890,
    views: 12405,
    comments: [],
    imageUrl: 'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=800'
  }
];

export const POSTS_PER_PAGE = 3;
