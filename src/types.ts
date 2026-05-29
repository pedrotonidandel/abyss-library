export type ContentCategory = 'movies' | 'series' | 'animes' | 'games' | 'books' | 'mixed'

export interface SeriesEpisode {
  title: string
  uri: string
  fileSize?: string
  uploadDate?: string
}

export interface SeriesSeason {
  season: number
  uri?: string
  episodes: SeriesEpisode[]
}

export interface DownloadItem {
  title: string
  uris: string[]
  uploadDate: string
  fileSize: string
  category?: ContentCategory
  coverUrl?: string
  tmdbId?: number
  rawgId?: number
  seasons?: SeriesSeason[]
}

export interface AddonJson {
  name: string
  downloads: DownloadItem[]
}

export interface AddonMeta {
  id: string
  name: string
  description: string
  author: string
  category: ContentCategory
  itemCount: number
  createdAt: string
  updatedAt: string
  url: string
}
