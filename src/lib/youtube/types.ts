export interface YouTubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  defaultLanguage: string | null;
  hasCaptions: boolean;
  publishedAt: string;
}

export interface CuratedVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  durationSeconds: number;
  language: string;
  score: number;
  reason: string;
  /** 0 = principal, 1+ = alternativas de respaldo (anti link-rot). */
  rank: number;
}
