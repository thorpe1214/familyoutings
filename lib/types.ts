export type AgeBand = "0–5" | "6–12" | "Teens" | "All Ages";
export type IndoorOutdoor = "Indoor" | "Outdoor";

export interface SourceInfo {
  name: string;
  url: string;
}

export interface EventItem {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  venue: string;
  address: string;
  lat: number;
  lon: number;
  isFree: boolean;
  priceMin: number;
  priceMax: number;
  age: AgeBand;
  indoorOutdoor: IndoorOutdoor;
  familyClaim: string;
  parentVerified: boolean;
  source: SourceInfo;
  description: string;
  tags: string[];
  kidAllowed?: boolean;
}

export interface ICSInput {
  title: string;
  startISO: string;
  endISO: string;
  description: string;
  location: string;
  url?: string;
  organizerName?: string;
}
