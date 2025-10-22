export type S3ListItem = { key: string; size: number; lastModified: string | null };
export type S3ListResponse = { items?: S3ListItem[]; mock?: boolean; error?: string };
export type S3HeadResponse = { exists?: boolean; size?: number; etag?: string; contentType?: string; lastModified?: string; mock?: boolean; error?: string };





