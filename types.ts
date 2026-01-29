
export interface Post {
  id: string;
  title: string;
  content: string;
  excerpt: string;
  author: string;
  createdAt: number;
  tags: string[];
  likes: number;
  views: number;
  comments: Comment[];
  imageUrl?: string;
}

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: number;
  likes: number;
  imageUrl?: string;
  location?: string;
}

export type SortOption = 'newest' | 'oldest' | 'likes' | 'views';

export interface BlogState {
  posts: Post[];
  isAdmin: boolean;
  searchQuery: string;
  selectedTag: string | null;
  currentPage: number;
  sortBy: SortOption;
}
