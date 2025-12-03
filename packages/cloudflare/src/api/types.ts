/**
 * Shared types for Google API clients.
 */

/**
 * OAuth token information passed from the auth handler.
 */
export interface TokenInfo {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Google API error response.
 */
export interface GoogleApiError {
  error: {
    code: number;
    message: string;
    status: string;
    errors?: Array<{
      domain: string;
      reason: string;
      message: string;
    }>;
  };
}

/**
 * Google Slides API types
 */

export interface Dimension {
  magnitude: number;
  unit: "EMU" | "PT";
}

export interface Size {
  width: Dimension;
  height: Dimension;
}

export interface AffineTransform {
  scaleX: number;
  scaleY: number;
  shearX: number;
  shearY: number;
  translateX: number;
  translateY: number;
  unit: "EMU" | "PT";
}

export interface PageElement {
  objectId: string;
  size?: Size;
  transform?: AffineTransform;
  shape?: Shape;
  image?: Image;
  table?: Table;
  line?: Line;
  video?: Video;
  elementGroup?: ElementGroup;
}

export interface Shape {
  shapeType: string;
  text?: TextContent;
  shapeProperties?: ShapeProperties;
  placeholder?: Placeholder;
}

export interface Placeholder {
  type: string;
  index?: number;
  parentObjectId?: string;
}

export interface TextContent {
  textElements?: TextElement[];
}

export interface TextElement {
  startIndex?: number;
  endIndex?: number;
  paragraphMarker?: ParagraphMarker;
  textRun?: TextRun;
}

export interface ParagraphMarker {
  style?: ParagraphStyle;
}

export interface ParagraphStyle {
  alignment?: string;
  lineSpacing?: number;
}

export interface TextRun {
  content?: string;
  style?: TextStyle;
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  fontSize?: Dimension;
  fontFamily?: string;
  foregroundColor?: ColorStyle;
}

export interface ColorStyle {
  opaqueColor?: OpaqueColor;
}

export interface OpaqueColor {
  rgbColor?: RgbColor;
  themeColor?: string;
}

export interface RgbColor {
  red?: number;
  green?: number;
  blue?: number;
}

export interface ShapeProperties {
  shapeBackgroundFill?: Fill;
  outline?: Outline;
}

export interface Fill {
  solidFill?: SolidFill;
}

export interface SolidFill {
  color?: ColorStyle;
  alpha?: number;
}

export interface Outline {
  outlineFill?: Fill;
  weight?: Dimension;
}

export interface Image {
  contentUrl?: string;
  sourceUrl?: string;
  imageProperties?: ImageProperties;
}

export interface ImageProperties {
  cropProperties?: CropProperties;
}

export interface CropProperties {
  leftOffset?: number;
  rightOffset?: number;
  topOffset?: number;
  bottomOffset?: number;
}

export interface Table {
  rows: number;
  columns: number;
  tableRows?: TableRow[];
}

export interface TableRow {
  rowHeight?: Dimension;
  tableCells?: TableCell[];
}

export interface TableCell {
  text?: TextContent;
}

export interface Line {
  lineType?: string;
  lineProperties?: LineProperties;
}

export interface LineProperties {
  lineFill?: Fill;
  weight?: Dimension;
}

export interface Video {
  url?: string;
  source?: string;
  videoProperties?: VideoProperties;
}

export interface VideoProperties {
  start?: number;
  end?: number;
}

export interface ElementGroup {
  children?: PageElement[];
}

export interface Page {
  objectId: string;
  pageType?: "SLIDE" | "MASTER" | "LAYOUT" | "NOTES" | "NOTES_MASTER";
  pageElements?: PageElement[];
  slideProperties?: SlideProperties;
  pageProperties?: PageProperties;
}

export interface SlideProperties {
  layoutObjectId?: string;
  masterObjectId?: string;
  notesPage?: Page;
}

export interface PageProperties {
  pageBackgroundFill?: Fill;
}

export interface Presentation {
  presentationId: string;
  pageSize: Size;
  slides?: Page[];
  title?: string;
  masters?: Page[];
  layouts?: Page[];
  locale?: string;
  revisionId?: string;
  notesMaster?: Page;
}

export interface BatchUpdateRequest {
  requests: Request[];
}

export interface Request {
  [key: string]: unknown;
}

export interface BatchUpdateResponse {
  presentationId: string;
  replies: Reply[];
  writeControl?: WriteControl;
}

export interface Reply {
  [key: string]: unknown;
}

export interface WriteControl {
  requiredRevisionId?: string;
}

export interface Thumbnail {
  contentUrl: string;
  width: number;
  height: number;
}

/**
 * Google Drive API types
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime?: string;
  modifiedTime?: string;
  owners?: DriveUser[];
  parents?: string[];
}

export interface DriveUser {
  displayName?: string;
  emailAddress?: string;
}

export interface FileList {
  files: DriveFile[];
  nextPageToken?: string;
}
