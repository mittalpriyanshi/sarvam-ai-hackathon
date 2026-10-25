export const FIELD_KEYS = [
  'travellerName', 'origin', 'destination', 'departureDate', 'departureTime',
  'arrivalDate', 'arrivalTime', 'trainOrBusNumber', 'ticketClass', 'seat', 'coach',
  'platform', 'bookingReference', 'bookingStatus', 'fare',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export interface FieldValue {
  value: string | null;
  note: string | null;
}

export interface TicketResult {
  success: true;
  mode: 'live' | 'sample';
  input: 'image' | 'text';
  ticketType: 'train' | 'bus' | 'flight' | 'event' | 'unknown';
  sourceLanguage: string;
  targetLanguage: string;
  sourceText: string;
  fields: Record<FieldKey, FieldValue>;
  abbreviations: { term: string; meaning: string }[];
  importantInstructions: string[];
  checklist: { item: string; basis: 'ticket' | 'suggestion' }[];
  translation: { original: string; translated: string }[];
  uncertainFields: string[];
  summary: string;
}

export interface ApiError {
  success: false;
  code: string;
  error: string;
}

export const OUTPUT_LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: 'en-IN', label: 'English', native: 'English' },
  { code: 'hi-IN', label: 'Hindi', native: 'हिन्दी' },
  { code: 'bn-IN', label: 'Bengali', native: 'বাংলা' },
  { code: 'gu-IN', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'kn-IN', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml-IN', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr-IN', label: 'Marathi', native: 'मराठी' },
  { code: 'od-IN', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'pa-IN', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ta-IN', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', label: 'Telugu', native: 'తెలుగు' },
];

export const TICKET_LANGUAGES: { code: string; label: string }[] = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'Hindi' },
  { code: 'bn-IN', label: 'Bengali' },
  { code: 'gu-IN', label: 'Gujarati' },
  { code: 'kn-IN', label: 'Kannada' },
  { code: 'ml-IN', label: 'Malayalam' },
  { code: 'mr-IN', label: 'Marathi' },
  { code: 'pa-IN', label: 'Punjabi' },
  { code: 'ta-IN', label: 'Tamil' },
  { code: 'te-IN', label: 'Telugu' },
  { code: 'ur-IN', label: 'Urdu' },
];

export const FIELD_LABELS: Record<FieldKey, string> = {
  travellerName: 'Passenger',
  origin: 'From',
  destination: 'To',
  departureDate: 'Departure date',
  departureTime: 'Departure time',
  arrivalDate: 'Arrival date',
  arrivalTime: 'Arrival time',
  trainOrBusNumber: 'Train / bus / flight no.',
  ticketClass: 'Class',
  seat: 'Seat / berth',
  coach: 'Coach',
  platform: 'Platform',
  bookingReference: 'PNR / booking ref',
  bookingStatus: 'Booking status',
  fare: 'Fare',
};
